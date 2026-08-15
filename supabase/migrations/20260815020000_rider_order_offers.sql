-- ─────────────────────────────────────────────────────────────────────────────
-- TABA2 · Rider multi-pedido, parte 2: ofrecer, aceptar, rechazar
--
-- Hoy el Panel ASIGNA: escribe el rider en el pedido y el Rider se entera. Acá
-- el Panel OFRECE, y el Rider decide.
--
-- La oferta es una fila propia y el pedido NO se entera hasta que alguien
-- acepta. Ésa es la decisión central, y la razón es de autorización, no de
-- prolijidad: en este esquema quién ve la dirección exacta, el teléfono y las
-- notas de un pedido lo decide `assigned_rider_user_id`, y lo decide en
-- `can_access_order` (RLS de orders/order_items/order_events),
-- `is_assigned_rider` (RLS de rider_locations), `rider_active_delivery_payload`
-- y las once RPC del Rider. Poner el rider en el pedido antes de que acepte lo
-- hace pasar todas esas compuertas de golpe. Dejándolo fuera, no pasa ninguna,
-- y lo único que puede leer es la proyección minimizada de acá abajo.
--
-- Mientras hay oferta el pedido sigue `ready` y sin rider. Al rechazar, no hay
-- nada que revertir: el pedido nunca se movió, y el Panel puede ofrecerlo a
-- otro. NO se auto-asigna a nadie y NO se despierta ninguna cola.
--
-- LO QUE ESTA MIGRACIÓN NO TRAE, por pedido explícito: turnos, disponibilidad,
-- heartbeat, cola automática, scoring, auto-accept y ofertas por cercanía.
-- Toda oferta nace de una persona del Panel. `manualAssignmentOnly` sigue
-- significando exactamente eso.
--
-- Aplicar después de 20260815010000_rider_active_order_capacity.sql.
-- REVERSIÓN: docs/migrations/rollback/20260815020000_*.rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ===========================================================================
-- 1. Los recibos de idempotencia admiten las dos operaciones nuevas
-- ===========================================================================

alter table public.rider_delivery_operations
  drop constraint if exists rider_delivery_operations_operation_check;

alter table public.rider_delivery_operations
  add constraint rider_delivery_operations_operation_check
  check (operation in (
    'claim', 'picked_up', 'start_route', 'arrived', 'confirm_code', 'report_issue',
    'accept_offer', 'reject_offer'
  ));

-- ===========================================================================
-- 2. La oferta
-- ===========================================================================

create table if not exists public.rider_order_offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete restrict,
  offered_by_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected', 'withdrawn')
  ),
  version bigint not null default 1 check (version > 0),
  expected_order_revision bigint not null check (expected_order_revision > 0),
  offered_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  -- Código cerrado, nunca texto libre: así el Rider no puede escribir datos
  -- personales dentro de la auditoría y el Panel puede agrupar por causa.
  response_reason text check (
    response_reason is null or response_reason in (
      'too_far', 'vehicle_problem', 'load_too_big', 'ending_shift', 'other'
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint rider_order_offers_response_check check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  ),
  constraint rider_order_offers_reason_only_on_reject check (
    response_reason is null or status = 'rejected'
  )
);

-- Un pedido tiene a lo sumo UNA oferta viva. Éste es el contrato de
-- concurrencia entre operadores: si el Staff A le ofreció X a un Rider, el
-- Staff B no puede ofrecer X a otro hasta que la primera se resuelva o se
-- retire. Un solo resultado coherente, garantizado por el índice.
create unique index if not exists rider_order_offers_one_live_per_order
  on public.rider_order_offers (order_id) where status = 'pending';

-- Un pedido se acepta una sola vez.
create unique index if not exists rider_order_offers_one_accepted_per_order
  on public.rider_order_offers (order_id) where status = 'accepted';

-- El rechazo es terminal PARA ESE RIDER: queda una sola fila de rechazo por
-- (pedido, rider), y el Panel no puede volver a ofrecerle el mismo pedido.
create unique index if not exists rider_order_offers_one_rejection_per_rider
  on public.rider_order_offers (order_id, rider_user_id) where status = 'rejected';

