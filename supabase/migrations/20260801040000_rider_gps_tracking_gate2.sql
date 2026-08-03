-- TABA Gate 2: atomic rider handoff, server-authoritative GPS and tracking.
--
-- This migration is intentionally additive after Gate 1. It does not replace
-- orders.revision, order_events.sequence, transition_order or the canonical
-- arriving -> arrived vocabulary. It composes with those contracts.

-- ===== 1. Rider payload and queue carry the Gate 1 revision =====

-- The previous serializer included a raw rider_locations array. That was an
-- unnecessary history surface. The rider receives the order needed to operate
-- it, while GPS is returned only by the dedicated RPC as the latest fix.
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
           'revision', o.revision,
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
           )
         ))
    from public.orders o
   where o.id = p_order_id
$$;

drop function if exists public.list_available_rider_orders(uuid);
create function public.list_available_rider_orders(p_business_id uuid)
returns table (
  public_code text,
  general_zone text,
  pickup_branch text,
  approximate_packages integer,
  payment_method text,
  collection_amount numeric,
  estimated_minutes integer,
  operational_restrictions text,
  revision bigint
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
    end,
    o.revision
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

-- Replace the old four-argument contract. There must not remain a callable
-- path that can claim without the Gate 1 revision.
drop function if exists public.claim_available_rider_order(uuid, text, text, uuid);
create function public.claim_available_rider_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_revision bigint,
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
  v_expected_status text := public.normalize_order_status_vocabulary(p_expected_status);
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
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'expected_revision requerido' using errcode = '22023';
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

  -- A second tap from the same rider is a successful no-op, even when both
  -- taps carried the same old revision. A different rider never receives this
  -- exception path and is rejected below.
  if v_order.assigned_rider_user_id = v_user_id
    and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id)
      || jsonb_build_object('idempotent_no_op', true);
  end if;

  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;
  if v_expected_status <> 'ready'
    or v_order.status <> v_expected_status
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id
    or v_order.assigned_rider_user_id is not null then
    raise exception 'conflicto de asignacion: estado, revision o rider esperado cambio'
      using errcode = '40001';
  end if;

  update public.orders
     set assigned_rider_user_id = v_user_id,
         status = 'assigned'
   where id = v_order.id
     and revision = p_expected_revision
     and status = 'ready'
     and assigned_rider_user_id is null;

  if not found then
    raise exception 'conflicto de asignacion: otro rider gano la carrera'
      using errcode = '40001';
  end if;

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
      'next_rider_user_id', v_user_id,
      'expected_revision', p_expected_revision
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', v_user_id,
      'expected_revision', p_expected_revision
    )
  );

  return public.rider_order_rpc_payload(v_order.id)
    || jsonb_build_object('idempotent_no_op', false);
end;
$$;

-- ===== 2. Rider-only start of delivery, composed with Gate 1 CAS =====

