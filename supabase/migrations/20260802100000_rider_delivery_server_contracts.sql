-- TABA2 Rider end-to-end delivery contract.
--
-- This migration is additive and intentionally leaves prior migrations intact.
-- Stored status vocabulary remains ready/assigned/picked_up/on_the_way/arrived.
-- Public aliases are normalized by normalize_order_status_vocabulary.

create table if not exists public.rider_delivery_operations (
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (
    operation in ('claim', 'picked_up', 'start_route', 'arrived', 'confirm_code', 'report_issue')
  ),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_fingerprint bytea not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (order_id, rider_user_id, operation, idempotency_key)
);

comment on table public.rider_delivery_operations is
  'Persistent idempotency receipts for Rider mutations. Results never contain a delivery code.';

create table if not exists public.delivery_confirmation_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_id uuid not null references auth.users(id) on delete restrict,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  attempted_at timestamptz not null default clock_timestamp(),
  result text not null check (result in ('incorrect_code', 'temporarily_locked', 'confirmed', 'already_delivered')),
  lock_level integer not null default 0 check (lock_level >= 0),
  retry_after_seconds integer,
  unique (order_id, rider_id, request_id)
);

create index if not exists delivery_confirmation_attempts_order_attempted_idx
  on public.delivery_confirmation_attempts (order_id, attempted_at desc);

comment on table public.delivery_confirmation_attempts is
  'Audit-only delivery-code attempts. The submitted code is never stored.';

create table if not exists public.rider_delivery_issues (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_id uuid not null references auth.users(id) on delete restrict,
  issue_type text not null check (issue_type in (
    'customer_unavailable', 'unsafe_location', 'vehicle_problem',
    'wrong_address', 'business_issue', 'payment_issue', 'other'
  )),
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  reported_at timestamptz not null default clock_timestamp(),
  unique (order_id, rider_id, request_id)
);

create index if not exists rider_delivery_issues_order_reported_idx
  on public.rider_delivery_issues (order_id, reported_at desc);

create table if not exists public.delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in ('delivery_confirmed', 'rider_issue_reported')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz,
  unique (order_id, event_type)
);

comment on table public.delivery_outbox is
  'Transactional notification/outbox intent. Dispatching remains asynchronous and idempotent.';

alter table public.rider_locations
  add column if not exists client_request_id text;

alter table public.rider_locations
  add column if not exists receipt_sequence bigint;

create sequence if not exists public.rider_location_receipt_sequence_seq as bigint;

alter table public.rider_locations
  alter column receipt_sequence set default nextval('public.rider_location_receipt_sequence_seq');

update public.rider_locations
   set receipt_sequence = nextval('public.rider_location_receipt_sequence_seq')
 where receipt_sequence is null;

select setval(
  'public.rider_location_receipt_sequence_seq',
  greatest(coalesce((select max(receipt_sequence) from public.rider_locations), 0), 1),
  true
);

alter table public.rider_locations
  alter column receipt_sequence set not null;

create unique index if not exists rider_locations_receipt_sequence_key
  on public.rider_locations (receipt_sequence);

create unique index if not exists rider_locations_client_request_key
  on public.rider_locations (order_id, rider_user_id, client_request_id)
  where client_request_id is not null;

alter table public.rider_delivery_operations enable row level security;
alter table public.delivery_confirmation_attempts enable row level security;
alter table public.rider_delivery_issues enable row level security;
alter table public.delivery_outbox enable row level security;

revoke all privileges on table public.rider_delivery_operations from public, anon, authenticated;
revoke all privileges on table public.delivery_confirmation_attempts from public, anon, authenticated;
revoke all privileges on table public.rider_delivery_issues from public, anon, authenticated;
revoke all privileges on table public.delivery_outbox from public, anon, authenticated;