create index if not exists rider_order_offers_rider_pending_idx
  on public.rider_order_offers (rider_user_id, offered_at) where status = 'pending';

create index if not exists rider_order_offers_business_timeline_idx
  on public.rider_order_offers (business_id, offered_at desc);

comment on table public.rider_order_offers is
  'Oferta de asignacion manual. El pedido no nombra al rider hasta que la oferta se acepta.';
comment on column public.rider_order_offers.response_reason is
  'Codigo cerrado. Nunca texto libre: la auditoria no debe poder contener datos personales.';

alter table public.rider_order_offers enable row level security;
revoke all privileges on table public.rider_order_offers from public, anon, authenticated;

-- Sin policies a proposito: la tabla se lee y se escribe SOLO por las RPC
-- SECURITY DEFINER de abajo, igual que rider_delivery_operations. Una tabla sin
-- policy y con RLS activa es inalcanzable para anon/authenticated, que es
-- exactamente lo que se quiere.

create or replace function public.touch_rider_order_offer()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists rider_order_offers_touch on public.rider_order_offers;
create trigger rider_order_offers_touch
before update on public.rider_order_offers
for each row execute function public.touch_rider_order_offer();

-- ===========================================================================
-- 3. La proyección de la oferta: lo justo para decidir, nada más
-- ===========================================================================
-- Mismo criterio que `get_rider_queue`, que ya resolvió esta pregunta: comercio,
-- retiro, ZONA (no la calle), forma de pago, monto a cobrar si es efectivo,
-- bultos y minutos estimados.
--
-- NO lleva: nombre del cliente, telefono, calle y altura, referencia, notas,
-- ni ningun identificador interno mas alla del propio order_id, que el Rider
-- necesita para responder y que sin aceptacion no le abre ninguna compuerta.

create or replace function public.rider_offer_payload(p_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'offer_id', f.id,
    'version', f.version,
    'order_id', f.order_id,
    'public_code', o.public_code,
    'expected_order_revision', f.expected_order_revision,
    'offered_at', f.offered_at,
    'business_name', b.name,
    'pickup_summary', b.address,
    'delivery_summary', nullif(btrim(o.customer_neighborhood), ''),
    'delivery_mode', o.delivery_mode,
    'payment_method', o.payment_method,
    'collection_amount', case when o.payment_method = 'cash' then o.total else null end,
    'currency_code', o.currency_code,
    'item_count', greatest(1, coalesce((
      select sum(oi.quantity) from public.order_items oi where oi.order_id = o.id
    ), 0))::integer,
    'estimated_minutes', case
      when o.estimated_arrival_source in ('business', 'routing')
       and o.estimated_arrival_updated_at >= statement_timestamp() - interval '15 minutes'
       and o.estimated_arrival_updated_at <= statement_timestamp() + interval '30 seconds'
       and o.estimated_arrival_at > statement_timestamp()
      then greatest(1, ceil(extract(epoch from (o.estimated_arrival_at - statement_timestamp())) / 60.0))::integer
      else null
    end,
    'ready_at', o.ready_at
  ))
  from public.rider_order_offers f
  join public.orders o on o.id = f.order_id
  join public.businesses b on b.id = o.business_id
  where f.id = p_offer_id
$$;

comment on function public.rider_offer_payload(uuid) is
  'Proyeccion minimizada previa a la aceptacion: zona en vez de calle, sin contacto ni notas.';

-- ===========================================================================
-- 4. El Panel ofrece
-- ===========================================================================
-- Misma firma que `assign_order_rider` a proposito: el Panel cambia una llamada
-- por otra y no reordena nada. La diferencia es que esto NO escribe en el
-- pedido.
--
-- Igual que la asignacion manual, no filtra por `origin`: las sesiones de QA
-- del Panel asignan pedidos de prueba y tienen que poder seguir haciendolo. El
-- filtro `origin = 'production'` vive en `claim_delivery_order`, que es el
-- camino de toma libre, y ahi se queda.

