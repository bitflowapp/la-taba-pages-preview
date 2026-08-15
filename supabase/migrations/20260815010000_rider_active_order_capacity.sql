-- ─────────────────────────────────────────────────────────────────────────────
-- TABA2 · Rider multi-pedido, parte 1: la capacidad es un invariante de tabla
--
-- Hoy conviven dos verdades incompatibles sobre cuántos pedidos activos puede
-- tener un Rider:
--
--   * `claim_delivery_order` devuelve `active_delivery_exists` si ya hay uno.
--     Es el ÚNICO chequeo server-side que existe, y vive en el camino de toma
--     libre de cola, que la RC del piloto no usa.
--   * `assign_order_rider` —el camino que el piloto SÍ usa— no cuenta nada. El
--     Panel ya puede asignarle cuatro pedidos al mismo Rider.
--
-- Lo que hacía invisible la segunda es la lectura: `get_active_rider_delivery`
-- termina en `limit 1`. El Rider veía un pedido porque la RPC devolvía un
-- pedido, no porque el servidor le impidiera tener más.
--
-- Esta migración cambia el eje. La capacidad deja de ser una condición dentro
-- de una función y pasa a ser un invariante de `public.orders`:
--
--   1. `rider_max_active_orders()` — una sola fuente de verdad, hoy 3.
--   2. `count_rider_active_orders()` — DERIVADA de las filas de pedidos. No hay
--      columna contador, así que no hay drift posible.
--   3. `lock_rider_capacity()` — advisory lock POR RIDER, no por pedido. Es la
--      diferencia entre serializar dos aceptaciones simultáneas del mismo Rider
--      y dejar que las dos cuenten 2 y escriban las dos.
--   4. Un trigger en `orders` que recuenta cuando una fila ENTRA al conjunto
--      activo con rider y aborta si pasaría del máximo.
--
-- El trigger es lo que hace que esto valga: cubre accept, `assign_order_rider`,
-- `claim_delivery_order`, `release_or_reassign_delivery` y cualquier UPDATE
-- suelto. Una RPC futura que se olvide del lock sigue sin poder crear un 4/3.
--
-- QUÉ NO CAMBIA, a propósito:
--   · el vocabulario de estados. No se inventa ninguno;
--   · qué cuenta como activo: assigned/picked_up/on_the_way/arrived, que es el
--     mismo conjunto que ya usan can_access_order, is_assigned_rider y las RPC;
--   · RLS. Esta migración no crea, borra ni debilita una sola policy;
--   · `manualAssignmentOnly`, que sigue significando «no hay auto-despacho» y
--     nunca significó «un solo pedido».
--
-- REVERSIÓN: docs/migrations/rollback/20260815010000_*.rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ===========================================================================
-- 1. La constante, en un solo lugar
-- ===========================================================================

create or replace function public.rider_max_active_orders()
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select 3 $$;

comment on function public.rider_max_active_orders() is
  'MAX_ACTIVE_RIDER_ORDERS. Unica fuente de verdad de la capacidad del Rider.';

-- Los estados que consumen cupo. delivered/cancelled/rejected no aparecen, asi
-- que liberan cupo por el solo hecho de llegar ahi: no hace falta ningun
-- proceso que "devuelva" nada.
create or replace function public.rider_active_order_statuses()
returns text[]
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select array['assigned', 'picked_up', 'on_the_way', 'arrived']::text[] $$;

comment on function public.rider_active_order_statuses() is
  'Estados que ocupan un cupo del Rider. Los terminales no estan y por eso liberan.';

-- ===========================================================================
-- 2. La cuenta, derivada
-- ===========================================================================
-- Sin columna contador. La cuenta sale de las mismas filas que lee el resto del
-- sistema, asi que no puede quedar desincronizada de la realidad.