-- Internal, minimized projection for an assigned rider. It deliberately omits
-- customer identity/contact, tracking tokens and delivery-code material.
create or replace function public.rider_active_delivery_payload(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $payload$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', o.id,
    'public_code', o.public_code,
    'business_name', b.name,
    'pickup_summary', b.address,
    'status', o.status,
    'revision', o.revision,
    'delivery_mode', o.delivery_mode,
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
    'picked_up_at', o.picked_up_at,
    'dispatched_at', o.dispatched_at,
    'arrived_at', o.arrived_at,
    'delivered_at', o.delivered_at,
    'updated_at', o.updated_at,
    'order_items', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', oi.name,
        'quantity', oi.quantity,
        'unit', oi.unit,
        'unit_price', oi.unit_price
      )) order by oi.created_at, oi.id)
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb)
  ))
  from public.orders o
  join public.businesses b on b.id = o.business_id
  where o.id = p_order_id
$payload$;

create or replace function public.rider_require_active_membership(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $membership$
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'membership rider activa requerida' using errcode = '42501';
  end if;
end;
$membership$;

create or replace function public.rider_validate_idempotency_key(p_key text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, extensions, pg_temp
as $key$
declare
  v_key text := btrim(coalesce(p_key, ''));
begin
  if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  return v_key;
end;
$key$;

-- A rider cannot bypass code confirmation through the generic transition RPC.
-- confirm_delivery_code sets this transaction-local guard only after it has
-- validated the handoff hash, assignment, state and revision.
create or replace function public.prevent_rider_unverified_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $terminal_guard$
begin
  if new.status = 'delivered'
    and old.status is distinct from 'delivered'
    and new.delivery_mode = 'delivery'
    and new.assigned_rider_user_id = auth.uid()
    and public.has_business_role(new.business_id, array['rider'])
    and coalesce(current_setting('taba.delivery_code_confirmed', true), '') <> 'true' then
    raise exception 'confirmacion de codigo requerida para entregar' using errcode = '42501';
  end if;
  return new;
end;
$terminal_guard$;

drop trigger if exists orders_prevent_rider_unverified_delivery on public.orders;
create trigger orders_prevent_rider_unverified_delivery
before update of status on public.orders
for each row execute function public.prevent_rider_unverified_delivery();

-- Queue projection before claim. It includes operational identifiers and a
-- revision, but never customer contact or exact delivery address.
create or replace function public.get_rider_queue(p_business_id uuid)
returns table (
  order_id uuid,
  public_code text,
  business_name text,
  pickup_summary text,
  delivery_summary text,
  status text,
  revision bigint,
  collection_amount numeric,
  payment_method text,
  item_count integer,
  estimated_minutes integer,
  ready_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $queue$
begin
  perform public.rider_require_active_membership(p_business_id);
  return query
  select
    o.id,
    o.public_code,
    b.name,
    b.address,
    nullif(btrim(o.customer_neighborhood), ''),
    o.status,
    o.revision,
    case when o.payment_method = 'cash' then o.total else null end,
    o.payment_method,
    greatest(1, coalesce(sum(oi.quantity), 0)::integer),
    case
      when o.estimated_arrival_source in ('business', 'routing')
       and o.estimated_arrival_updated_at >= statement_timestamp() - interval '15 minutes'
       and o.estimated_arrival_updated_at <= statement_timestamp() + interval '30 seconds'
       and o.estimated_arrival_at > statement_timestamp()
      then greatest(1, ceil(extract(epoch from (o.estimated_arrival_at - statement_timestamp())) / 60.0))::integer
      else null
    end,
    o.ready_at
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join public.order_items oi on oi.order_id = o.id
  where o.business_id = p_business_id
    and o.delivery_mode = 'delivery'
    and o.status = 'ready'
    and o.assigned_rider_user_id is null
  group by o.id, b.name, b.address
  order by o.ready_at nulls last, o.created_at
  limit 50;
end;
$queue$;

create or replace function public.get_active_rider_delivery()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $active$
declare
  v_order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select o.id
    into v_order_id
    from public.orders o
    join public.business_members bm
      on bm.business_id = o.business_id
     and bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true
   where o.assigned_rider_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
   order by o.updated_at desc, o.id desc
   limit 1;
  if v_order_id is null then return null; end if;
  return public.rider_active_delivery_payload(v_order_id);
end;
$active$;

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
as $claim$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
  v_fingerprint bytea;
begin
  perform public.rider_require_active_membership(p_business_id);
  if p_expected_revision is null or p_expected_revision < 1 or btrim(coalesce(p_public_code, '')) = '' then
    raise exception 'claim invalido' using errcode = '22023';
  end if;
  select o.* into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;
  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid()
     and operation = 'claim' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if exists (
    select 1 from public.orders active
    where active.assigned_rider_user_id = auth.uid()
      and active.id <> v_order.id
      and active.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_delivery_exists');
  end if;
  if v_order.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision);
  end if;
  if v_order.delivery_mode <> 'delivery' or v_order.status <> 'ready' or v_order.assigned_rider_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id;
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
$claim$;

create or replace function public.mark_delivery_picked_up(
  p_order_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $picked$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'picked_up' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'assigned' then return jsonb_build_object('ok', false, 'code', 'not_ready_for_pickup', 'revision', v_order.revision); end if;
  update public.orders set status = 'picked_up' where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'picked_up', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'picked_up', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$picked$;

create or replace function public.start_rider_delivery(
  p_order_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $start$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'start_route' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'picked_up' then return jsonb_build_object('ok', false, 'code', 'not_picked_up', 'revision', v_order.revision); end if;
  update public.orders set status = 'on_the_way' where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'route_started', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'start_route', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$start$;

create or replace function public.mark_rider_arrived(
  p_order_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $arrived$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'arrived' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'on_the_way' then return jsonb_build_object('ok', false, 'code', 'not_on_the_way', 'revision', v_order.revision); end if;
  update public.orders set status = 'arrived', arrived_at = clock_timestamp() where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'arrived', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'arrived', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$arrived$;

create or replace function public.publish_rider_location_receipt(
  p_order_id uuid,
  p_expected_revision bigint,
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
as $gps$
declare
  v_order public.orders%rowtype;
  v_previous public.rider_locations%rowtype;
  v_location public.rider_locations%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_now timestamptz;
  v_elapsed_seconds double precision;
  v_distance_meters double precision;
begin
  if p_lat is null or p_lng is null or p_accuracy is null
    or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
    or p_accuracy < 0 or p_accuracy > 250
    or (p_heading is not null and (p_heading < 0 or p_heading >= 360))
    or (p_speed is not null and (p_speed < 0 or p_speed > 70)) then
    return jsonb_build_object('ok', false, 'code', 'inaccurate');
  end if;
  if coalesce(p_is_mock, false) then return jsonb_build_object('ok', false, 'code', 'mock_location_rejected'); end if;
  v_now := clock_timestamp();
  if p_captured_at is null
    or p_captured_at < v_now - interval '10 minutes'
    or p_captured_at > v_now + interval '2 minutes' then
    return jsonb_build_object('ok', false, 'code', 'stale');
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  if v_order.status in ('delivered', 'cancelled', 'rejected') then return jsonb_build_object('ok', false, 'code', 'terminal'); end if;
  if v_order.status not in ('on_the_way', 'arrived') then return jsonb_build_object('ok', false, 'code', 'not_active'); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale', 'revision', v_order.revision); end if;
  select rl.* into v_location from public.rider_locations rl
   where rl.order_id = v_order.id and rl.rider_user_id = auth.uid() and rl.client_request_id = v_key
   for share;
  if found then return jsonb_build_object('ok', true, 'code', 'accepted', 'idempotent_no_op', true, 'sequence', v_location.receipt_sequence, 'recorded_at', v_location.created_at); end if;
  select rl.* into v_previous from public.rider_locations rl
   where rl.order_id = v_order.id and rl.rider_user_id = auth.uid() and rl.source = 'gps'
   order by rl.created_at desc, rl.id desc limit 1 for share;
  if found then
    v_elapsed_seconds := extract(epoch from (v_now - v_previous.created_at));
    if v_elapsed_seconds < 5 then return jsonb_build_object('ok', false, 'code', 'throttled', 'retry_after_seconds', greatest(1, ceil(5 - v_elapsed_seconds))::integer); end if;
    v_distance_meters := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_previous.lat) / 2), 2) +
      cos(radians(v_previous.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_previous.lng) / 2), 2)
    ));
    if v_distance_meters > greatest(250, v_elapsed_seconds * 70 + 100) then return jsonb_build_object('ok', false, 'code', 'impossible_jump'); end if;
  end if;
  insert into public.rider_locations(order_id, business_id, rider_user_id, lat, lng, accuracy, heading, speed, source, client_request_id)
  values (v_order.id, v_order.business_id, auth.uid(), p_lat, p_lng, p_accuracy, p_heading, p_speed, 'gps', v_key)
  returning * into v_location;
  return jsonb_build_object('ok', true, 'code', 'accepted', 'idempotent_no_op', false, 'sequence', v_location.receipt_sequence, 'recorded_at', v_location.created_at);
end;
$gps$;

create or replace function public.confirm_delivery_code(
  p_order_id uuid,
  p_expected_revision bigint,
  p_delivery_code text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $confirm$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_result jsonb;
  v_now timestamptz;
  v_attempts integer;
  v_lock_level integer;
  v_retry_seconds integer;
begin
  if v_code !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'code', 'invalid_format'); end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'confirm_code' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  select h.* into v_handoff from public.order_delivery_handoffs h where h.order_id = v_order.id for update;
  v_now := clock_timestamp();
  if v_order.status = 'delivered' and v_handoff.confirmed_at is not null then
    v_result := jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_no_op', true, 'order', public.rider_active_delivery_payload(v_order.id));
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, 'already_delivered') on conflict do nothing;
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'arrived' then return jsonb_build_object('ok', false, 'code', 'not_arrived', 'revision', v_order.revision); end if;
  if not found or v_handoff.expires_at <= v_now then return jsonb_build_object('ok', false, 'code', 'code_unavailable'); end if;
  if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
    v_retry_seconds := greatest(1, ceil(extract(epoch from (v_handoff.locked_until - v_now)))::integer);
    v_result := jsonb_build_object('ok', false, 'code', 'temporarily_locked', 'retry_after_seconds', v_retry_seconds, 'lock_until', v_handoff.locked_until);
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, 'temporarily_locked', greatest(1, v_handoff.failed_attempts - 4), v_retry_seconds);
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
    v_attempts := least(20, v_handoff.failed_attempts + 1);
    v_lock_level := greatest(0, v_attempts - 4);
    v_retry_seconds := case when v_attempts < 5 then null else least(86400, 300 * power(2, least(8, v_attempts - 5))::integer) end;
    update public.order_delivery_handoffs set failed_attempts = v_attempts, locked_until = case when v_retry_seconds is null then null else v_now + make_interval(secs => v_retry_seconds) end where order_id = v_order.id;
    v_result := jsonb_build_object('ok', false, 'code', case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end, 'remaining_attempts', greatest(0, 5 - v_attempts), 'retry_after_seconds', v_retry_seconds, 'lock_until', case when v_retry_seconds is null then null else v_now + make_interval(secs => v_retry_seconds) end);
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end, v_lock_level, v_retry_seconds);
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  update public.order_delivery_handoffs set confirmed_at = v_now, confirmed_by_user_id = auth.uid(), failed_attempts = 0, locked_until = null where order_id = v_order.id;
  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered', delivered_at = v_now where id = v_order.id and status = 'arrived';
  insert into public.delivery_outbox(business_id, order_id, event_type, payload)
  values (v_order.business_id, v_order.id, 'delivery_confirmed', jsonb_build_object('revision', (select revision from public.orders where id = v_order.id), 'confirmed_at', v_now))
  on conflict (order_id, event_type) do nothing;
  v_result := jsonb_build_object('ok', true, 'outcome', 'confirmed', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result)
  values (v_order.business_id, v_order.id, auth.uid(), v_key, 'confirmed');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