create or replace function public.start_rider_delivery(
  p_order_id uuid,
  p_expected_revision bigint
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
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'pedido y expected_revision requeridos' using errcode = '22023';
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
  if not found then
    raise exception 'rol rider requerido para iniciar el reparto' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery'
    or v_order.assigned_rider_user_id is distinct from v_user_id then
    raise exception 'solo el rider asignado puede iniciar el reparto'
      using errcode = '42501';
  end if;

  -- A repeated tap after the first transition is harmless and produces no
  -- second event or revision bump.
  if v_order.status = 'on_the_way' then
    return public.rider_order_rpc_payload(v_order.id)
      || jsonb_build_object('idempotent_no_op', true);
  end if;
  if v_order.status not in ('assigned', 'picked_up') then
    raise exception 'estado invalido para iniciar el reparto: %', v_order.status
      using errcode = '40001';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;

  -- Gate 1 remains the sole transition authority: it checks revision and then
  -- delegates actor/business/transition rules to change_order_status.
  perform public.transition_order(
    v_order.id,
    p_expected_revision,
    'on_the_way'
  );

  return public.rider_order_rpc_payload(v_order.id)
    || jsonb_build_object('idempotent_no_op', false);
end;
$$;

-- ===== 3. GPS schema: server time, total sample order and order revision =====

create sequence if not exists public.rider_locations_sequence_seq as bigint;

alter table public.rider_locations
  add column if not exists sequence bigint;

alter table public.rider_locations
  add column if not exists order_revision bigint;

alter table public.rider_locations
  add column if not exists recorded_at timestamptz;

alter table public.rider_locations
  add column if not exists captured_at timestamptz;

update public.rider_locations rl
   set order_revision = o.revision
  from public.orders o
 where o.id = rl.order_id
   and rl.order_revision is null;

update public.rider_locations
   set recorded_at = coalesce(created_at, clock_timestamp())
 where recorded_at is null;

update public.rider_locations rl
   set sequence = ordered.row_number
  from (
    select id, row_number() over (order by coalesce(recorded_at, created_at), id) as row_number
      from public.rider_locations
  ) as ordered
 where rl.id = ordered.id
   and rl.sequence is null;

-- A legacy location can only be retained when it belongs to a versioned order.
-- The staging database has no such rows today, but this keeps the migration
-- fail-closed if an old row is present.
alter table public.rider_locations
  alter column order_revision set not null;

select setval(
  'public.rider_locations_sequence_seq',
  greatest(coalesce((select max(sequence) from public.rider_locations), 0), 1),
  true
);

alter table public.rider_locations
  alter column sequence set default nextval('public.rider_locations_sequence_seq');

alter table public.rider_locations
  alter column sequence set not null;

alter table public.rider_locations
  alter column recorded_at set default clock_timestamp();

alter table public.rider_locations
  alter column recorded_at set not null;

alter sequence public.rider_locations_sequence_seq
  owned by public.rider_locations.sequence;

alter table public.rider_locations
  drop constraint if exists rider_locations_sequence_positive;

alter table public.rider_locations
  add constraint rider_locations_sequence_positive
  check (sequence > 0);

alter table public.rider_locations
  drop constraint if exists rider_locations_order_revision_positive;

alter table public.rider_locations
  add constraint rider_locations_order_revision_positive
  check (order_revision > 0);

create unique index if not exists rider_locations_sequence_key
  on public.rider_locations (sequence);

create index if not exists rider_locations_order_sequence_idx
  on public.rider_locations (order_id, sequence desc);

create index if not exists rider_locations_order_recorded_at_idx
  on public.rider_locations (order_id, recorded_at desc);

create or replace function public.stamp_rider_location_server_time()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  new.recorded_at := clock_timestamp();
  new.created_at := new.recorded_at;
  return new;
end;
$$;

drop trigger if exists rider_locations_server_time on public.rider_locations;
create trigger rider_locations_server_time
before insert on public.rider_locations
for each row execute function public.stamp_rider_location_server_time();

-- ===== 4. Authoritative GPS publication =====

drop function if exists public.publish_rider_location(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision
);

create function public.publish_rider_location(
  p_order_id uuid,
  p_expected_revision bigint,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_heading double precision default null,
  p_speed double precision default null,
  p_captured_at timestamptz default null
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
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_expected_revision is null
    or p_expected_revision < 1
    or p_lat is null
    or p_lng is null
    or p_accuracy is null
    or p_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or p_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or p_accuracy in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or p_lat < -90
    or p_lat > 90
    or p_lng < -180
    or p_lng > 180
    or p_accuracy < 0
    or p_accuracy > 250
    or (p_heading is not null and (
      p_heading in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      or p_heading < 0
      or p_heading >= 360
    ))
    or (p_speed is not null and (
      p_speed in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      or p_speed < 0
      or p_speed > 70
    )) then
    raise exception 'ubicacion GPS invalida o imprecisa' using errcode = '22023';
  end if;
  if p_captured_at is not null and (
    p_captured_at > v_now + interval '30 seconds'
    or p_captured_at < v_now - interval '3 minutes'
  ) then
    raise exception 'muestra GPS futura o atrasada' using errcode = '22023';
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
    raise exception 'pedido no asignado a este rider o reparto finalizado'
      using errcode = '42501';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision,
      v_order.revision
      using errcode = '40001';
  end if;
  if p_captured_at is not null and exists (
    select 1
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_user_id
       and rl.captured_at is not null
       and rl.captured_at >= p_captured_at
  ) then
    raise exception 'muestra GPS atrasada respecto de la ultima aceptada'
      using errcode = '40001';
  end if;
  if exists (
    select 1
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_user_id
       and rl.source = 'gps'
       and rl.recorded_at > v_now - interval '5 seconds'
  ) then
    raise exception 'ubicacion GPS publicada demasiado pronto' using errcode = 'P0001';
  end if;

  insert into public.rider_locations (
    order_id,
    business_id,
    rider_user_id,
    order_revision,
    lat,
    lng,
    accuracy,
    heading,
    speed,
    captured_at,
    source
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    v_order.revision,
    p_lat,
    p_lng,
    p_accuracy,
    p_heading,
    p_speed,
    p_captured_at,
    'gps'
  )
  returning * into v_location;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', v_location.id,
    'order_id', v_location.order_id,
    'business_id', v_location.business_id,
    'rider_user_id', v_location.rider_user_id,
    'order_revision', v_location.order_revision,
    'sequence', v_location.sequence,
    'lat', v_location.lat,
    'lng', v_location.lng,
    'accuracy', v_location.accuracy,
    'heading', v_location.heading,
    'speed', v_location.speed,
    'source', 'gps',
    'recorded_at', v_location.recorded_at,
    'created_at', v_location.recorded_at
  ));
