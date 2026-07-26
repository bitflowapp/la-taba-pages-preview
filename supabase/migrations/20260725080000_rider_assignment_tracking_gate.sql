-- TABA rider assignment + public tracking integrity gate.
-- Apply after 20260725070000_catalog_category_authority.sql.
--
-- This migration is additive. Historical migrations remain immutable while the
-- effective RPC contracts below close the rider-claim gap and keep public
-- tracking fail-closed.

-- ETA is optional operational metadata. Browser roles cannot update orders
-- directly, so only a trusted backend process may populate these fields.
alter table public.orders
  add column if not exists estimated_arrival_at timestamptz;

alter table public.orders
  add column if not exists estimated_arrival_source text;

alter table public.orders
  add column if not exists estimated_arrival_updated_at timestamptz;

alter table public.orders
  drop constraint if exists orders_estimated_arrival_source_check;

alter table public.orders
  add constraint orders_estimated_arrival_source_check
  check (
    estimated_arrival_source is null
    or estimated_arrival_source in ('business', 'routing')
  );

alter table public.orders
  drop constraint if exists orders_estimated_arrival_metadata_consistent;

alter table public.orders
  add constraint orders_estimated_arrival_metadata_consistent
  check (
    (
      estimated_arrival_at is null
      and estimated_arrival_source is null
      and estimated_arrival_updated_at is null
    )
    or (
      estimated_arrival_at is not null
      and estimated_arrival_source is not null
      and estimated_arrival_updated_at is not null
    )
  );

-- The operational trigger previously omitted arrived_at. Keep all existing
-- timestamp behavior and add the missing arrival timestamp.
create or replace function public.set_order_status_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'accepted' and new.accepted_at is null then
      new.accepted_at := clock_timestamp();
    end if;
    if new.status = 'preparing' and new.preparing_at is null then
      new.preparing_at := clock_timestamp();
    end if;
    if new.status = 'ready' and new.ready_at is null then
      new.ready_at := clock_timestamp();
    end if;
    if new.status in ('on_the_way', 'picked_up') then
      new.dispatched_at := coalesce(new.dispatched_at, clock_timestamp());
      new.picked_up_at := coalesce(new.picked_up_at, new.dispatched_at);
    end if;
    if new.status in ('arrived', 'arriving') and new.arrived_at is null then
      new.arrived_at := clock_timestamp();
    end if;
    if new.status = 'delivered' and new.delivered_at is null then
      new.delivered_at := clock_timestamp();
    end if;
    if new.status in ('cancelled', 'canceled') then
      new.cancelled_at := coalesce(new.cancelled_at, clock_timestamp());
      new.canceled_at := coalesce(new.canceled_at, new.cancelled_at);
    end if;
    if new.status = 'rejected' and new.rejected_at is null then
      new.rejected_at := clock_timestamp();
    end if;
  end if;

  return new;
end;
$$;