create or replace function public.count_rider_active_orders(
  p_business_id uuid,
  p_rider_user_id uuid,
  p_excluding_order_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select count(*)::integer
    from public.orders o
   where o.business_id = p_business_id
     and o.assigned_rider_user_id = p_rider_user_id
     and o.delivery_mode = 'delivery'
     and o.status = any (public.rider_active_order_statuses())
     and (p_excluding_order_id is null or o.id <> p_excluding_order_id)
$$;

comment on function public.count_rider_active_orders(uuid, uuid, uuid) is
  'Pedidos activos del Rider, DERIVADOS de public.orders. No hay contador mutable.';

-- ===========================================================================
-- 3. El lock, por Rider
-- ===========================================================================
-- La leccion de auditar 226bca2: alli la capacidad se serializaba con un lock
-- POR PEDIDO (dispatch_lock_job). Con maximo 1 la carrera quedaba tapada por un
-- indice de "una oferta viva por rider". Con maximo 3 y dos ofertas simultaneas
-- al mismo Rider, dos pedidos distintos toman locks distintos, los dos cuentan
-- 2, y los dos escriben. Serian 4/3.
--
-- El sujeto de la regla es el Rider, asi que el lock es del Rider.

create or replace function public.lock_rider_capacity(p_rider_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_rider_user_id is null then
    raise exception 'rider requerido para bloquear capacidad' using errcode = '22023';
  end if;
  -- La forma de dos argumentos es (int4, int4): el primero actua de espacio de
  -- nombres y el segundo identifica al Rider. Con la forma de un bigint el lock
  -- viviria en el mismo espacio que cualquier otro advisory lock del esquema.
  perform pg_advisory_xact_lock(
    hashtext('taba.rider_capacity'),
    hashtext(p_rider_user_id::text)
  );
end;
$$;

comment on function public.lock_rider_capacity(uuid) is
  'Advisory lock transaccional por Rider. Se toma ANTES de contar y antes de bloquear filas.';

-- ===========================================================================
-- 4. El invariante, en la tabla
-- ===========================================================================
-- Se dispara solo cuando la fila ENTRA al conjunto contado con un rider: un
-- cambio de estado dentro del conjunto, o cualquier update que no toque ni el
-- rider ni el estado, no paga nada y no toma ningun lock.
--
-- Orden de locks: advisory de rider -> fila de pedido. Es el mismo orden que
-- usan las RPC, asi que no introduce un ciclo nuevo.

create or replace function public.enforce_rider_active_order_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_max integer := public.rider_max_active_orders();
  v_active integer;
  v_entering boolean;
begin
  if new.assigned_rider_user_id is null
    or new.delivery_mode <> 'delivery'
    or not (new.status = any (public.rider_active_order_statuses())) then
    return new;
  end if;

  v_entering := tg_op = 'INSERT'
    or old.assigned_rider_user_id is distinct from new.assigned_rider_user_id
    or not (old.status = any (public.rider_active_order_statuses()))
    or old.delivery_mode is distinct from new.delivery_mode;

  if not v_entering then
    return new;
  end if;

  perform public.lock_rider_capacity(new.assigned_rider_user_id);

  v_active := public.count_rider_active_orders(
    new.business_id,
    new.assigned_rider_user_id,
    new.id
  );

  if v_active >= v_max then
    raise exception
      'el rider ya tiene % entregas activas, el maximo es %', v_active, v_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_rider_active_order_capacity() is
  'Invariante de capacidad del Rider. Cubre TODO camino que asigne, no solo las RPC.';

drop trigger if exists orders_enforce_rider_active_order_capacity on public.orders;
create trigger orders_enforce_rider_active_order_capacity
before insert or update on public.orders
for each row execute function public.enforce_rider_active_order_capacity();

-- ===========================================================================
-- 5. El claim canonico deja de decir "uno" y pasa a decir "tres"
-- ===========================================================================
-- Cuerpo identico al de 20260806220000 salvo el bloque de capacidad. Se
-- conserva el codigo `active_delivery_exists` como alias historico y se agrega
-- `at_capacity`, que es el que devuelve de ahora en mas: la app vieja mapea el
-- primero, la nueva el segundo, y ninguna de las dos se rompe.

create or replace function public.claim_delivery_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
  v_fingerprint bytea;
  v_active integer;
  v_max integer := public.rider_max_active_orders();
begin
  perform public.rider_require_active_membership(p_business_id);
  if p_expected_revision is null or p_expected_revision < 1 or btrim(coalesce(p_public_code, '')) = '' then
    raise exception 'claim invalido' using errcode = '22023';
  end if;

  -- El lock de capacidad, ANTES de bloquear el pedido. Dos claims simultaneos
  -- del mismo Rider se ordenan aca.
  perform public.lock_rider_capacity(auth.uid());

  select o.* into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;
  if v_order.origin <> 'production' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid()
     and operation = 'claim' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;

  v_active := public.count_rider_active_orders(p_business_id, auth.uid(), v_order.id);
  if v_active >= v_max then
    return jsonb_build_object(
      'ok', false,
      'code', 'at_capacity',
      'active_orders', v_active,
      'max_active_orders', v_max
    );
  end if;

  if v_order.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision);
  end if;
  if v_order.delivery_mode <> 'delivery' or v_order.status <> 'ready' or v_order.assigned_rider_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id
     and revision = p_expected_revision
     and assigned_rider_user_id is null
     and status = 'ready';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  v_result := jsonb_build_object(
    'ok', true,
    'outcome', 'claimed',
    'idempotent_no_op', false,
    'order', public.rider_active_delivery_payload(v_order.id)
  );
  v_fingerprint := digest(jsonb_build_object('public_code', v_order.public_code, 'revision', p_expected_revision)::text, 'sha256');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'claim', v_key, v_fingerprint, v_result);
  return v_result;