$confirm$;

create or replace function public.report_rider_delivery_issue(
  p_order_id uuid,
  p_expected_revision bigint,
  p_issue_type text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $issue$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_issue text := lower(btrim(coalesce(p_issue_type, '')));
  v_result jsonb;
begin
  if v_issue not in ('customer_unavailable', 'unsafe_location', 'vehicle_problem', 'wrong_address', 'business_issue', 'payment_issue', 'other') then
    raise exception 'tipo de incidencia invalido' using errcode = '22023';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'report_issue' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status not in ('assigned', 'picked_up', 'on_the_way', 'arrived') then return jsonb_build_object('ok', false, 'code', 'terminal', 'revision', v_order.revision); end if;
  insert into public.rider_delivery_issues(business_id, order_id, rider_id, issue_type, request_id)
  values (v_order.business_id, v_order.id, auth.uid(), v_issue, v_key);
  insert into public.delivery_outbox(business_id, order_id, event_type, payload)
  values (v_order.business_id, v_order.id, 'rider_issue_reported', jsonb_build_object('issue_type', v_issue))
  on conflict (order_id, event_type) do nothing;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, actor_type, actor_id, event_type, type, message, metadata, payload)
  values (v_order.id, v_order.business_id, auth.uid(), 'rider', 'rider', auth.uid(), 'order.rider_issue_reported', 'order.rider_issue_reported', 'Rider reporto una incidencia', jsonb_build_object('issue_type', v_issue), jsonb_build_object('issue_type', v_issue));
  v_result := jsonb_build_object('ok', true, 'outcome', 'issue_reported', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'report_issue', v_key, digest(jsonb_build_object('revision', p_expected_revision, 'issue_type', v_issue)::text, 'sha256'), v_result);
  return v_result;