create or replace function public.offer_order_to_rider(
  p_order_id uuid,
  p_expected_status text,
  p_expected_rider_user_id uuid,
  p_new_rider_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_business_id uuid;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
  v_offer public.rider_order_offers%rowtype;
  v_active integer;
  v_max integer := public.rider_max_active_orders();
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_new_rider_user_id is null then
    raise exception 'order_id y rider requeridos' using errcode = '22023';
  end if;

  select o.business_id into v_business_id from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  if not public.has_business_role(v_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  perform public.lock_rider_capacity(p_new_rider_user_id);

  select o.* into v_order from public.orders o where o.id = p_order_id for update;

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

  -- CAS del Panel, identico al de assign_order_rider. Ofrecer solo tiene
  -- sentido sobre un pedido listo y todavia sin rider.
  if v_expected_status <> 'ready'
    or v_order.status <> 'ready'
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id
    or v_order.assigned_rider_user_id is not null then
    raise exception 'conflicto de asignacion: estado o rider esperado cambio'
      using errcode = '40001';
  end if;

  -- Una oferta viva por pedido. El indice lo garantiza; esto da el mensaje.
  select f.* into v_offer
    from public.rider_order_offers f
   where f.order_id = v_order.id and f.status = 'pending'
   for update;
  if found then
    return jsonb_build_object(
      'ok', false,
      'code', case when v_offer.rider_user_id = p_new_rider_user_id then 'already_offered' else 'offer_in_flight' end,
      'offer', jsonb_build_object(
        'offer_id', v_offer.id,
        'rider_user_id', v_offer.rider_user_id,
        'offered_at', v_offer.offered_at
      )
    );
  end if;

  -- El rechazo es terminal para ese Rider.
  if exists (
    select 1 from public.rider_order_offers f
     where f.order_id = v_order.id
       and f.rider_user_id = p_new_rider_user_id
       and f.status = 'rejected'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_rejected_by_rider');
  end if;

  v_active := public.count_rider_active_orders(v_order.business_id, p_new_rider_user_id, null);
  if v_active >= v_max then
    return jsonb_build_object(
      'ok', false,
      'code', 'rider_at_capacity',
      'active_orders', v_active,
      'max_active_orders', v_max
    );
  end if;

  insert into public.rider_order_offers (
    business_id, order_id, rider_user_id, offered_by_user_id, expected_order_revision
  ) values (
    v_order.business_id, v_order.id, p_new_rider_user_id, v_user_id, v_order.revision
  )
  returning * into v_offer;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id, v_order.business_id, v_user_id, 'business', 'business', v_user_id,
    'order.rider_offered', 'order.rider_offered', 'Pedido ofrecido a un rider',
    jsonb_build_object(
      'offer_id', v_offer.id,
      'rider_user_id', p_new_rider_user_id,
      'rider_active_orders', v_active,
      'rider_max_active_orders', v_max
    ),
    jsonb_build_object('offer_id', v_offer.id, 'rider_user_id', p_new_rider_user_id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'offered',
    'offer_id', v_offer.id,
    'version', v_offer.version,
    'rider_active_orders', v_active,
    'rider_max_active_orders', v_max
  );
end;
$$;

-- El operador retira una oferta que quedó colgada (el teléfono del Rider se
-- quedó sin batería) para poder ofrecérsela a otro. No es un rechazo: no marca
-- al Rider y no le cierra el pedido.
create or replace function public.withdraw_rider_order_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_offer public.rider_order_offers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select f.* into v_offer from public.rider_order_offers f where f.id = p_offer_id;
  if not found then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_offer.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  update public.rider_order_offers
     set status = 'withdrawn', responded_at = clock_timestamp(), version = version + 1
   where id = p_offer_id and status = 'pending'
  returning * into v_offer;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'offer_not_pending');
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_offer.order_id, v_offer.business_id, auth.uid(), 'business', 'business', auth.uid(),
    'order.rider_offer_withdrawn', 'order.rider_offer_withdrawn', 'Oferta retirada por el negocio',
    jsonb_build_object('offer_id', v_offer.id, 'rider_user_id', v_offer.rider_user_id),
    jsonb_build_object('offer_id', v_offer.id, 'rider_user_id', v_offer.rider_user_id)
  );

  return jsonb_build_object('ok', true, 'code', 'withdrawn', 'offer_id', v_offer.id);
end;
$$;

-- ===========================================================================
-- 5. El Rider acepta
-- ===========================================================================
-- Los siete chequeos del contrato, en este orden y todos del lado del servidor:
--
--   1. sesion valida .............. rider_require_active_membership (compuerta)
--   2. la oferta es suya .......... rider_user_id = auth.uid()
--   3. la oferta sigue viva ....... status = 'pending'
--   4. el pedido sigue asignable .. status='ready' y sin rider, en el UPDATE
--   5. tiene menos de 3 activos ... count derivado bajo lock por rider
--   6. nadie se lo llevo ..........  idem 4: el UPDATE es el que decide
--   7. revision vigente ........... revision = expected_order_revision
--
-- El lock de capacidad se toma PRIMERO, antes de cualquier fila. Dos taps del
-- mismo Rider, o dos telefonos, se ordenan ahi. El `UPDATE ... where revision =
-- ... and assigned_rider_user_id is null and status = 'ready'` es el CAS final:
-- aunque dos transacciones llegaran juntas, solo una encuentra la fila.

create or replace function public.accept_rider_order_offer(
  p_offer_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_offer public.rider_order_offers%rowtype;
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
  v_active integer;
  v_max integer := public.rider_max_active_orders();
  v_now timestamptz := clock_timestamp();
begin
  if p_offer_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception 'accept invalido' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;

  -- El lock, antes que nada.
  perform public.lock_rider_capacity(auth.uid());

  select f.* into v_offer
    from public.rider_order_offers f
   where f.id = p_offer_id
   for update;

  -- Una oferta ajena es indistinguible de una inexistente. No se confirma su
  -- existencia a quien no es su destinatario.
  if not found or v_offer.rider_user_id <> auth.uid() then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;

  perform public.rider_require_active_membership(v_offer.business_id);

  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_offer.order_id and rider_user_id = auth.uid()
     and operation = 'accept_offer' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;

  if v_offer.status = 'accepted' then
    return jsonb_build_object(
      'ok', true, 'code', 'already_accepted', 'idempotent_no_op', true,
      'order', public.rider_active_delivery_payload(v_offer.order_id)
    );
  end if;
  if v_offer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available', 'offer_status', v_offer.status);
  end if;
  if v_offer.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'stale_version', 'version', v_offer.version);
  end if;

  v_active := public.count_rider_active_orders(v_offer.business_id, auth.uid(), v_offer.order_id);
  if v_active >= v_max then
    return jsonb_build_object(
      'ok', false, 'code', 'at_capacity',
      'active_orders', v_active, 'max_active_orders', v_max
    );
  end if;

  select o.* into v_order from public.orders o where o.id = v_offer.order_id for update;

  -- La disponibilidad se mira ANTES que la revision, y el orden importa.
  -- Cualquier movimiento del pedido sube la revision, asi que con el orden
  -- inverso `stale_revision` tapaba todo y los otros dos codigos eran letra
  -- muerta. El Rider necesita distinguir «ya no esta» —no reintentes— de
  -- «cambio» —actualiza y volve a mirar—.
  if v_order.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'order_unavailable', 'order_status', v_order.status);
  end if;
  if v_order.assigned_rider_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'order_taken', 'revision', v_order.revision);
  end if;
  if v_order.revision <> v_offer.expected_order_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision);
  end if;

  update public.rider_order_offers
     set status = 'accepted', responded_at = v_now, version = version + 1
   where id = v_offer.id and status = 'pending'
  returning * into v_offer;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available');
  end if;

  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id
     and revision = v_offer.expected_order_revision
     and assigned_rider_user_id is null
     and status = 'ready';
  if not found then
    raise exception 'carrera de asignacion detectada' using errcode = '40001';
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id, v_order.business_id, auth.uid(), 'rider', 'rider', auth.uid(),
    'order.rider_accepted_offer', 'order.rider_accepted_offer', 'El rider acepto la entrega',
    jsonb_build_object('offer_id', v_offer.id, 'rider_active_orders', v_active + 1, 'rider_max_active_orders', v_max),
    jsonb_build_object('offer_id', v_offer.id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'code', 'accepted',
    'idempotent_no_op', false,
    'active_orders', v_active + 1,
    'max_active_orders', v_max,
    'order', public.rider_active_delivery_payload(v_order.id)
  );

  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (
    v_order.id, auth.uid(), 'accept_offer', v_key,
    digest(jsonb_build_object('offer_id', v_offer.id, 'version', p_expected_version)::text, 'sha256'),
    v_result
  );

  return v_result;
