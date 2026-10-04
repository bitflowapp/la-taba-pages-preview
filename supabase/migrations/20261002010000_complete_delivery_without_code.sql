-- TABA · LA GERENCIA PUEDE CERRAR UNA ENTREGA QUE YA SALIÓ CUANDO EL CÓDIGO NO APARECE
--
-- QUÉ ESTABA ROTO (auditoría, OSM-04; reproducido el 2026-10-03 sobre la rama con sus
-- 190 migraciones, antes de tocar nada)
--
--   Un pedido con envío que ya salió del local sólo se cierra con el código de cuatro
--   dígitos del cliente. Cuando el código no aparece no queda ninguna salida:
--
--     · el cliente pidió desde otro teléfono o cerró la página: su código se lee con
--       la sesión con la que compró, y un pedido pagado por Mercado Pago ni siquiera
--       tiene uno emitido hasta que el cliente abre su seguimiento;
--     · el repartidor asignado ya no puede actuar (lo dieron de baja, se quedó sin
--       teléfono): sus puertas piden membresía activa, la del comercio contesta «la
--       entrega la confirma el repartidor asignado» y reasignar después del retiro
--       no está permitido.
--
--   Con el pedido entregado en la puerta, y a veces cobrado, lo único que se podía
--   hacer era CANCELARLO: la venta salía de los libros y el stock, que ya no está en
--   el local, no vuelve.
--
-- QUÉ CAMBIA
--
--   · `complete_delivery_without_code` (dueño o encargado; NO empleado, NO
--     repartidor): cierra como entregado un pedido con envío que ya salió
--     (`picked_up`, `on_the_way`, `arrived`), lleve o no repartidor. El reparto propio
--     sale en `on_the_way`; sin repartidor, `picked_up` o `arrived` quedan cuando la
--     cuenta del repartidor se borró después del retiro (la columna se vacía sola), y
--     ese pedido también tiene que poder cerrarse. Pide la revisión del pedido, un
--     motivo de una lista cerrada y la clave de idempotencia del Panel. Usa los mismos
--     recibos (`business_command_receipts`) y los mismos códigos de error que
--     `confirm_business_delivery_code`.
--   · `order_delivery_overrides`: la marca durable del cierre. Una fila por cierre:
--     quién, cuándo, el motivo, en qué estado estaba el pedido y cómo estaba el código
--     (sin emitir, vigente, vencido, bloqueado). Sólo la escribe la función.
--   · `prevent_unverified_delivery` acepta, además del código confirmado, esa marca
--     para la revisión exacta del pedido que se está cerrando. Es una cláusula; el
--     resto del resguardo es su definición vigente, letra por letra (generada de la
--     definición viva).
--   · Un evento propio en la historia del pedido, `order.delivered_without_code`, con
--     el motivo y `code_verified: false`.
--
-- POR QUÉ LA MARCA NO VA EN LA FILA DEL CÓDIGO (`order_delivery_handoffs`)
--
--   Era lo más chico: escribir `confirmed_at` y dejar el resguardo como estaba. Se
--   probó sobre la base, y hace decir cosas falsas a funciones que este cambio no
--   toca (y que no puede redefinir sin pisar a sus dueños):
--     · `record_business_self_delivery` lee `confirmed_at` y deja en la historia
--       «Entrega cerrada por el comercio con el codigo del cliente», con
--       `code_verified: true`: justo el registro que queda para un reclamo;
--     · la traza del pedido muestra `handoff.confirmed`, atribuido al repartidor;
--     · y cuando el código nunca se emitió (lo normal en un pedido de Mercado Pago)
--       habría que inventar la fila, con un código que nadie conoce: la traza pasa a
--       decir `handoff.code_issued`.
--   Con la marca aparte, `confirmed_at` sigue queriendo decir una sola cosa: el
--   código se verificó. La fila del código no se toca: sus intentos fallidos y su
--   bloqueo quedan como estaban. El precio es una cláusula en el resguardo.
--
-- QUÉ NO CAMBIA
--
--   · El código sigue siendo obligatorio para el repartidor y para el empleado: un
--     UPDATE a `delivered` sin código confirmado sigue fallando con 55000.
--   · El dinero. No toca el cobro manual, los intentos de pago ni los reembolsos: el
--     efectivo se sigue cobrando con `confirm_manual_order_payment`.
--   · Lo que pasa cuando una entrega se cierra (fecha de entrega, evento de cambio de
--     estado, lugar que libera el repartidor, borrado de sus ubicaciones, ventana del
--     seguimiento, tickets): el cierre pasa por el mismo UPDATE de `orders` y por sus
--     disparadores de siempre. Tampoco los demás resguardos de ese UPDATE: un pedido
--     cuyo pago ya se devolvió sigue admitiendo sólo la cancelación.
--   · La nota libre del operador queda sólo en el recibo del comando. No va a la
--     historia del pedido, ni a la traza, ni al seguimiento del cliente, ni vuelve en
--     la respuesta.
--   · No reasigna un pedido en viaje a otro repartidor, no avisa a nadie y no agrega
--     nada al Panel.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002010000_complete_delivery_without_code.rollback.sql

