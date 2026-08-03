-- Preserve the authoritative order revision and validated capture time on each
-- accepted Rider GPS receipt. rider_locations.order_revision is NOT NULL on
-- the deployed staging schema, so omitting it made the otherwise valid RPC
-- fail after assignment and route start.

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
  insert into public.rider_locations(
    order_id, business_id, rider_user_id, lat, lng, accuracy, heading, speed,
    source, client_request_id, order_revision, captured_at
  ) values (
    v_order.id, v_order.business_id, auth.uid(), p_lat, p_lng, p_accuracy, p_heading, p_speed,
    'gps', v_key, v_order.revision, p_captured_at
  ) returning * into v_location;
  return jsonb_build_object('ok', true, 'code', 'accepted', 'idempotent_no_op', false, 'sequence', v_location.receipt_sequence, 'recorded_at', v_location.created_at);
end;
$gps$;

revoke all on function public.publish_rider_location_receipt(uuid, bigint, double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) from public, anon;
grant execute on function public.publish_rider_location_receipt(uuid, bigint, double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) to authenticated;

comment on function public.publish_rider_location_receipt(uuid, bigint, double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) is
  'Assignment- and revision-bound Rider GPS receipt with server-time validation, persistent order revision and terminal rejection.';