end;
$$;

-- ===========================================================================
-- 6. El Rider rechaza
-- ===========================================================================
-- Terminal para ese Rider. El pedido NO se movio nunca, asi que no hay nada que
-- revertir: sigue `ready` y sin rider, y el Panel puede ofrecerselo a otro.
-- No se auto-asigna a nadie.

create or replace function public.reject_rider_order_offer(
  p_offer_id uuid,
  p_expected_version bigint,
  p_reason_code text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_offer public.rider_order_offers%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_reason text := nullif(lower(btrim(coalesce(p_reason_code, ''))), '');
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_offer_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception 'reject invalido' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if v_reason is not null
    and v_reason not in ('too_far', 'vehicle_problem', 'load_too_big', 'ending_shift', 'other') then
    raise exception 'motivo de rechazo invalido' using errcode = '22023';
  end if;

  select f.* into v_offer from public.rider_order_offers f where f.id = p_offer_id for update;
  if not found or v_offer.rider_user_id <> auth.uid() then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;

  perform public.rider_require_active_membership(v_offer.business_id);

  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_offer.order_id and rider_user_id = auth.uid()
     and operation = 'reject_offer' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;

  if v_offer.status = 'rejected' then
    return jsonb_build_object('ok', true, 'code', 'already_rejected', 'idempotent_no_op', true);
  end if;
  if v_offer.status = 'accepted' then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if v_offer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available', 'offer_status', v_offer.status);
  end if;
  if v_offer.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'stale_version', 'version', v_offer.version);
  end if;

  update public.rider_order_offers
     set status = 'rejected', responded_at = v_now, response_reason = v_reason, version = version + 1
   where id = v_offer.id and status = 'pending'
  returning * into v_offer;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available');
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_offer.order_id, v_offer.business_id, auth.uid(), 'rider', 'rider', auth.uid(),
    'order.rider_rejected_offer', 'order.rider_rejected_offer', 'El rider rechazo la entrega',
    jsonb_build_object('offer_id', v_offer.id, 'reason_code', v_reason),
    jsonb_build_object('offer_id', v_offer.id, 'reason_code', v_reason)
  );

  v_result := jsonb_build_object('ok', true, 'code', 'rejected', 'idempotent_no_op', false);

  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (
    v_offer.order_id, auth.uid(), 'reject_offer', v_key,
    digest(jsonb_build_object('offer_id', v_offer.id, 'version', p_expected_version)::text, 'sha256'),
    v_result
  );

  return v_result;