-- ── 1. La marca durable del cierre ──────────────────────────────────────────
-- La clave es (pedido, revisión): la marca vale para UNA transición, la de la
-- revisión que el operador tenía a la vista. Un pedido entregado no vuelve a estar en
-- viaje, así que en la práctica es una fila por pedido; si alguien lo reabriera con
-- la clave de servicio, la marca vieja no le sirve de pase a nadie.
create table if not exists public.order_delivery_overrides (
  order_id uuid not null references public.orders(id) on delete cascade,
  order_revision bigint not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  reason_code text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_member_role text not null,
  previous_status text not null,
  rider_assigned boolean not null,
  code_required boolean not null,
  handoff_state text not null,
  failed_attempts integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  constraint order_delivery_overrides_pkey primary key (order_id, order_revision),
  constraint order_delivery_overrides_revision_positive check (order_revision >= 1),
  constraint order_delivery_overrides_reason_code_check check (
    reason_code in ('customer_lost_code', 'customer_without_device', 'rider_unavailable', 'code_locked', 'other')),
  constraint order_delivery_overrides_actor_member_role_check check (actor_member_role in ('owner', 'admin')),
  constraint order_delivery_overrides_previous_status_check check (
    previous_status in ('picked_up', 'on_the_way', 'arrived')),
  constraint order_delivery_overrides_handoff_state_check check (
    handoff_state in ('not_issued', 'active', 'expired', 'locked', 'confirmed')),
  constraint order_delivery_overrides_failed_attempts_check check (failed_attempts between 0 and 20)
);

create index if not exists order_delivery_overrides_business_created_idx
  on public.order_delivery_overrides (business_id, created_at desc);

-- Sin permisos ni políticas para los roles de cliente: la escribe sólo la función de
-- cierre, que corre como su dueño. El Panel se entera por el evento de la historia
-- del pedido. La clave de servicio la lee y no la escribe: una marca es un pase para
-- el resguardo del código y no se fabrica por la API.
alter table public.order_delivery_overrides enable row level security;
revoke all on table public.order_delivery_overrides from public, anon, authenticated, service_role;
grant select on table public.order_delivery_overrides to service_role;

comment on table public.order_delivery_overrides is
  'Entregas cerradas por el dueno o el encargado SIN el codigo del cliente. Una fila por cierre. Solo la escribe complete_delivery_without_code.';
comment on column public.order_delivery_overrides.order_revision is
  'Revision del pedido que se cerro. prevent_unverified_delivery acepta la marca solo para esa revision.';
comment on column public.order_delivery_overrides.reason_code is
  'Motivo declarado por quien cerro, de una lista cerrada.';
comment on column public.order_delivery_overrides.actor_member_role is
  'Rol del operador en el comercio al cerrar: owner o admin.';