end;
$issue$;

-- Only business operators can release or reassign before pickup. Rider issue
-- reporting never changes assignment, status, stock or cancellation authority.
create or replace function public.release_or_reassign_delivery(
  p_order_id uuid,
  p_expected_revision bigint,
  p_new_rider_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $reassign$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'rol de negocio requerido' using errcode = '42501'; end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if v_order.status not in ('ready', 'assigned') or v_order.delivery_mode <> 'delivery' then raise exception 'reasignacion no permitida despues de retiro' using errcode = '23514'; end if;
  if p_new_rider_user_id is not null then
    perform 1 from public.business_members bm where bm.business_id = v_order.business_id and bm.user_id = p_new_rider_user_id and bm.role = 'rider' and bm.is_active = true for share;
    if not found then raise exception 'rider activo requerido' using errcode = '42501'; end if;
  end if;
  update public.orders set assigned_rider_user_id = p_new_rider_user_id, status = case when p_new_rider_user_id is null then 'ready' else 'assigned' end where id = v_order.id;
  return public.rider_active_delivery_payload(v_order.id);
end;
$reassign$;

-- Existing public tracking must never reveal handoff material. The customer
-- receives its code at order creation/recovery; tracking is status-only.
create or replace function public.get_public_order_tracking(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $tracking$
declare
  v_token_hash bytea := public.request_order_token_hash();
  v_order public.orders%rowtype;
  v_location jsonb;
  v_reliable_eta boolean := false;
begin
  if v_token_hash is null or btrim(coalesce(p_public_id, '')) = '' then return null; end if;
  select o.* into v_order
    from public.orders o join public.order_public_tokens opt on opt.order_id = o.id
   where (o.id::text = btrim(p_public_id) or o.public_code = btrim(p_public_id))
     and opt.token_hash = v_token_hash and opt.revoked_at is null and opt.expires_at > clock_timestamp()
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
    select jsonb_build_object('lat', round(rl.lat::numeric, 3), 'lng', round(rl.lng::numeric, 3), 'accuracy', greatest(100, ceil(rl.accuracy))::integer, 'source', 'gps', 'created_at', rl.created_at)
      into v_location from public.rider_locations rl
     where rl.order_id = v_order.id and rl.rider_user_id = v_order.assigned_rider_user_id and rl.source = 'gps'
       and rl.accuracy between 0 and 250 and rl.created_at >= clock_timestamp() - interval '3 minutes'
     order by rl.created_at desc, rl.id desc limit 1;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'public_code', v_order.public_code, 'delivery_mode', v_order.delivery_mode,
    'status', v_order.status, 'revision', v_order.revision,
    'created_at', v_order.created_at, 'updated_at', v_order.updated_at,
    'accepted_at', v_order.accepted_at, 'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at, 'dispatched_at', coalesce(v_order.dispatched_at, v_order.picked_up_at),
    'arrived_at', v_order.arrived_at, 'delivered_at', v_order.delivered_at,
    'cancelled_at', coalesce(v_order.cancelled_at, v_order.canceled_at),
    'rejected_at', v_order.rejected_at, 'is_delivered', v_order.status = 'delivered',
    'estimated_arrival_at', case when v_reliable_eta then v_order.estimated_arrival_at else null end,
    'estimated_arrival_source', case when v_reliable_eta then v_order.estimated_arrival_source else null end,
    'estimated_arrival_updated_at', case when v_reliable_eta then v_order.estimated_arrival_updated_at else null end,
    'estimated_minutes', case when v_reliable_eta then greatest(1, ceil(extract(epoch from (v_order.estimated_arrival_at - clock_timestamp())) / 60.0))::integer else null end,
    'rider_location', v_location
  ));
