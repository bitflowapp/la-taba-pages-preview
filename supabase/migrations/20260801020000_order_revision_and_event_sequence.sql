-- Gate 1: versión monótona de pedido (revision) y orden total de eventos
-- (sequence).
--
-- Motivo verificado sobre staging real, no inferido: 3 de los 19 eventos
-- existentes comparten created_at exacto (mismo microsegundo), porque now()
-- es constante durante toda una transacción y varias RPC escriben más de un
-- evento por transacción. Ordenar versiones por marca de tiempo no puede
-- desempatar esas escrituras, y el reconciliador del cliente
-- (js/core/realtime-sync.js) compara con > estricto: ante un empate descarta
-- silenciosamente el cambio entrante. Un cliente que reconecta no puede
-- distinguir "más nuevo" de "igual de viejo".
--
-- Diseño: el incremento vive en un trigger sobre orders, no dentro de cada
-- RPC. Así toda ruta de escritura -- las actuales y las que agreguen gates
-- futuros -- queda versionada por construcción y ninguna puede olvidarse de
-- incrementar.

-- ===== 1. orders.revision: versión monótona por pedido =====

alter table public.orders
  add column if not exists revision bigint not null default 1;

comment on column public.orders.revision is
  'Version monotona del pedido. La incrementa el trigger orders_zz_bump_revision en cada UPDATE efectivo; el cliente nunca la escribe.';

-- El cliente puede enviar cualquier valor en la columna: se normaliza al valor
-- almacenado ANTES de comparar, de modo que una revisión falsificada no pueda
-- saltear ni congelar la versión real.
create or replace function public.bump_order_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $bump$
begin
  new.revision := old.revision;
  if new is distinct from old then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$bump$;

comment on function public.bump_order_revision() is
  'Incrementa orders.revision en cada UPDATE que cambie la fila; ignora cualquier revision enviada por el cliente.';

-- El nombre empieza con zz a propósito: PostgreSQL dispara los triggers de la
-- misma fase en orden alfabético, y este debe correr DESPUÉS de
-- orders_set_updated_at y orders_set_status_timestamps para observar la fila
-- ya final.
drop trigger if exists orders_zz_bump_revision on public.orders;
create trigger orders_zz_bump_revision
before update on public.orders
for each row
execute function public.bump_order_revision();

-- ===== 2. order_events.sequence: orden total de eventos =====

-- nextval() NO es constante dentro de una transacción, a diferencia de now().
-- Dos eventos escritos por la misma RPC reciben valores distintos y
-- crecientes: exactamente lo que created_at no puede dar.
create sequence if not exists public.order_events_sequence_seq as bigint;

alter table public.order_events
  add column if not exists sequence bigint;

-- Backfill determinista de los eventos ya existentes, respetando el orden
-- temporal observable y desempatando por id para que sea reproducible.
update public.order_events e
   set sequence = ordered.row_number
  from (
    select id, row_number() over (order by created_at, id) as row_number
      from public.order_events
  ) as ordered
 where e.id = ordered.id
   and e.sequence is null;

select setval(
  'public.order_events_sequence_seq',
  greatest(coalesce((select max(sequence) from public.order_events), 0), 1),
  true
);

alter table public.order_events
  alter column sequence set default nextval('public.order_events_sequence_seq');

alter table public.order_events
  alter column sequence set not null;

alter sequence public.order_events_sequence_seq
  owned by public.order_events.sequence;

comment on column public.order_events.sequence is
  'Orden total de eventos. Desempata eventos escritos en la misma transaccion, donde created_at es identico.';

create unique index if not exists order_events_sequence_key
  on public.order_events (sequence);

create index if not exists order_events_order_sequence_idx
  on public.order_events (order_id, sequence desc);

-- ===== 3. Realtime debe transportar la revisión =====

-- Sin replica identity full un UPDATE publica sólo la PK y las columnas
-- cambiadas; el suscriptor no vería revision y no podría descartar mensajes
-- atrasados.
alter table public.orders replica identity full;
alter table public.order_events replica identity full;

-- ===== 4. Vocabulario de estados del Gate 1 =====

-- change_order_status ya traduce received<->submitted y arriving<->arrived,
-- pero no ready_for_pickup. Esta función centraliza la traducción del
-- vocabulario del contrato al vocabulario almacenado, en un único lugar
-- reutilizable, sin redefinir la función de transición ya probada.
create or replace function public.normalize_order_status_vocabulary(p_status text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $norm$
  select case lower(btrim(coalesce(p_status, '')))
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    when 'ready_for_pickup' then 'ready'
    else lower(btrim(coalesce(p_status, '')))
  end;
$norm$;

comment on function public.normalize_order_status_vocabulary(text) is
  'Traduce el vocabulario publico del contrato (submitted/ready_for_pickup/arriving) al vocabulario almacenado.';

-- ===== 5. transition_order: CAS por revisión =====

-- change_order_status hace CAS por estado esperado. Eso protege el doble
-- toque, pero NO distingue dos actores que leyeron el mismo estado y actúan
-- sobre lecturas distintas de la misma fila: ambos pasan la comparación de
-- estado. El CAS por revisión es estrictamente más fuerte, porque la revisión
-- cambia con CUALQUIER escritura efectiva, no sólo con un cambio de estado.
--
-- Esta RPC no reimplementa las reglas de transición ni de rol: delega en
-- change_order_status, que ya las valida. Sólo agrega la barrera de revisión
-- y el vocabulario del contrato.
create or replace function public.transition_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $transition$
declare
  v_order public.orders%rowtype;
  v_current_public text;
  v_target text;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'expected_revision requerido' using errcode = '22023';
  end if;

  v_target := public.normalize_order_status_vocabulary(p_new_status);
  if v_target = '' then
    raise exception 'estado destino requerido' using errcode = '22023';
  end if;

  -- Bloquea la fila antes de comparar la revisión: sin esto dos llamadas
  -- concurrentes podrían leer la misma revisión y ambas considerarse válidas.
  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  -- Una revisión distinta significa que el actor decidió sobre una vista
  -- vieja del pedido. Se rechaza sin aplicar nada: es la regla "rechazar
  -- revisiones o eventos atrasados" del contrato.
  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;

  v_current_public := public.normalize_order_status_vocabulary(v_order.status);

  -- Doble toque: si el pedido ya está en el estado pedido, la operación es un
  -- no-op exitoso. No se emite evento ni se incrementa la revisión, así que
  -- reintentar nunca ensucia el historial.
  if v_current_public = v_target then
    select to_jsonb(o)
      into v_result
      from public.orders o
     where o.id = v_order.id;
    return v_result || jsonb_build_object('idempotent_no_op', true);
  end if;

  -- change_order_status valida estado previo, rol, negocio y rider, y ejecuta
  -- el UPDATE que dispara el incremento de revisión.
  v_result := public.change_order_status(
    p_order_id,
    v_current_public,
    v_target
  );

  return v_result || jsonb_build_object('idempotent_no_op', false);
end;
$transition$;

revoke all on function public.transition_order(uuid, bigint, text)
from public, anon, authenticated;
grant execute on function public.transition_order(uuid, bigint, text)
to authenticated;

comment on function public.transition_order(uuid, bigint, text) is
  'Transicion de pedido con CAS por revision, vocabulario Gate 1 y doble toque idempotente. Delega reglas de rol y transicion en change_order_status.';

revoke all on function public.normalize_order_status_vocabulary(text)
from public, anon;
grant execute on function public.normalize_order_status_vocabulary(text)
to authenticated;