comment on column public.order_delivery_overrides.previous_status is
  'Estado del pedido antes del cierre, en el vocabulario normalizado.';
comment on column public.order_delivery_overrides.handoff_state is
  'Como estaba el codigo de entrega al cerrar: not_issued (nunca se emitio), active, expired, locked (bloqueado por intentos fallidos) o confirmed.';
comment on column public.order_delivery_overrides.failed_attempts is
  'Intentos fallidos de codigo que tenia el pedido al cerrar. La fila del codigo no se toca.';

-- ── 2. El resguardo acepta la marca ──────────────────────────────────────────
-- Generado de la definición viva de la función con una sola inserción, contada.
CREATE OR REPLACE FUNCTION public.prevent_unverified_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.delivery_code_required
    and not exists (
      select 1
        from public.order_delivery_handoffs h
       where h.order_id = new.id
         and h.confirmed_at is not null
    )
    -- El otro pase: el cierre de gerencia (`complete_delivery_without_code`). Vale
    -- para la revisión exacta que se anotó, no para cualquier entrega posterior del
    -- mismo pedido, y no pasa por `confirmed_at`: ahí sigue figurando sólo un código
    -- que se verificó.
    and not exists (
      select 1
        from public.order_delivery_overrides ov
       where ov.order_id = new.id
         and ov.order_revision = old.revision
    ) then
    raise exception 'codigo de entrega no confirmado' using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function public.prevent_unverified_delivery() from public, anon, authenticated, service_role;