end;
$$;

-- ===========================================================================
-- 7. Una sola lectura para el Rider
-- ===========================================================================
-- Reemplaza el par (get_active_rider_delivery, get_rider_queue) por UNA foto.
-- Tres pedidos activos no pueden costar tres consultas: la app poll-ea esto y
-- nada mas.
--
-- `get_active_rider_delivery` NO se toca y sigue devolviendo uno: es lo que
-- llama la app instalada, y romperla desde el servidor no es parte de esto.

create or replace function public.get_rider_delivery_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_business_id uuid;
  v_max integer := public.rider_max_active_orders();
  v_orders jsonb;
  v_offers jsonb;
  v_active integer;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;

  -- Solo para saber CONTRA QUE comercio preguntar. La autorizacion es la linea
  -- siguiente, y ocurre antes de mirar un solo pedido: misma leccion que
  -- 20260812100000.
  select bm.business_id into v_business_id
    from public.business_members bm
   where bm.user_id = auth.uid() and bm.role = 'rider' and bm.is_active = true
   order by bm.created_at
   limit 1;

  if v_business_id is null then
    raise exception 'membership rider activa requerida' using errcode = '42501';
  end if;

  perform public.rider_require_active_membership(v_business_id);

  select coalesce(jsonb_agg(payload order by rank, updated_at, id), '[]'::jsonb)
    into v_orders
    from (
      select
        o.id,
        o.updated_at,
        -- Orden visual simple y predecible: por etapa y despues por antiguedad.
        -- No afirma cual entregar primero; solo evita que la lista salte.
        case o.status
          when 'arrived' then 0
          when 'on_the_way' then 1
          when 'picked_up' then 2
          else 3
        end as rank,
        public.rider_active_delivery_payload(o.id) as payload
      from public.orders o
      where o.business_id = v_business_id
        and o.assigned_rider_user_id = auth.uid()
        and o.delivery_mode = 'delivery'
        and o.status = any (public.rider_active_order_statuses())
    ) active_orders;

  select coalesce(jsonb_agg(public.rider_offer_payload(f.id) order by f.offered_at, f.id), '[]'::jsonb)
    into v_offers
    from public.rider_order_offers f
    join public.orders o on o.id = f.order_id
   where f.rider_user_id = auth.uid()
     and f.business_id = v_business_id
     and f.status = 'pending'
     -- Una oferta sobre un pedido que ya se movio no es una decision que el
     -- Rider pueda tomar. No se le muestra.
     and o.status = 'ready'
     and o.assigned_rider_user_id is null;

  v_active := jsonb_array_length(v_orders);

  return jsonb_build_object(
    'version', 1,
    'server_now', clock_timestamp(),
    'max_active_orders', v_max,
    'active_orders', v_active,
    'at_capacity', v_active >= v_max,
    'orders', v_orders,
    'offers', case when v_active >= v_max then '[]'::jsonb else v_offers end
  );