end;
$tracking$;

revoke all on function public.rider_active_delivery_payload(uuid) from public, anon, authenticated;
revoke all on function public.rider_require_active_membership(uuid) from public, anon, authenticated;
revoke all on function public.rider_validate_idempotency_key(text) from public, anon, authenticated;
revoke all on function public.prevent_rider_unverified_delivery() from public, anon, authenticated;
revoke all on function public.get_rider_queue(uuid) from public, anon;
grant execute on function public.get_rider_queue(uuid) to authenticated;
revoke all on function public.get_active_rider_delivery() from public, anon;
grant execute on function public.get_active_rider_delivery() to authenticated;
revoke all on function public.claim_delivery_order(uuid, text, bigint, text) from public, anon;
grant execute on function public.claim_delivery_order(uuid, text, bigint, text) to authenticated;
revoke all on function public.mark_delivery_picked_up(uuid, bigint, text) from public, anon;
grant execute on function public.mark_delivery_picked_up(uuid, bigint, text) to authenticated;
revoke all on function public.start_rider_delivery(uuid, bigint, text) from public, anon;
grant execute on function public.start_rider_delivery(uuid, bigint, text) to authenticated;
revoke all on function public.mark_rider_arrived(uuid, bigint, text) from public, anon;
grant execute on function public.mark_rider_arrived(uuid, bigint, text) to authenticated;
revoke all on function public.publish_rider_location_receipt(uuid, bigint, double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) from public, anon;
grant execute on function public.publish_rider_location_receipt(uuid, bigint, double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) to authenticated;
revoke all on function public.confirm_delivery_code(uuid, bigint, text, text) from public, anon;
grant execute on function public.confirm_delivery_code(uuid, bigint, text, text) to authenticated;
revoke all on function public.report_rider_delivery_issue(uuid, bigint, text, text) from public, anon;
grant execute on function public.report_rider_delivery_issue(uuid, bigint, text, text) to authenticated;
revoke all on function public.release_or_reassign_delivery(uuid, bigint, uuid) from public, anon;
grant execute on function public.release_or_reassign_delivery(uuid, bigint, uuid) to authenticated;

-- Earlier signatures cannot express CAS revisions or idempotency receipts.
-- Revoke them instead of retaining an unsafe bypass for mobile callers.
revoke all on function public.claim_available_rider_order(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.publish_rider_location(uuid, double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.confirm_order_delivery(uuid, text, text) from public, anon, authenticated;

comment on function public.get_rider_queue(uuid) is 'Minimized ready-for-pickup queue for the authenticated active rider.';
comment on function public.get_active_rider_delivery() is 'Authoritative active assigned delivery snapshot for recovery after process/network loss.';
comment on function public.confirm_delivery_code(uuid, bigint, text, text) is 'Transactional code confirmation with server rate limiting, idempotency, terminal GPS revocation and outbox intent.';