-- Internal serializer used only by SECURITY DEFINER order RPCs. It is never
-- granted to browser roles because it contains the assigned order's PII.
create or replace function public.rider_order_rpc_payload(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'id', o.id,
           'public_code', o.public_code,
           'status', o.status,
           'delivery_mode', o.delivery_mode,
           'customer_name', o.customer_name,
           'customer_phone', o.customer_phone,
           'address_label', o.address_label,
           'customer_street_address', o.customer_street_address,
           'customer_neighborhood', o.customer_neighborhood,
           'customer_reference', o.customer_reference,
           'customer_notes', o.customer_notes,
           'payment_method', o.payment_method,
           'subtotal', o.subtotal,
           'delivery_fee', o.delivery_fee,
           'total', o.total,
           'currency_code', o.currency_code,
           'assigned_rider_user_id', o.assigned_rider_user_id,
           'age_confirmation_policy', o.age_confirmation_policy,
           'created_at', o.created_at,
           'updated_at', o.updated_at,
           'accepted_at', o.accepted_at,
           'preparing_at', o.preparing_at,
           'ready_at', o.ready_at,
           'dispatched_at', o.dispatched_at,
           'picked_up_at', o.picked_up_at,
           'arrived_at', o.arrived_at,
           'delivered_at', o.delivered_at,
           'cancelled_at', o.cancelled_at,
           'canceled_at', o.canceled_at,
           'rejected_at', o.rejected_at,
           'estimated_arrival_at', o.estimated_arrival_at,
           'estimated_arrival_source', o.estimated_arrival_source,
           'estimated_arrival_updated_at', o.estimated_arrival_updated_at,
           'order_items', coalesce(
             (
               select jsonb_agg(
                        jsonb_strip_nulls(jsonb_build_object(
                          'product_uuid', oi.product_uuid,
                          'product_id', oi.product_id,
                          'name', oi.name,
                          'quantity', oi.quantity,
                          'unit', oi.unit,
                          'unit_price', oi.unit_price
                        ))
                        order by oi.created_at, oi.id
                      )
                 from public.order_items oi
                where oi.order_id = o.id
             ),
             '[]'::jsonb
           ),
           'rider_locations', coalesce(
             (
               select jsonb_agg(
                        jsonb_build_object(
                          'lat', latest.lat,
                          'lng', latest.lng,
                          'accuracy', latest.accuracy,
                          'heading', latest.heading,
                          'speed', latest.speed,
                          'source', 'gps',
                          'created_at', latest.created_at
                        )
                      )
                 from (
                   select
                     rl.lat,
                     rl.lng,
                     rl.accuracy,
                     rl.heading,
                     rl.speed,
                     rl.created_at
                   from public.rider_locations rl
                  where rl.order_id = o.id
                    and rl.rider_user_id = o.assigned_rider_user_id
                    and rl.source = 'gps'
                  order by rl.created_at desc, rl.id desc
                  limit 1
                 ) as latest
             ),
             '[]'::jsonb
           )
         ))
    from public.orders o
   where o.id = p_order_id
$$;

-- Minimized queue for a rider before assignment. It deliberately excludes the
-- internal order UUID, exact customer address, customer identity and contact
-- details. ETA is NULL unless trusted, fresh metadata exists.
create or replace function public.list_available_rider_orders(p_business_id uuid)
returns table (
  public_code text,
  general_zone text,
  pickup_branch text,
  approximate_packages integer,
  payment_method text,
  collection_amount numeric,
  estimated_minutes integer,
  operational_restrictions text
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select
    o.public_code,
    nullif(btrim(o.customer_neighborhood), ''),
    b.address,
    greatest(
      1,
      ceil(coalesce(sum(oi.quantity), 0)::numeric / 3.0)
    )::integer,
    o.payment_method,
    case when o.payment_method = 'cash' then o.total else null end,
    case
      when o.estimated_arrival_source in ('business', 'routing')
       and o.estimated_arrival_updated_at >= statement_timestamp() - interval '15 minutes'
       and o.estimated_arrival_updated_at <= statement_timestamp() + interval '30 seconds'
       and o.estimated_arrival_at > statement_timestamp()
      then greatest(
        1,
        ceil(extract(epoch from (o.estimated_arrival_at - statement_timestamp())) / 60.0)
      )::integer
      else null
    end,
    case
      when o.age_confirmation_policy is not null
        then 'Verificar mayoría de edad al entregar'
      else null
    end
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join public.order_items oi on oi.order_id = o.id
  where o.business_id = p_business_id
    and public.has_business_role(p_business_id, array['rider'])
    and o.delivery_mode = 'delivery'
    and o.status = 'ready'
    and o.assigned_rider_user_id is null
  group by o.id, b.address
  order by o.ready_at nulls last, o.created_at
  limit 50
$$;

-- Atomic self-claim by public code. The queue never exposes the internal UUID;
-- after the claim succeeds, the rider is authorized to receive the full row.
-- FOR UPDATE plus both expected status and expected assignee produce one winner
-- when two riders claim the same order concurrently.
create or replace function public.claim_available_rider_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_status text default 'ready',
  p_expected_rider_user_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_business_id is null
    or not public.has_business_role(p_business_id, array['rider']) then
    raise exception 'rol rider requerido para este negocio' using errcode = '42501';
  end if;
  if p_public_code is null or btrim(p_public_code) = '' then
    raise exception 'public_code requerido' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rol rider requerido para este negocio' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;
  if v_expected_status <> 'ready'
    or v_order.status <> v_expected_status
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id
    or v_order.assigned_rider_user_id is not null then
    raise exception 'conflicto de asignacion: estado o rider esperado cambio'
      using errcode = '40001';
  end if;

  update public.orders
     set assigned_rider_user_id = v_user_id,
         status = 'assigned'
   where id = v_order.id;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    'rider',
    'rider',
    v_user_id,
    'order.rider_claimed',
    'order.rider_claimed',
    'Pedido tomado por un rider autenticado',
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', v_user_id
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', v_user_id
    )
  );

  return public.rider_order_rpc_payload(v_order.id);