end;
$$;

-- ===== 5. Minimized public snapshot, ordered by server sequence =====

create or replace function public.get_public_order_tracking(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_raw_token text := public.request_order_token();
  v_token_hash bytea := public.request_order_token_hash();
  v_order public.orders%rowtype;
  v_terminal_visible_until timestamptz;
  v_location jsonb;
  v_delivery_code text;
  v_code_confirmed_at timestamptz;
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
     and (
       o.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
       or (
         opt.terminal_visible_until is not null
         and opt.terminal_visible_until > clock_timestamp()
       )
     )
   limit 1;

  if not found then return null; end if;

  select opt.terminal_visible_until
    into v_terminal_visible_until
    from public.order_public_tokens opt
   where opt.order_id = v_order.id
     and opt.token_hash = v_token_hash
   limit 1;

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
      'sequence', rl.sequence,
      'recorded_at', rl.recorded_at,
      'created_at', rl.recorded_at
    )
      into v_location
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_order.assigned_rider_user_id
       and rl.order_revision <= v_order.revision
       and rl.source = 'gps'
       and rl.accuracy is not null
       and rl.accuracy between 0 and 250
       and rl.recorded_at >= clock_timestamp() - interval '3 minutes'
       and rl.recorded_at <= clock_timestamp() + interval '30 seconds'
     order by rl.sequence desc
     limit 1;
  end if;

  if v_order.status = 'arrived' then
    begin
      select case
               when h.confirmed_at is null
                 then pgp_sym_decrypt(h.code_ciphertext, v_raw_token)
               else null
             end,
             h.confirmed_at
        into v_delivery_code, v_code_confirmed_at
        from public.order_delivery_handoffs h
       where h.order_id = v_order.id
         and h.expires_at > clock_timestamp();
    exception when others then
      v_delivery_code := null;
      v_code_confirmed_at := null;
    end;
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
    'terminal_visible_until', case
      when v_order.status in ('delivered', 'canceled', 'cancelled', 'rejected')
        then v_terminal_visible_until
      else null
    end,
    'estimated_arrival_at', case when v_reliable_eta then v_order.estimated_arrival_at else null end,
    'estimated_arrival_source', case when v_reliable_eta then v_order.estimated_arrival_source else null end,
    'estimated_arrival_updated_at', case when v_reliable_eta then v_order.estimated_arrival_updated_at else null end,
    'estimated_minutes', case
      when v_reliable_eta then greatest(
        1,
        ceil(extract(epoch from (v_order.estimated_arrival_at - clock_timestamp())) / 60.0)
      )::integer
      else null
    end,
    'rider_location', v_location,
    'delivery_code', v_delivery_code,
    'delivery_code_confirmed_at', v_code_confirmed_at
  ));