end;
$function$;

comment on function public.claim_delivery_order(uuid, text, bigint, text) is
  'Claim idempotente canonico del Rider; solo pedidos de operacion real y hasta rider_max_active_orders() activos.';

-- ===========================================================================
-- 6. `assign_order_rider` deja de ser el camino sin cuenta
-- ===========================================================================
-- Cuerpo identico al de 20260812110000 salvo dos cosas: toma el lock de
-- capacidad del rider DESTINATARIO antes de bloquear la fila del pedido, y
-- rechaza explicitamente con un mensaje que el Panel puede mostrar en vez de
-- dejar que salte el trigger con un 23514 generico.
--
-- La reasignacion al MISMO rider que ya lo tiene no consume cupo nuevo y sigue
-- siendo un no-op idempotente, igual que antes.

create or replace function public.assign_order_rider(
  p_order_id uuid,
  p_expected_status text,
  p_expected_rider_user_id uuid,
  p_new_rider_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_business_id uuid;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
  v_active integer;
  v_max integer := public.rider_max_active_orders();
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_new_rider_user_id is null then
    raise exception 'order_id y rider requeridos' using errcode = '22023';
  end if;

  select o.business_id
    into v_business_id
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  if not public.has_business_role(v_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  -- Capacidad del destinatario, antes de tocar la fila. Dos operadores que
  -- asignan pedidos distintos al mismo Rider 2/3 se ordenan aca.
  perform public.lock_rider_capacity(p_new_rider_user_id);

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;

  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = p_new_rider_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rider activo del negocio requerido' using errcode = '42501';
  end if;

  if v_expected_status not in ('ready', 'assigned')
    or v_order.status <> v_expected_status
    or v_order.status not in ('ready', 'assigned')
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id then
    raise exception 'conflicto de asignacion: estado o rider esperado cambio'
      using errcode = '40001';
  end if;

  if v_order.assigned_rider_user_id = p_new_rider_user_id
    and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id);
  end if;

  v_active := public.count_rider_active_orders(v_order.business_id, p_new_rider_user_id, v_order.id);
  if v_active >= v_max then
    raise exception 'el rider ya tiene % entregas activas, el maximo es %', v_active, v_max
      using errcode = '23514';
  end if;

  update public.orders
     set assigned_rider_user_id = p_new_rider_user_id,
         status = 'assigned'
   where id = v_order.id;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    'business',
    'business',
    v_user_id,
    case when v_order.assigned_rider_user_id is null then 'order.rider_assigned' else 'order.rider_reassigned' end,
    case when v_order.assigned_rider_user_id is null then 'order.rider_assigned' else 'order.rider_reassigned' end,
    case when v_order.assigned_rider_user_id is null then 'Rider asignado por el negocio' else 'Rider reasignado por el negocio' end,
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id,
      'rider_active_orders', v_active + 1,
      'rider_max_active_orders', v_max
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    )
  );

  return public.rider_order_rpc_payload(v_order.id);
end;
$function$;

-- ===========================================================================
-- 7. Grants: exactamente los que ya existian, sin ampliar
-- ===========================================================================

revoke execute on function public.rider_max_active_orders() from public, anon, authenticated;
revoke execute on function public.rider_active_order_statuses() from public, anon, authenticated;
revoke execute on function public.count_rider_active_orders(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.lock_rider_capacity(uuid) from public, anon, authenticated;
revoke execute on function public.enforce_rider_active_order_capacity() from public, anon, authenticated;

grant execute on function public.rider_max_active_orders() to authenticated;

select pg_notify('pgrst', 'reload schema');