end;
$$;

-- Business-side assignment and reassignment. Reassignment is restricted to
-- ready/assigned orders, before pickup, and compares both status and current
-- assignee under a row lock.
create or replace function public.assign_order_rider(
  p_order_id uuid,
  p_expected_status text,
  p_expected_rider_user_id uuid,
  p_new_rider_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_new_rider_user_id is null then
    raise exception 'order_id y rider requeridos' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role in ('owner', 'admin', 'staff')
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rol de negocio requerido' using errcode = '42501';
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

  update public.orders
     set assigned_rider_user_id = p_new_rider_user_id,
         status = 'assigned'
   where id = v_order.id;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    'business',
    'business',
    v_user_id,
    case
      when v_order.assigned_rider_user_id is null
        then 'order.rider_assigned'
      else 'order.rider_reassigned'
    end,
    case
      when v_order.assigned_rider_user_id is null
        then 'order.rider_assigned'
      else 'order.rider_reassigned'
    end,
    case
      when v_order.assigned_rider_user_id is null
        then 'Rider asignado por el negocio'
      else 'Rider reasignado por el negocio'
    end,
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    )
  );

  return public.rider_order_rpc_payload(v_order.id);
end;
$$;

-- GPS writes pass through one authoritative path. Direct table INSERT is
-- revoked below. The RPC checks the active assignment, input quality and a
-- server-side minimum interval to limit flooding.
create or replace function public.publish_rider_location(
  p_order_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_heading double precision default null,
  p_speed double precision default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_location public.rider_locations%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_lat is null
    or p_lng is null
    or p_accuracy is null
    or p_lat < -90
    or p_lat > 90
    or p_lng < -180
    or p_lng > 180
    or p_accuracy < 0
    or p_accuracy > 250
    or (p_heading is not null and (p_heading < 0 or p_heading >= 360))
    or (p_speed is not null and (p_speed < 0 or p_speed > 70)) then
    raise exception 'ubicacion GPS invalida o imprecisa' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = v_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found
    or v_order.delivery_mode <> 'delivery'
    or v_order.assigned_rider_user_id is distinct from v_user_id
    or v_order.status not in ('assigned', 'picked_up', 'on_the_way', 'arrived') then
    raise exception 'pedido no asignado a este rider' using errcode = '42501';
  end if;
  if exists (
    select 1
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_user_id
       and rl.source = 'gps'
       and rl.created_at > clock_timestamp() - interval '5 seconds'
  ) then
    raise exception 'ubicacion GPS publicada demasiado pronto' using errcode = 'P0001';
  end if;

  insert into public.rider_locations (
    order_id,
    business_id,
    rider_user_id,
    lat,
    lng,
    accuracy,
    heading,
    speed,
    source
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    p_lat,
    p_lng,
    p_accuracy,
    p_heading,
    p_speed,
    'gps'
  )
  returning * into v_location;

  return to_jsonb(v_location);
end;
$$;

-- Effective token DTO. GPS is returned only for the currently assigned rider,
-- the requested order, active delivery states, acceptable accuracy and a fresh
-- server timestamp. ETA is omitted unless trusted metadata is current.
create or replace function public.get_public_order_tracking(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_token_hash bytea := public.request_order_token_hash();
  v_order public.orders%rowtype;
  v_location jsonb;
  v_reliable_eta boolean := false;
begin
  if v_token_hash is null or p_public_id is null or btrim(p_public_id) = '' then
    return null;
  end if;

  select o.*
    into v_order
    from public.orders o
    join public.order_public_tokens opt on opt.order_id = o.id
   where (o.id::text = btrim(p_public_id) or o.public_code = btrim(p_public_id))
     and opt.token_hash = v_token_hash
     and opt.revoked_at is null
     and opt.expires_at > clock_timestamp()
   limit 1;

  if not found then return null; end if;

  v_reliable_eta :=
    v_order.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
    and v_order.estimated_arrival_source in ('business', 'routing')
    and v_order.estimated_arrival_updated_at >= clock_timestamp() - interval '15 minutes'
    and v_order.estimated_arrival_updated_at <= clock_timestamp() + interval '30 seconds'
    and v_order.estimated_arrival_at > clock_timestamp();

  if v_order.status in ('picked_up', 'on_the_way', 'arrived')
    and v_order.delivery_mode = 'delivery'
    and v_order.assigned_rider_user_id is not null then
    select jsonb_build_object(
      'lat', round(rl.lat::numeric, 3),
      'lng', round(rl.lng::numeric, 3),
      'accuracy', greatest(100, ceil(rl.accuracy))::integer,
      'source', 'gps',
      'created_at', rl.created_at
    )
      into v_location
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_order.assigned_rider_user_id
       and rl.source = 'gps'
       and rl.accuracy is not null
       and rl.accuracy between 0 and 250
       and rl.created_at >= clock_timestamp() - interval '3 minutes'
       and rl.created_at <= clock_timestamp() + interval '30 seconds'
     order by rl.created_at desc
     limit 1;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'public_code', v_order.public_code,
    'delivery_mode', v_order.delivery_mode,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'accepted_at', v_order.accepted_at,
    'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at,
    'dispatched_at', coalesce(v_order.dispatched_at, v_order.picked_up_at),
    'arrived_at', v_order.arrived_at,
    'delivered_at', v_order.delivered_at,
    'cancelled_at', coalesce(v_order.cancelled_at, v_order.canceled_at),
    'rejected_at', v_order.rejected_at,
    'is_delivered', v_order.status = 'delivered',
    'estimated_arrival_at', case
      when v_reliable_eta then v_order.estimated_arrival_at
      else null
    end,
    'estimated_arrival_source', case
      when v_reliable_eta then v_order.estimated_arrival_source
      else null
    end,
    'estimated_arrival_updated_at', case
      when v_reliable_eta then v_order.estimated_arrival_updated_at
      else null
    end,
    'estimated_minutes', case
      when v_reliable_eta then greatest(
        1,
        ceil(extract(epoch from (v_order.estimated_arrival_at - clock_timestamp())) / 60.0)
      )::integer
      else null
    end,
    'rider_location', v_location
  ));