end;
$$;

-- ===== 6. RLS/privileges: only SECURITY DEFINER paths can touch GPS =====

drop policy if exists "production rider locations readable with order"
on public.rider_locations;
drop policy if exists "tracking rider locations readable by operators"
on public.rider_locations;
drop policy if exists "operational rider locations readable with order"
on public.rider_locations;
drop policy if exists "production assigned rider writes gps"
on public.rider_locations;
drop policy if exists "operational assigned rider writes gps"
on public.rider_locations;
drop policy if exists "phase1 public read rider locations"
on public.rider_locations;
drop policy if exists "phase1 public create rider locations"
on public.rider_locations;

revoke all privileges on table public.rider_locations from public, anon, authenticated;
revoke all on table public.rider_locations from public, anon, authenticated;

revoke all on function public.rider_order_rpc_payload(uuid)
from public, anon, authenticated;

revoke all on function public.list_available_rider_orders(uuid)
from public, anon;
grant execute on function public.list_available_rider_orders(uuid)
to authenticated;

revoke all on function public.claim_available_rider_order(
  uuid, text, bigint, text, uuid
)
from public, anon;
grant execute on function public.claim_available_rider_order(
  uuid, text, bigint, text, uuid
)
to authenticated;

revoke all on function public.start_rider_delivery(uuid, bigint)
from public, anon;
grant execute on function public.start_rider_delivery(uuid, bigint)
to authenticated;

revoke all on function public.publish_rider_location(
  uuid,
  bigint,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  timestamptz
)
from public, anon;
grant execute on function public.publish_rider_location(
  uuid,
  bigint,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  timestamptz
)
to authenticated;

revoke all on function public.get_public_order_tracking(text)
from public;
grant execute on function public.get_public_order_tracking(text)
to anon, authenticated;

comment on column public.rider_locations.sequence is
  'Orden total de muestras GPS; admite huecos pero nunca duplicados.';

comment on column public.rider_locations.order_revision is
  'Revision de orders validada al publicar la muestra; evita publicar sobre una vista vieja.';

comment on column public.rider_locations.recorded_at is
  'Marca de recepcion generada por PostgreSQL; el cliente no puede elegirla.';

comment on column public.rider_locations.captured_at is
  'Marca declarada por el dispositivo, solo para rechazar muestras futuras o atrasadas; no es la autoridad temporal.';

comment on function public.claim_available_rider_order(
  uuid, text, bigint, text, uuid
) is
  'Toma atomica de rider por revision, con un solo ganador y no-op idempotente para doble toque del mismo rider.';

comment on function public.start_rider_delivery(uuid, bigint) is
  'Inicio de reparto exclusivo del rider asignado; usa revision CAS y delega la transicion en Gate 1.';

comment on function public.publish_rider_location(
  uuid,
  bigint,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  timestamptz
) is
  'Publicacion GPS exclusiva por RPC, con revision, timestamp servidor, calidad, orden total, antiguedad y frecuencia.';

comment on function public.get_public_order_tracking(text) is
  'DTO minimo tokenizado: solo snapshot actual del rider asignado, con secuencia, freshness y ventana terminal acotada.';