end;
$$;

comment on function public.get_rider_delivery_board() is
  'Foto unica del Rider: hasta rider_max_active_orders() pedidos aceptados y sus ofertas pendientes.';

-- ===========================================================================
-- 8. Una ubicacion, N pedidos
-- ===========================================================================
-- Un Rider tiene UNA posicion fisica. Con tres entregas activas eso no puede
-- convertirse en tres adquisiciones de GPS ni en tres llamadas: se toma una
-- muestra y el servidor la reparte a los pedidos que corresponde.
--
-- Cada pedido conserva su propia fila en rider_locations, que es lo que hace
-- que `get_public_order_tracking` siga aislando por order_id y que el cliente A
-- no pueda ver nada del pedido B. El reparto NO relaja una sola validacion:
-- delega en publish_rider_location_receipt, que sigue verificando asignacion,
-- estado, revision, precision, salto imposible y throttle POR PEDIDO.

create or replace function public.publish_rider_location_fanout(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_heading double precision,
  p_speed double precision,
  p_captured_at timestamptz,
  p_idempotency_key text,
  p_is_mock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_business_id uuid;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_order record;
  v_receipts jsonb := '[]'::jsonb;
  v_accepted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;

  select bm.business_id into v_business_id
    from public.business_members bm
   where bm.user_id = auth.uid() and bm.role = 'rider' and bm.is_active = true
   order by bm.created_at
   limit 1;
  if v_business_id is null then
    raise exception 'membership rider activa requerida' using errcode = '42501';
  end if;
  perform public.rider_require_active_membership(v_business_id);

  for v_order in
    select o.id, o.revision
      from public.orders o
     where o.business_id = v_business_id
       and o.assigned_rider_user_id = auth.uid()
       and o.delivery_mode = 'delivery'
       and o.status in ('on_the_way', 'arrived')
     order by o.id
  loop
    declare
      v_receipt jsonb;
    begin
      v_receipt := public.publish_rider_location_receipt(
        v_order.id,
        v_order.revision,
        p_lat, p_lng, p_accuracy, p_heading, p_speed, p_captured_at,
        -- La clave del cliente es una sola por muestra; el recibo por pedido se
        -- deriva de ella. Asi un reintento de la misma muestra sigue siendo
        -- idempotente en cada pedido por separado.
        left(v_key || '-' || replace(v_order.id::text, '-', ''), 128),
        p_is_mock
      );
      if coalesce((v_receipt ->> 'ok')::boolean, false) then v_accepted := v_accepted + 1; end if;
      v_receipts := v_receipts || jsonb_build_array(
        v_receipt || jsonb_build_object('order_id', v_order.id)
      );
    end;
  end loop;

  return jsonb_build_object(
    'version', 1,
    'ok', v_accepted > 0,
    'published', v_accepted,
    'targets', jsonb_array_length(v_receipts),
    'receipts', v_receipts
  );
end;
$$;

comment on function public.publish_rider_location_fanout(double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) is
  'Una muestra de GPS repartida a los pedidos publicables del Rider. Cada pedido conserva su fila y su aislamiento.';

-- ===========================================================================
-- 9. El Panel ve el estado de la oferta y la capacidad
-- ===========================================================================

create or replace function public.list_rider_order_offers(p_business_id uuid)
returns table (
  offer_id uuid,
  order_id uuid,
  public_code text,
  rider_user_id uuid,
  rider_display_name text,
  status text,
  version bigint,
  offered_at timestamptz,
  responded_at timestamptz,
  response_reason text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if auth.uid() is null
    or p_business_id is null
    or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  return query
  select
    f.id,
    f.order_id,
    o.public_code,
    f.rider_user_id,
    left(coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      'Rider ' || upper(right(f.rider_user_id::text, 8))
    ), 80),
    f.status,
    f.version,
    f.offered_at,
    f.responded_at,
    f.response_reason
  from public.rider_order_offers f
  join public.orders o on o.id = f.order_id
  left join auth.users u on u.id = f.rider_user_id
  where f.business_id = p_business_id
    and (f.status = 'pending' or f.responded_at >= clock_timestamp() - interval '12 hours')
  order by f.offered_at desc
  limit 200;
end;
$$;

-- `list_active_business_riders` gana capacidad. Las dos primeras columnas y su
-- orden no cambian, asi que el Panel actual sigue leyendola igual. Cambia la
-- forma del RETURNS TABLE, asi que hay que soltarla antes: `create or replace`
-- no puede cambiar el tipo de retorno.
drop function if exists public.list_active_business_riders(uuid);

create or replace function public.list_active_business_riders(p_business_id uuid)
returns table (
  rider_user_id uuid,
  display_name text,
  active_orders integer,
  max_active_orders integer,
  pending_offers integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if auth.uid() is null
    or p_business_id is null
    or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  return query
  select
    bm.user_id,
    left(
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        'Rider ' || upper(right(bm.user_id::text, 8))
      ),
      80
    ),
    -- Autoritativa, derivada de los pedidos. El Panel la muestra; el servidor
    -- la vuelve a calcular en cada aceptacion. El Panel no decide nada.
    public.count_rider_active_orders(p_business_id, bm.user_id, null),
    public.rider_max_active_orders(),
    (
      select count(*)::integer from public.rider_order_offers f
       where f.business_id = p_business_id and f.rider_user_id = bm.user_id and f.status = 'pending'
    )
  from public.business_members bm
  left join auth.users u on u.id = bm.user_id
  where bm.business_id = p_business_id
    and bm.role = 'rider'
    and bm.is_active = true
  order by 2, bm.user_id
  limit 100;
end;
$$;

-- ===========================================================================
-- 10. Grants: cada RPC a su rol, y nada mas
-- ===========================================================================

revoke execute on function public.rider_offer_payload(uuid) from public, anon, authenticated;
revoke execute on function public.touch_rider_order_offer() from public, anon, authenticated;

revoke execute on function public.offer_order_to_rider(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.withdraw_rider_order_offer(uuid) from public, anon, authenticated;
revoke execute on function public.accept_rider_order_offer(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function public.reject_rider_order_offer(uuid, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.get_rider_delivery_board() from public, anon, authenticated;
revoke execute on function public.publish_rider_location_fanout(double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) from public, anon, authenticated;
revoke execute on function public.list_rider_order_offers(uuid) from public, anon, authenticated;
revoke execute on function public.list_active_business_riders(uuid) from public, anon, authenticated;

grant execute on function public.offer_order_to_rider(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.withdraw_rider_order_offer(uuid) to authenticated;
grant execute on function public.accept_rider_order_offer(uuid, bigint, text) to authenticated;
grant execute on function public.reject_rider_order_offer(uuid, bigint, text, text) to authenticated;
grant execute on function public.get_rider_delivery_board() to authenticated;
grant execute on function public.publish_rider_location_fanout(double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) to authenticated;
grant execute on function public.list_rider_order_offers(uuid) to authenticated;
grant execute on function public.list_active_business_riders(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