end;
$$;

-- Assignment audit rows contain Auth UUIDs. Keep them inside the business
-- operational boundary instead of exposing them through customer order access.
drop policy if exists "production order events readable with order"
on public.order_events;

drop policy if exists "production order events readable by business"
on public.order_events;

create policy "production order events readable by business"
on public.order_events for select
to authenticated
using (
  public.has_business_role(
    business_id,
    array['owner', 'admin', 'staff']
  )
);

revoke select on table public.order_events from anon;
revoke insert on table public.rider_locations from authenticated;
revoke select on table public.rider_locations from anon;

revoke all on function public.rider_order_rpc_payload(uuid)
from public, anon, authenticated;

revoke all on function public.list_available_rider_orders(uuid)
from public, anon;
grant execute on function public.list_available_rider_orders(uuid)
to authenticated;

revoke all on function public.claim_available_rider_order(uuid, text, text, uuid)
from public, anon;
grant execute on function public.claim_available_rider_order(uuid, text, text, uuid)
to authenticated;

revoke all on function public.assign_order_rider(uuid, text, uuid, uuid)
from public, anon;
grant execute on function public.assign_order_rider(uuid, text, uuid, uuid)
to authenticated;

revoke all on function public.publish_rider_location(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision
)
from public, anon;
grant execute on function public.publish_rider_location(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision
)
to authenticated;

revoke all on function public.get_public_order_tracking(text)
from public;
grant execute on function public.get_public_order_tracking(text)
to anon, authenticated;

revoke execute on function public.set_order_status_timestamps()
from public, anon, authenticated;

comment on function public.claim_available_rider_order(uuid, text, text, uuid) is
  'Atomic rider self-claim by public code with status + assignee CAS.';

comment on function public.assign_order_rider(uuid, text, uuid, uuid) is
  'Business assignment/reassignment before pickup with row lock and status + assignee CAS.';

comment on function public.publish_rider_location(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision
) is
  'Authorized, accuracy-bounded and rate-limited GPS write for the assigned rider.';

comment on function public.get_public_order_tracking(text) is
  'Minimized token tracking DTO with assigned-rider, active-state, freshness and GPS-quality checks.';