-- ── 3. El comando ───────────────────────────────────────────────────────────
create or replace function public.complete_delivery_without_code(
  p_order_id uuid,
  p_expected_revision bigint,
  p_reason_code text,
  p_idempotency_key text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_reason text := lower(btrim(coalesce(p_reason_code, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
  v_member_role text;
  v_hash text;
  v_now timestamptz;
  v_handoff_state text;
  v_failed_attempts integer;
  v_detail jsonb;
  v_updated integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  -- Dueño o encargado. Ni el empleado ni el repartidor, tampoco el que lleva este
  -- pedido: que quien entrega o quien atiende el mostrador pueda cerrar sin el código
  -- es justo lo que el código le garantiza al cliente que no pasa.
  if not public.has_business_role(v_order.business_id, array['owner', 'admin']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'este cierre es para pedidos con envio' using errcode = '42501';
  end if;
  if v_reason not in ('customer_lost_code', 'customer_without_device', 'rider_unavailable', 'code_locked', 'other') then
    raise exception 'motivo de cierre sin codigo invalido' using errcode = '22023';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'la nota admite hasta 200 caracteres' using errcode = '22023';
  end if;

  -- La idempotencia del Panel: la misma tabla y la misma huella que el resto de sus
  -- comandos. La huella incluye el motivo y la nota: la misma clave con otro motivo
  -- es otro comando, no un reintento.
  v_hash := public.business_command_request_hash(
    'complete_delivery_without_code', p_order_id,
    jsonb_build_object('expected_revision', p_expected_revision, 'reason_code', v_reason, 'note', v_note));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
    end if;
    return (v_existing.result - 'operator_note') || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Doble toque sobre un pedido ya entregado: exito, sin tocar nada.
  v_status := public.normalize_order_status_vocabulary(v_order.status);
  if v_status = 'delivered' then
    select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
    return v_result || jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_replay', false);
  end if;

  if p_expected_revision is null
    or v_order.revision is distinct from p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision, v_order.revision using errcode = 'PT409';
  end if;
  -- Sólo mientras la mercadería está afuera. Antes de salir, el pedido se cancela o
  -- se despacha por el camino de siempre; no hay nada que cerrar a mano.
  if v_status not in ('picked_up', 'on_the_way', 'arrived') then
    raise exception 'el pedido tiene que haber salido del local para cerrarlo sin codigo' using errcode = '23514';
  end if;
  -- Misma regla que arriba, leída una sola vez para anotarla. Si el rol cambió entre
  -- las dos lecturas, se niega: no se anota un rol que no autorizaba.
  v_member_role := public.identity_member_role(v_order.business_id);
  if v_member_role is null or v_member_role not in ('owner', 'admin') then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  -- Cómo estaba el código, sólo para dejarlo dicho. La fila NO se toca: un bloqueo por
  -- intentos fallidos no frena este cierre (no usa el código) y tampoco se borra.
  v_now := clock_timestamp();
  select h.* into v_handoff from public.order_delivery_handoffs h where h.order_id = v_order.id;
  v_handoff_state := case
    when v_handoff.order_id is null then 'not_issued'
    when v_handoff.confirmed_at is not null then 'confirmed'
    when v_handoff.expires_at <= v_now then 'expired'
    when v_handoff.locked_until is not null and v_handoff.locked_until > v_now then 'locked'
    else 'active'
  end;
  v_failed_attempts := coalesce(v_handoff.failed_attempts, 0);

  -- La marca va ANTES del update: `prevent_unverified_delivery` la busca para esta
  -- revisión del pedido.
  insert into public.order_delivery_overrides (
    order_id, order_revision, business_id, reason_code, actor_user_id, actor_member_role,
    previous_status, rider_assigned, code_required, handoff_state, failed_attempts, created_at)
  values (
    v_order.id, v_order.revision, v_order.business_id, v_reason, auth.uid(), v_member_role,
    v_status, v_order.assigned_rider_user_id is not null, v_order.delivery_code_required,
    v_handoff_state, v_failed_attempts, v_now);

  -- El mismo UPDATE que usa el cierre con código, con el mismo pase de transacción:
  -- `prevent_business_delivery_over_rider` no deja que nadie del comercio escriba
  -- `delivered` fuera de una función de cierre. El pase no dice que hubo código; lo
  -- que hubo queda en la marca y en el evento.
  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered' where id = v_order.id and status = v_order.status;
  get diagnostics v_updated = row_count;
  perform set_config('taba.delivery_code_confirmed', '', true);
  if v_updated <> 1 then
    raise exception 'conflicto de estado: el pedido cambio durante el cierre' using errcode = 'PT409';
  end if;

  -- Sin la nota, sin el código y sin ningún id de persona que no sea el del operador,
  -- que va en la columna de siempre.
  v_detail := jsonb_build_object(
    'previous_status', v_order.status,
    'delivery_mode', v_order.delivery_mode,
    'reason_code', v_reason,
    'code_verified', false,
    'code_required', v_order.delivery_code_required,
    'rider_assigned', v_order.assigned_rider_user_id is not null,
    'handoff_state', v_handoff_state,
    'failed_attempts', v_failed_attempts,
    'actor_member_role', v_member_role);
  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id, v_order.business_id, auth.uid(), 'business', 'business', auth.uid(),
    'order.delivered_without_code', 'order.delivered_without_code',
    'Entrega cerrada por el dueno o el encargado sin el codigo del cliente.',
    v_detail, v_detail
  );

  select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
  v_result := v_result || jsonb_build_object(
    'ok', true, 'outcome', 'completed_without_code',
    'code_verified', false, 'reason_code', v_reason,
    'idempotent_replay', false);

  -- La nota queda SÓLO acá: puede traer datos de una persona escritos a mano.
  insert into public.business_command_receipts(
    business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'complete_delivery_without_code',
          p_idempotency_key, v_hash,
          v_result || jsonb_strip_nulls(jsonb_build_object('operator_note', v_note)));

  return v_result;
end;
$$;

revoke all on function public.complete_delivery_without_code(uuid, bigint, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_delivery_without_code(uuid, bigint, text, text, text) to authenticated;

comment on function public.complete_delivery_without_code(uuid, bigint, text, text, text) is
  'Dueno o encargado cierran como entregado un pedido con envio que ya salio (picked_up, on_the_way, arrived) sin el codigo del cliente. Motivo de lista cerrada, CAS por revision, recibo idempotente, marca en order_delivery_overrides y evento order.delivered_without_code. No toca el dinero.';
