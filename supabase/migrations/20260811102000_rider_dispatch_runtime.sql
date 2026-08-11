-- TABA2 automated Rider dispatch: deterministic runtime, atomic claim and
-- authoritative surfaces.
--
-- This migration completes 20260811101000. It adds candidate evaluation,
-- offer leases, the transactional accept path, the worker cycle, the manual
-- override, the Panel projection, the reward ledger writes and the order
-- lifecycle triggers. It also closes the legacy claim bypass.
--
-- Automatic assignment stays OFF: business_dispatch_settings defaults to
-- auto_dispatch_enabled = false and qa_fixture_only = true.

-- ---------------------------------------------------------------------------
-- 0. Corrections to the foundation
-- ---------------------------------------------------------------------------

-- dispatch_jobs uses `revision`, not `version`. Sharing the generic bump
-- trigger raised "record new has no field version" on every job update, which
-- would have made the whole engine unusable.
create or replace function public.bump_dispatch_job_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $bump_job$
begin
  new.revision := old.revision;
  if new is distinct from old then
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$bump_job$;

drop trigger if exists dispatch_jobs_bump_revision on public.dispatch_jobs;
create trigger dispatch_jobs_bump_revision
before update on public.dispatch_jobs
for each row execute function public.bump_dispatch_job_revision();

revoke all on function public.bump_dispatch_job_revision() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Geometry and reward helpers
-- ---------------------------------------------------------------------------

create or replace function private.dispatch_distance_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $distance$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else greatest(0, round(
      6371000.0 * 2.0 * asin(least(1.0, sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2.0), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
          * power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
      )))
    ))::integer
  end;
$distance$;

-- Zone compatibility mirrors js/core/rider-dispatch-ranking.js exactly.
create or replace function private.dispatch_zones_match(p_shift_zone text, p_order_zone text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $zones$
  select coalesce(p_shift_zone, '*') = '*'
      or coalesce(p_order_zone, '*') = '*'
      or coalesce(p_shift_zone, '*') = coalesce(p_order_zone, '*');
$zones$;

-- Reward components are frozen into the offer. Version 1 defaults are zero:
-- this repository never infers a real commercial amount.
create or replace function private.dispatch_reward_snapshot(
  p_policy public.rider_dispatch_policies,
  p_trip_distance_m integer
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $reward$
  select jsonb_build_object(
    'policy_version', p_policy.version,
    'ranking_version', p_policy.ranking_version,
    'currency', p_policy.reward_currency,
    'trip_distance_m', coalesce(p_trip_distance_m, 0),
    'components', jsonb_build_object(
      'base', p_policy.reward_base,
      'distance', round(p_policy.reward_per_km * coalesce(p_trip_distance_m, 0) / 1000.0, 2),
      'shift', p_policy.reward_shift,
      'demand', p_policy.reward_demand,
      'goal', p_policy.reward_goal
    ),
    'total', round(
      p_policy.reward_base
      + (p_policy.reward_per_km * coalesce(p_trip_distance_m, 0) / 1000.0)
      + p_policy.reward_shift
      + p_policy.reward_demand,
      2
    )
  );
$reward$;

-- Pre-claim projection. Deliberately identical in shape to the already
-- certified get_rider_queue row: business name/address, neighborhood only,
-- never customer name, phone, exact address, notes or door coordinates.
create or replace function private.dispatch_safe_payload(
  p_order_id uuid,
  p_pickup_distance_m integer,
  p_trip_distance_m integer,
  p_lease_expires_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $payload$
  select jsonb_build_object(
    'order_id', o.id,
    'order_code', o.public_code,
    'pickup', jsonb_build_object(
      'business_name', b.name,
      'address', b.address,
      'distance_m', p_pickup_distance_m
    ),
    'destination', jsonb_build_object(
      'neighborhood', nullif(btrim(o.customer_neighborhood), ''),
      'zone', public.dispatch_normalize_zone(o.customer_neighborhood)
    ),
    'trip_distance_m', p_trip_distance_m,
    'item_count', greatest(1, coalesce((
      select sum(oi.quantity) from public.order_items oi where oi.order_id = o.id
    ), 0)::integer),
    'payment_method', o.payment_method,
    'collection_amount', case when o.payment_method = 'cash' then o.total else null end,
    'ready_at', o.ready_at,
    'lease_expires_at', p_lease_expires_at
  )
  from public.orders o
  join public.businesses b on b.id = o.business_id
  where o.id = p_order_id;
$payload$;

-- ---------------------------------------------------------------------------
-- 2. Deterministic evaluation round
-- ---------------------------------------------------------------------------

-- Persists one immutable evaluation row per Rider of the business, eligible or
-- not, and returns the winning candidate. No randomness, no LLM, server clock
-- only. The caller must already hold the job lock.
create or replace function private.dispatch_evaluate_round(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $evaluate$
declare
  v_job public.dispatch_jobs%rowtype;
  v_order public.orders%rowtype;
  v_policy public.rider_dispatch_policies%rowtype;
  v_now timestamptz := clock_timestamp();
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_dest_lat double precision;
  v_dest_lng double precision;
  v_pickup_ok boolean;
  v_dest_ok boolean;
  v_candidate record;
  v_winner jsonb := null;
  v_rank integer := 0;
  v_evaluated integer := 0;
  v_eligible integer := 0;
  v_codes text[];
begin
  select j.* into v_job from public.dispatch_jobs j where j.id = p_job_id;
  if not found then return null; end if;
  select o.* into v_order from public.orders o where o.id = v_job.order_id;
  select p.* into v_policy from public.rider_dispatch_policies p
   where p.business_id = v_job.business_id and p.version = v_job.policy_version;

  select s.business_latitude, s.business_longitude, s.customer_latitude, s.customer_longitude
    into v_pickup_lat, v_pickup_lng, v_dest_lat, v_dest_lng
    from private.rider_map_order_location_snapshots s
   where s.order_id = v_job.order_id;

  if v_pickup_lat is null or v_pickup_lng is null then
    select l.latitude, l.longitude into v_pickup_lat, v_pickup_lng
      from private.rider_map_business_locations l
     where l.business_id = v_job.business_id;
  end if;

  v_pickup_ok := v_pickup_lat is not null and v_pickup_lng is not null;
  v_dest_ok := v_dest_lat is not null and v_dest_lng is not null;

  for v_candidate in
    select
      bm.user_id as rider_user_id,
      coalesce(bm.is_active, false) as membership_active,
      coalesce(pr.is_blocked, false) as blocked,
      pr.last_assigned_at,
      sh.id as shift_id,
      sh.status as shift_status,
      sh.availability,
      sh.zone_code as shift_zone,
      coalesce(sh.current_active_orders, 0) as active_orders,
      coalesce(sh.max_concurrent_orders, 1) as max_concurrent_orders,
      sh.ends_at,
      pres.heartbeat_at,
      pres.captured_at,
      pres.latitude as rider_lat,
      pres.longitude as rider_lng,
      pres.accuracy_m,
      coalesce(pres.is_mock, false) as is_mock,
      exists (
        select 1 from public.dispatch_offers o2
         where o2.rider_user_id = bm.user_id and o2.status = 'offered'
      ) as has_pending_offer,
      exists (
        select 1 from public.dispatch_offers o3
         where o3.job_id = v_job.id and o3.rider_user_id = bm.user_id
      ) as already_offered,
      (
        select count(*)::integer from public.dispatch_offers o4
         where o4.business_id = v_job.business_id
           and o4.rider_user_id = bm.user_id
           and o4.status = 'accepted'
           and o4.responded_at >= v_now - interval '4 hours'
      ) as assignments_last_4h
    from public.business_members bm
    left join public.rider_dispatch_profiles pr
      on pr.business_id = v_job.business_id and pr.rider_user_id = bm.user_id
    left join public.rider_shifts sh
      on sh.business_id = v_job.business_id and sh.rider_user_id = bm.user_id
     and sh.status in ('active', 'paused')
    left join private.rider_dispatch_presence pres
      on pres.business_id = v_job.business_id and pres.rider_user_id = bm.user_id
    where bm.business_id = v_job.business_id
      and bm.role = 'rider'
    order by bm.user_id
  loop
    declare
      v_hb_age integer := case when v_candidate.heartbeat_at is null then null
        else greatest(0, floor(extract(epoch from (v_now - v_candidate.heartbeat_at)))::integer) end;
      v_gps_age integer := case when v_candidate.captured_at is null then null
        else greatest(0, floor(extract(epoch from (v_now - v_candidate.captured_at)))::integer) end;
      v_distance integer;
      v_idle integer;
      v_score integer;
      v_distance_penalty integer;
      v_load_penalty integer;
      v_idle_credit integer;
      v_recent_penalty integer;
      v_hb_penalty integer;
      v_gps_penalty integer;
      v_is_eligible boolean;
    begin
      v_codes := '{}'::text[];

      if not v_candidate.membership_active then
        v_codes := v_codes || 'MEMBERSHIP_INACTIVE'::text;
      end if;
      if v_candidate.blocked then
        v_codes := v_codes || 'RIDER_BLOCKED'::text;
      end if;
      if v_candidate.shift_id is null then
        v_codes := v_codes || 'NO_ACTIVE_SHIFT'::text;
      elsif v_candidate.shift_status <> 'active'
        or v_candidate.availability <> 'available'
        or v_candidate.ends_at <= v_now then
        v_codes := v_codes || 'PAUSED_OR_ENDED'::text;
      end if;
      if v_hb_age is null or v_hb_age > v_policy.heartbeat_ttl_seconds then
        v_codes := v_codes || 'HEARTBEAT_STALE'::text;
      end if;
      if v_gps_age is null or v_gps_age > v_policy.gps_ttl_seconds then
        v_codes := v_codes || 'GPS_STALE'::text;
      end if;
      if v_candidate.accuracy_m is null
        or v_candidate.accuracy_m > v_policy.max_gps_accuracy_m
        or v_candidate.is_mock then
        v_codes := v_codes || 'GPS_INACCURATE'::text;
      end if;
      if not private.dispatch_zones_match(v_candidate.shift_zone, v_job.dispatch_zone) then
        v_codes := v_codes || 'ZONE_MISMATCH'::text;
      end if;
      if v_candidate.active_orders >= v_candidate.max_concurrent_orders then
        v_codes := v_codes || 'AT_CAPACITY'::text;
      end if;
      if v_candidate.has_pending_offer then
        v_codes := v_codes || 'OFFER_ALREADY_PENDING'::text;
      end if;
      if v_candidate.already_offered then
        v_codes := v_codes || 'ALREADY_OFFERED'::text;
      end if;
      if not v_pickup_ok then
        v_codes := v_codes || 'PICKUP_LOCATION_UNAVAILABLE'::text;
      end if;
      if not v_dest_ok then
        v_codes := v_codes || 'DESTINATION_LOCATION_UNAVAILABLE'::text;
      end if;

      v_is_eligible := array_length(v_codes, 1) is null;

      v_distance := private.dispatch_distance_m(
        v_candidate.rider_lat::double precision, v_candidate.rider_lng::double precision,
        v_pickup_lat, v_pickup_lng
      );
      -- A Rider that never got an assignment starts with the full idle credit,
      -- exactly like the JS mirror's `?? maxIdleSeconds` default.
      v_idle := case
        when v_candidate.last_assigned_at is null then 10800
        else greatest(0, floor(extract(epoch from (v_now - v_candidate.last_assigned_at)))::integer)
      end;

      v_distance_penalty := trunc(least(coalesce(v_distance, 20000), 20000) / 50.0)::integer;
      v_load_penalty := round(250.0 * v_candidate.active_orders / greatest(1, v_candidate.max_concurrent_orders))::integer;
      v_idle_credit := trunc(least(v_idle, 10800) / 40.0)::integer;
      v_recent_penalty := 60 * v_candidate.assignments_last_4h;
      v_hb_penalty := least(coalesce(v_hb_age, v_policy.heartbeat_ttl_seconds), v_policy.heartbeat_ttl_seconds);
      v_gps_penalty := least(coalesce(v_gps_age, v_policy.gps_ttl_seconds), v_policy.gps_ttl_seconds);
      v_score := 100000 - v_distance_penalty - v_load_penalty + v_idle_credit
                 - v_recent_penalty - v_hb_penalty - v_gps_penalty;

      insert into public.dispatch_evaluations(
        job_id, business_id, order_id, rider_user_id, shift_id, round_no,
        evaluated_at, eligible, exclusion_codes, distance_to_pickup_m,
        active_orders, max_concurrent_orders, idle_seconds, assignments_last_4h,
        heartbeat_age_seconds, gps_age_seconds, policy_version, ranking_version,
        score, rank, factors
      ) values (
        v_job.id, v_job.business_id, v_job.order_id, v_candidate.rider_user_id,
        v_candidate.shift_id, v_job.round_no, v_now, v_is_eligible, v_codes,
        v_distance, v_candidate.active_orders, v_candidate.max_concurrent_orders,
        v_idle, v_candidate.assignments_last_4h, v_hb_age, v_gps_age,
        v_policy.version, v_policy.ranking_version,
        case when v_is_eligible then v_score else null end,
        null,
        jsonb_build_object(
          'distance_penalty', v_distance_penalty,
          'load_penalty', v_load_penalty,
          'idle_credit', v_idle_credit,
          'recent_assignment_penalty', v_recent_penalty,
          'heartbeat_penalty', v_hb_penalty,
          'gps_penalty', v_gps_penalty,
          'base_score', 100000
        )
      )
      on conflict (job_id, round_no, rider_user_id) do nothing;

      v_evaluated := v_evaluated + 1;
      if v_is_eligible then
        v_eligible := v_eligible + 1;
        if v_winner is null
          or v_score > (v_winner->>'score')::integer
          or (
            v_score = (v_winner->>'score')::integer
            and (
              (v_candidate.last_assigned_at is null and (v_winner->>'last_assigned_at') is not null)
              or (
                (v_candidate.last_assigned_at is null) = ((v_winner->>'last_assigned_at') is null)
                and coalesce(v_candidate.last_assigned_at, '-infinity'::timestamptz)
                    < coalesce((v_winner->>'last_assigned_at')::timestamptz, '-infinity'::timestamptz)
              )
            )
          ) then
          v_winner := jsonb_build_object(
            'rider_user_id', v_candidate.rider_user_id,
            'shift_id', v_candidate.shift_id,
            'score', v_score,
            'last_assigned_at', v_candidate.last_assigned_at,
            'distance_to_pickup_m', v_distance
          );
        end if;
      end if;
    end;
  end loop;

  if v_winner is not null then
    v_rank := 1;
    update public.dispatch_evaluations e
       set rank = 1
     where e.job_id = v_job.id and e.round_no = v_job.round_no
       and e.rider_user_id = (v_winner->>'rider_user_id')::uuid;
  end if;

  return jsonb_build_object(
    'winner', v_winner,
    'evaluated', v_evaluated,
    'eligible', v_eligible,
    'pickup_available', v_pickup_ok,
    'destination_available', v_dest_ok,
    'trip_distance_m', private.dispatch_distance_m(v_pickup_lat, v_pickup_lng, v_dest_lat, v_dest_lng),
    'exhausted', exists (select 1 from public.dispatch_offers o where o.job_id = v_job.id)
  );
end;
$evaluate$;

-- dispatch_evaluations is append-only, but the winning rank is written by the
-- same transaction that created the row. Allow exactly that one transition.
create or replace function public.reject_dispatch_evaluation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $eval_guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'rider dispatch audit rows are append-only' using errcode = '55000';
  end if;
  if old.rank is null and new.rank is not null
    and to_jsonb(new) - 'rank' = to_jsonb(old) - 'rank' then
    return new;
  end if;
  raise exception 'rider dispatch audit rows are append-only' using errcode = '55000';
end;
$eval_guard$;

drop trigger if exists dispatch_evaluations_immutable on public.dispatch_evaluations;
create trigger dispatch_evaluations_immutable
before update or delete on public.dispatch_evaluations
for each row execute function public.reject_dispatch_evaluation_mutation();

revoke all on function public.reject_dispatch_evaluation_mutation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Offer creation and job advancement
-- ---------------------------------------------------------------------------

create or replace function private.dispatch_advance_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $advance$
declare
  v_job public.dispatch_jobs%rowtype;
  v_order public.orders%rowtype;
  v_policy public.rider_dispatch_policies%rowtype;
  v_settings public.business_dispatch_settings%rowtype;
  v_round jsonb;
  v_winner jsonb;
  v_offer public.dispatch_offers%rowtype;
  v_now timestamptz := clock_timestamp();
  v_lease timestamptz;
  v_reward jsonb;
  v_failure text;
begin
  -- Advisory gate before any row lock. A job another worker already holds is
  -- left for that worker instead of contending for it.
  if not private.dispatch_try_lock_job(p_job_id) then
    return jsonb_build_object('ok', false, 'code', 'job_busy');
  end if;

  select j.* into v_job from public.dispatch_jobs j where j.id = p_job_id for update;
  if not found then return null; end if;
  if v_job.state not in ('queued', 'ranking', 'no_rider_available') then
    return jsonb_build_object('ok', false, 'code', 'job_not_actionable', 'state', v_job.state);
  end if;

  select o.* into v_order from public.orders o where o.id = v_job.order_id for update;
  select s.* into v_settings from public.business_dispatch_settings s where s.business_id = v_job.business_id;

  -- An order that stopped being dispatchable cancels the job instead of
  -- producing an offer nobody can honour.
  if v_order.status <> 'ready' or v_order.assigned_rider_user_id is not null then
    update public.dispatch_jobs
       set state = 'cancelled',
           cancelled_at = v_now,
           last_failure_code = 'ORDER_NOT_DISPATCHABLE',
           failure_evidence = jsonb_build_object('order_status', v_order.status)
     where id = v_job.id;
    insert into public.dispatch_events(business_id, job_id, order_id, event_type, actor_role, detail)
    values (v_job.business_id, v_job.id, v_job.order_id, 'dispatch.job_cancelled', 'system',
      jsonb_build_object('reason', 'ORDER_NOT_DISPATCHABLE', 'order_status', v_order.status));
    return jsonb_build_object('ok', false, 'code', 'order_not_dispatchable');
  end if;

  if not coalesce(v_settings.auto_dispatch_enabled, false) then
    update public.dispatch_jobs
       set last_failure_code = 'AUTO_DISPATCH_DISABLED',
           next_attempt_at = v_now + interval '60 seconds'
     where id = v_job.id;
    return jsonb_build_object('ok', false, 'code', 'auto_dispatch_disabled');
  end if;

  select p.* into v_policy from public.rider_dispatch_policies p
   where p.business_id = v_job.business_id and p.version = v_job.policy_version;

  update public.dispatch_jobs
     set state = 'ranking', ranking_started_at = coalesce(ranking_started_at, v_now),
         attempt_count = attempt_count + 1
   where id = v_job.id
  returning * into v_job;

  v_round := private.dispatch_evaluate_round(v_job.id);
  v_winner := v_round->'winner';

  if v_winner is null or v_winner = 'null'::jsonb then
    v_failure := case
      when coalesce((v_round->>'eligible')::integer, 0) = 0
        and coalesce((v_round->>'exhausted')::boolean, false) then 'ALL_OFFERS_EXHAUSTED'
      when not coalesce((v_round->>'pickup_available')::boolean, false) then 'PICKUP_LOCATION_UNAVAILABLE'
      when not coalesce((v_round->>'destination_available')::boolean, false) then 'DESTINATION_LOCATION_UNAVAILABLE'
      when coalesce((v_round->>'evaluated')::integer, 0) = 0 then 'NO_ACTIVE_RIDERS'
      else 'NO_ELIGIBLE_RIDER'
    end;
    update public.dispatch_jobs
       set state = 'no_rider_available',
           last_failure_code = v_failure,
           next_attempt_at = v_now + make_interval(secs => v_policy.no_rider_retry_seconds),
           failure_evidence = jsonb_build_object(
             'evaluated', v_round->'evaluated',
             'eligible', v_round->'eligible',
             'round_no', v_job.round_no
           )
     where id = v_job.id;
    insert into public.dispatch_events(business_id, job_id, order_id, event_type, actor_role, detail)
    values (v_job.business_id, v_job.id, v_job.order_id, 'dispatch.no_rider_available', 'system',
      jsonb_build_object('code', v_failure, 'round_no', v_job.round_no,
        'evaluated', v_round->'evaluated', 'eligible', v_round->'eligible'));
    return jsonb_build_object('ok', false, 'code', v_failure);
  end if;

  v_lease := v_now + make_interval(secs => v_policy.offer_ttl_seconds);
  v_reward := private.dispatch_reward_snapshot(v_policy, (v_round->>'trip_distance_m')::integer);

  insert into public.dispatch_offers(
    job_id, business_id, order_id, rider_user_id, shift_id, round_no, rank, score,
    source, status, expected_order_revision, job_revision_at_offer,
    offered_at, lease_expires_at, estimated_reward, reward_currency,
    reward_snapshot, safe_payload
  ) values (
    v_job.id, v_job.business_id, v_job.order_id,
    (v_winner->>'rider_user_id')::uuid, (v_winner->>'shift_id')::uuid,
    v_job.round_no, 1, (v_winner->>'score')::integer,
    'automatic', 'offered', v_order.revision, v_job.revision,
    v_now, v_lease, (v_reward->>'total')::numeric, v_policy.reward_currency,
    v_reward,
    private.dispatch_safe_payload(
      v_job.order_id,
      (v_winner->>'distance_to_pickup_m')::integer,
      (v_round->>'trip_distance_m')::integer,
      v_lease
    )
  )
  returning * into v_offer;

  update public.dispatch_jobs
     set state = 'offering',
         first_offer_at = coalesce(first_offer_at, v_now),
         next_attempt_at = v_lease,
         last_failure_code = null,
         failure_evidence = '{}'::jsonb
   where id = v_job.id;

  insert into public.dispatch_events(
    business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
    event_type, actor_role, detail
  ) values (
    v_job.business_id, v_job.id, v_job.order_id, v_offer.id,
    v_offer.shift_id, v_offer.rider_user_id, 'dispatch.offer_created', 'system',
    jsonb_build_object('round_no', v_job.round_no, 'score', v_offer.score,
      'rank', 1, 'lease_expires_at', v_lease, 'ttl_seconds', v_policy.offer_ttl_seconds)
  );

  return jsonb_build_object('ok', true, 'code', 'offer_created',
    'offer_id', v_offer.id, 'rider_user_id', v_offer.rider_user_id);
end;
$advance$;

-- ---------------------------------------------------------------------------
-- 4. Lease expiry sweep
-- ---------------------------------------------------------------------------

create or replace function private.dispatch_expire_leases(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $expire$
declare
  v_offer record;
  v_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  for v_offer in
    -- Read first, lock later: the advisory gate on the owning job has to come
    -- before the offer row lock, like every other path.
    select o.id, o.job_id, o.business_id, o.order_id, o.shift_id, o.rider_user_id
      from public.dispatch_offers o
     where o.status = 'offered' and o.lease_expires_at <= v_now
     order by o.lease_expires_at, o.id
     limit greatest(1, coalesce(p_limit, 200))
  loop
    if not private.dispatch_try_lock_job(v_offer.job_id) then continue; end if;

    update public.dispatch_offers
       set status = 'expired', responded_at = v_now, response_reason = 'LEASE_EXPIRED'
     where id = v_offer.id and status = 'offered';
    if not found then continue; end if;

    update public.dispatch_jobs
       set state = 'queued', round_no = round_no + 1, next_attempt_at = v_now,
           last_failure_code = 'OFFER_EXPIRED',
           failure_evidence = jsonb_build_object('offer_id', v_offer.id)
     where id = v_offer.job_id and state = 'offering';

    insert into public.dispatch_events(
      business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
      event_type, actor_role, detail
    ) values (
      v_offer.business_id, v_offer.job_id, v_offer.order_id, v_offer.id,
      v_offer.shift_id, v_offer.rider_user_id, 'dispatch.offer_expired', 'system',
      jsonb_build_object('reason', 'LEASE_EXPIRED')
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$expire$;

-- ---------------------------------------------------------------------------
-- 5. Rider offer commands
-- ---------------------------------------------------------------------------

-- Accept locks offer -> job -> order and revalidates every eligibility fact
-- against the server clock. Two concurrent accepts always produce one winner
-- and one structured receipt; the loser is never classified by error text.
create or replace function public.accept_rider_dispatch_offer(
  p_offer_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $accept$
declare
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea := digest(jsonb_build_object(
    'offer_id', p_offer_id, 'version', p_expected_version)::text, 'sha256');
  v_replay jsonb;
  v_offer public.dispatch_offers%rowtype;
  v_job public.dispatch_jobs%rowtype;
  v_order public.orders%rowtype;
  v_shift public.rider_shifts%rowtype;
  v_policy public.rider_dispatch_policies%rowtype;
  v_presence private.rider_dispatch_presence%rowtype;
  v_now timestamptz := clock_timestamp();
  v_code text;
  v_result jsonb;
  v_active_count integer;
  v_job_id uuid;
begin
  if p_offer_id is null or p_expected_version is null then
    raise exception 'accept invalido' using errcode = '22023';
  end if;
  v_replay := public.dispatch_begin_command('accept_rider_dispatch_offer', v_key, v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  -- job_id never changes for an offer, so it is safe to read unlocked purely to
  -- take the advisory gate before the first row lock.
  select o.job_id into v_job_id from public.dispatch_offers o where o.id = p_offer_id;
  if v_job_id is null then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  perform private.dispatch_lock_job(v_job_id);

  select o.* into v_offer from public.dispatch_offers o where o.id = p_offer_id for update;
  if not found or v_offer.rider_user_id <> auth.uid() then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  perform public.rider_require_active_membership(v_offer.business_id);

  select j.* into v_job from public.dispatch_jobs j where j.id = v_offer.job_id for update;
  select o.* into v_order from public.orders o where o.id = v_offer.order_id for update;
  select s.* into v_shift from public.rider_shifts s where s.id = v_offer.shift_id for update;
  select p.* into v_policy from public.rider_dispatch_policies p
   where p.business_id = v_offer.business_id and p.version = v_job.policy_version;
  select pr.* into v_presence from private.rider_dispatch_presence pr
   where pr.business_id = v_offer.business_id and pr.rider_user_id = auth.uid();

  select count(*)::integer into v_active_count
    from public.orders x
   where x.business_id = v_offer.business_id
     and x.assigned_rider_user_id = auth.uid()
     and x.status in ('assigned', 'picked_up', 'on_the_way', 'arrived');

  if v_offer.status = 'accepted' then
    v_code := 'already_accepted';
  elsif v_offer.status <> 'offered' then
    v_code := 'offer_not_available';
  elsif v_offer.version <> p_expected_version then
    v_code := 'stale_version';
  elsif v_offer.lease_expires_at <= v_now then
    v_code := 'offer_expired';
  elsif v_order.assigned_rider_user_id is not null or v_order.status <> 'ready' then
    v_code := 'order_taken';
  elsif v_order.revision <> v_offer.expected_order_revision then
    v_code := 'stale_revision';
  elsif v_shift.status <> 'active' or v_shift.ends_at <= v_now then
    v_code := 'shift_not_active';
  elsif v_presence.shift_id is null
    or v_presence.is_mock
    or v_presence.heartbeat_at < v_now - make_interval(secs => v_policy.heartbeat_ttl_seconds)
    or v_presence.captured_at < v_now - make_interval(secs => v_policy.gps_ttl_seconds) then
    v_code := 'heartbeat_stale';
  elsif v_active_count >= v_shift.max_concurrent_orders then
    v_code := 'at_capacity';
  end if;

  if v_code is not null then
    -- An expired lease is settled here so the job is never blocked by it.
    if v_code = 'offer_expired' and v_offer.status = 'offered' then
      update public.dispatch_offers
         set status = 'expired', responded_at = v_now, response_reason = 'LEASE_EXPIRED'
       where id = v_offer.id and status = 'offered';
      update public.dispatch_jobs
         set state = 'queued', round_no = round_no + 1, next_attempt_at = v_now,
             last_failure_code = 'OFFER_EXPIRED'
       where id = v_job.id and state = 'offering';
    end if;
    insert into public.dispatch_events(
      business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
      event_type, actor_user_id, actor_role, detail
    ) values (
      v_offer.business_id, v_offer.job_id, v_offer.order_id, v_offer.id,
      v_offer.shift_id, auth.uid(), 'dispatch.offer_accept_rejected', auth.uid(), 'rider',
      jsonb_build_object('code', v_code)
    );
    v_result := jsonb_build_object('ok', false, 'code', v_code, 'idempotent_no_op', false,
      'state', public.rider_operational_state_payload(v_offer.business_id, auth.uid()));
    return public.dispatch_store_receipt(
      v_offer.business_id, 'accept_rider_dispatch_offer', v_key, v_fingerprint, v_result);
  end if;

  update public.dispatch_offers
     set status = 'accepted', responded_at = v_now, response_reason = 'ACCEPTED'
   where id = v_offer.id and status = 'offered'
  returning * into v_offer;
  if not found then
    v_result := jsonb_build_object('ok', false, 'code', 'offer_not_available', 'idempotent_no_op', false,
      'state', public.rider_operational_state_payload(v_offer.business_id, auth.uid()));
    return public.dispatch_store_receipt(
      v_offer.business_id, 'accept_rider_dispatch_offer', v_key, v_fingerprint, v_result);
  end if;

  -- The job reaches `claimed` before the order is written, so the order
  -- lifecycle trigger sees a settled claim instead of mistaking this write for
  -- an out-of-band assignment and cancelling the job it belongs to.
  update public.dispatch_jobs
     set state = 'claimed', assigned_rider_user_id = auth.uid(),
         claimed_shift_id = v_offer.shift_id, claimed_at = v_now,
         last_failure_code = null, failure_evidence = '{}'::jsonb
   where id = v_job.id
  returning * into v_job;

  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id
     and revision = v_offer.expected_order_revision
     and assigned_rider_user_id is null
     and status = 'ready';
  if not found then
    raise exception 'carrera de asignacion detectada' using errcode = '40001';
  end if;

  update public.rider_dispatch_profiles
     set last_assigned_at = v_now, updated_at = v_now
   where business_id = v_offer.business_id and rider_user_id = auth.uid();

  -- Frozen estimate. The unique index guarantees at most one per delivery.
  insert into public.rider_reward_ledger(
    business_id, order_id, job_id, offer_id, shift_id, rider_user_id,
    entry_type, entry_key, amount, currency, policy_version, snapshot
  ) values (
    v_offer.business_id, v_offer.order_id, v_job.id, v_offer.id, v_offer.shift_id,
    auth.uid(), 'estimated', 'estimated:' || v_offer.order_id::text,
    v_offer.estimated_reward, v_offer.reward_currency, v_job.policy_version,
    v_offer.reward_snapshot
  )
  on conflict (business_id, entry_key) do nothing;

  perform public.reconcile_rider_shift(v_offer.shift_id);

  insert into public.dispatch_events(
    business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
    event_type, actor_user_id, actor_role, detail
  ) values (
    v_offer.business_id, v_job.id, v_offer.order_id, v_offer.id, v_offer.shift_id,
    auth.uid(), 'dispatch.offer_accepted', auth.uid(), 'rider',
    jsonb_build_object('score', v_offer.score, 'round_no', v_offer.round_no,
      'estimated_reward', v_offer.estimated_reward)
  );

  v_result := jsonb_build_object(
    'ok', true, 'code', 'offer_accepted', 'idempotent_no_op', false,
    'order', public.rider_active_delivery_payload(v_offer.order_id),
    'state', public.rider_operational_state_payload(v_offer.business_id, auth.uid())
  );
  return public.dispatch_store_receipt(
    v_offer.business_id, 'accept_rider_dispatch_offer', v_key, v_fingerprint, v_result);
end;
$accept$;

-- El motivo es un codigo cerrado, no texto libre: asi el Rider no puede
-- escribir PII dentro de la auditoria y el Panel puede agrupar por causa.
create or replace function public.reject_rider_dispatch_offer(
  p_offer_id uuid,
  p_expected_version bigint,
  p_reason_code text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $reject$
declare
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea := digest(jsonb_build_object(
    'offer_id', p_offer_id, 'version', p_expected_version)::text, 'sha256');
  v_replay jsonb;
  v_offer public.dispatch_offers%rowtype;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_job_id uuid;
  v_reason text := lower(btrim(coalesce(p_reason_code, 'rider_declined')));
begin
  if p_offer_id is null or p_expected_version is null then
    raise exception 'reject invalido' using errcode = '22023';
  end if;
  if v_reason not in ('rider_declined','too_far','vehicle_issue','unsafe_route','other') then
    raise exception 'motivo de rechazo invalido' using errcode = '22023';
  end if;
  v_replay := public.dispatch_begin_command('reject_rider_dispatch_offer', v_key, v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  select o.job_id into v_job_id from public.dispatch_offers o where o.id = p_offer_id;
  if v_job_id is null then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  perform private.dispatch_lock_job(v_job_id);

  select o.* into v_offer from public.dispatch_offers o where o.id = p_offer_id for update;
  if not found or v_offer.rider_user_id <> auth.uid() then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  perform public.rider_require_active_membership(v_offer.business_id);

  if v_offer.status <> 'offered' then
    v_result := jsonb_build_object('ok', false, 'code',
      case when v_offer.status = 'rejected' then 'already_rejected' else 'offer_not_available' end,
      'idempotent_no_op', false,
      'state', public.rider_operational_state_payload(v_offer.business_id, auth.uid()));
    return public.dispatch_store_receipt(
      v_offer.business_id, 'reject_rider_dispatch_offer', v_key, v_fingerprint, v_result);
  end if;
  if v_offer.version <> p_expected_version then
    v_result := jsonb_build_object('ok', false, 'code', 'stale_version', 'idempotent_no_op', false,
      'state', public.rider_operational_state_payload(v_offer.business_id, auth.uid()));
    return public.dispatch_store_receipt(
      v_offer.business_id, 'reject_rider_dispatch_offer', v_key, v_fingerprint, v_result);
  end if;

  update public.dispatch_offers
     set status = 'rejected', responded_at = v_now, response_reason = v_reason
   where id = v_offer.id and status = 'offered';

  -- The next candidate is offered immediately on the following cycle tick.
  update public.dispatch_jobs
     set state = 'queued', round_no = round_no + 1, next_attempt_at = v_now,
         last_failure_code = 'OFFER_REJECTED',
         failure_evidence = jsonb_build_object('offer_id', v_offer.id)
   where id = v_offer.job_id and state = 'offering';

  insert into public.dispatch_events(
    business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
    event_type, actor_user_id, actor_role, detail
  ) values (
    v_offer.business_id, v_offer.job_id, v_offer.order_id, v_offer.id,
    v_offer.shift_id, auth.uid(), 'dispatch.offer_rejected', auth.uid(), 'rider',
    jsonb_build_object('reason', v_reason)
  );

  v_result := jsonb_build_object('ok', true, 'code', 'offer_rejected', 'idempotent_no_op', false,
    'state', public.rider_operational_state_payload(v_offer.business_id, auth.uid()));
  return public.dispatch_store_receipt(
    v_offer.business_id, 'reject_rider_dispatch_offer', v_key, v_fingerprint, v_result);
end;
$reject$;

-- ---------------------------------------------------------------------------
-- 6. Worker cycle
-- ---------------------------------------------------------------------------

create or replace function public.run_rider_dispatch_cycle(
  p_limit integer default 25,
  p_source text default 'cron'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $cycle$
declare
  v_run_id uuid;
  v_now timestamptz := clock_timestamp();
  v_expired integer := 0;
  v_processed integer := 0;
  v_offers integer := 0;
  v_no_rider integer := 0;
  v_job record;
  v_outcome jsonb;
  v_source text := case when coalesce(p_source, 'cron') in ('manual','cron','recovery','test')
                        then p_source else 'cron' end;
begin
  insert into public.rider_dispatch_worker_runs(source, started_at, status)
  values (v_source, v_now, 'running') returning id into v_run_id;

  update public.rider_dispatch_worker_state
     set last_started_at = v_now, updated_at = v_now where singleton;

  v_expired := private.dispatch_expire_leases(greatest(1, coalesce(p_limit, 25)) * 4);

  for v_job in
    -- Candidates are read without a row lock: dispatch_advance_job takes the
    -- advisory gate first, so the lock order stays the same on every path.
    select j.id
      from public.dispatch_jobs j
     where j.state in ('queued', 'ranking', 'no_rider_available')
       and j.next_attempt_at <= clock_timestamp()
     order by j.next_attempt_at, j.queued_at, j.id
     limit greatest(1, coalesce(p_limit, 25))
  loop
    v_outcome := private.dispatch_advance_job(v_job.id);
    v_processed := v_processed + 1;
    if coalesce((v_outcome->>'ok')::boolean, false) then
      v_offers := v_offers + 1;
    elsif coalesce(v_outcome->>'code', '') in
      ('NO_ELIGIBLE_RIDER','NO_ACTIVE_RIDERS','ALL_OFFERS_EXHAUSTED',
       'PICKUP_LOCATION_UNAVAILABLE','DESTINATION_LOCATION_UNAVAILABLE') then
      v_no_rider := v_no_rider + 1;
    end if;
  end loop;

  update public.rider_dispatch_worker_runs
     set finished_at = clock_timestamp(), status = 'succeeded', processed_jobs = v_processed,
         detail = jsonb_build_object('expired_offers', v_expired, 'offers_created', v_offers,
           'no_rider', v_no_rider)
   where id = v_run_id;

  update public.rider_dispatch_worker_state
     set last_success_at = clock_timestamp(), last_finished_at = clock_timestamp(),
         last_error_code = null, processed_jobs = v_processed, updated_at = clock_timestamp()
   where singleton;

  return jsonb_build_object(
    'ok', true, 'run_id', v_run_id, 'server_now', clock_timestamp(),
    'expired_offers', v_expired, 'processed_jobs', v_processed,
    'offers_created', v_offers, 'no_rider', v_no_rider
  );
end;
$cycle$;

-- ---------------------------------------------------------------------------
-- 7. Manual override
-- ---------------------------------------------------------------------------

-- Owner/admin fallback. It mutates the same job, revokes the live lease and
-- records actor plus reason. It never creates a second job.
create or replace function public.manual_override_dispatch(
  p_business_id uuid,
  p_order_id uuid,
  p_rider_user_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_expected_job_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $override$
declare
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea;
  v_replay jsonb;
  v_job public.dispatch_jobs%rowtype;
  v_order public.orders%rowtype;
  v_shift public.rider_shifts%rowtype;
  v_policy public.rider_dispatch_policies%rowtype;
  v_offer public.dispatch_offers%rowtype;
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_result jsonb;
  v_reward jsonb;
  v_job_id uuid;
begin
  if not public.has_business_role(p_business_id, array['owner','admin']) then
    raise exception 'owner/admin requerido' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 8 and 500 then
    raise exception 'motivo operativo requerido' using errcode = '22023';
  end if;
  v_fingerprint := digest(jsonb_build_object(
    'business_id', p_business_id, 'order_id', p_order_id,
    'rider_user_id', p_rider_user_id, 'reason', v_reason,
    'expected_job_revision', p_expected_job_revision)::text, 'sha256');
  v_replay := public.dispatch_begin_command('manual_override_dispatch', v_key, v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  -- Advisory gate before the first row lock, so an override and a Rider accept
  -- serialize instead of grabbing job and offer in opposite orders.
  select j.id into v_job_id from public.dispatch_jobs j
   where j.order_id = p_order_id and j.business_id = p_business_id;
  if v_job_id is null then
    raise exception 'trabajo de dispatch inexistente' using errcode = 'P0002';
  end if;
  perform private.dispatch_lock_job(v_job_id);

  select j.* into v_job from public.dispatch_jobs j where j.id = v_job_id for update;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;

  if p_expected_job_revision is not null and v_job.revision <> p_expected_job_revision then
    v_result := jsonb_build_object('ok', false, 'code', 'stale_revision',
      'idempotent_no_op', false, 'job_revision', v_job.revision);
    return public.dispatch_store_receipt(
      p_business_id, 'manual_override_dispatch', v_key, v_fingerprint, v_result);
  end if;
  if v_job.state = 'claimed' or v_order.assigned_rider_user_id is not null then
    v_result := jsonb_build_object('ok', false, 'code', 'order_taken',
      'idempotent_no_op', false, 'job_revision', v_job.revision,
      'assigned_rider_user_id', v_order.assigned_rider_user_id);
    return public.dispatch_store_receipt(
      p_business_id, 'manual_override_dispatch', v_key, v_fingerprint, v_result);
  end if;
  if v_order.status <> 'ready' then
    v_result := jsonb_build_object('ok', false, 'code', 'order_not_ready',
      'idempotent_no_op', false, 'order_status', v_order.status);
    return public.dispatch_store_receipt(
      p_business_id, 'manual_override_dispatch', v_key, v_fingerprint, v_result);
  end if;

  select s.* into v_shift from public.rider_shifts s
   where s.business_id = p_business_id and s.rider_user_id = p_rider_user_id
     and s.status in ('active','paused')
   for update;
  if not found then
    v_result := jsonb_build_object('ok', false, 'code', 'rider_without_shift', 'idempotent_no_op', false);
    return public.dispatch_store_receipt(
      p_business_id, 'manual_override_dispatch', v_key, v_fingerprint, v_result);
  end if;

  -- Revoke whatever lease is live before assigning: no double dispatch.
  for v_offer in
    select o.* from public.dispatch_offers o
     where o.job_id = v_job.id and o.status = 'offered' order by o.id for update
  loop
    update public.dispatch_offers
       set status = 'revoked', responded_at = v_now, response_reason = 'MANUAL_OVERRIDE'
     where id = v_offer.id;
    insert into public.dispatch_events(
      business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
      event_type, actor_user_id, actor_role, detail
    ) values (
      p_business_id, v_job.id, p_order_id, v_offer.id, v_offer.shift_id, v_offer.rider_user_id,
      'dispatch.offer_revoked', auth.uid(), 'business',
      jsonb_build_object('reason', 'MANUAL_OVERRIDE')
    );
  end loop;

  select p.* into v_policy from public.rider_dispatch_policies p
   where p.business_id = p_business_id and p.version = v_job.policy_version;
  v_reward := private.dispatch_reward_snapshot(v_policy, null);

  -- A fresh round keeps the override row unique even when the overridden
  -- Rider is the same one who was holding the lease we just revoked.
  update public.dispatch_jobs set round_no = round_no + 1
   where id = v_job.id returning * into v_job;

  insert into public.dispatch_offers(
    job_id, business_id, order_id, rider_user_id, shift_id, round_no, rank, score,
    source, status, expected_order_revision, job_revision_at_offer,
    offered_at, lease_expires_at, responded_at, response_reason,
    estimated_reward, reward_currency, reward_snapshot, safe_payload
  ) values (
    v_job.id, p_business_id, p_order_id, p_rider_user_id, v_shift.id,
    v_job.round_no, 1, 0, 'manual_override', 'accepted',
    v_order.revision, v_job.revision, v_now, v_now + interval '1 minute', v_now, 'MANUAL_OVERRIDE',
    (v_reward->>'total')::numeric, v_policy.reward_currency, v_reward,
    private.dispatch_safe_payload(p_order_id, null, null, v_now + interval '1 minute')
  )
  returning * into v_offer;

  update public.dispatch_jobs
     set state = 'claimed', assigned_rider_user_id = p_rider_user_id,
         claimed_shift_id = v_shift.id, claimed_at = v_now,
         last_failure_code = null, failure_evidence = '{}'::jsonb
   where id = v_job.id
  returning * into v_job;

  update public.orders
     set assigned_rider_user_id = p_rider_user_id, status = 'assigned'
   where id = p_order_id and assigned_rider_user_id is null and status = 'ready';
  if not found then
    raise exception 'carrera de asignacion detectada' using errcode = '40001';
  end if;

  update public.rider_dispatch_profiles
     set last_assigned_at = v_now, updated_at = v_now
   where business_id = p_business_id and rider_user_id = p_rider_user_id;

  insert into public.rider_reward_ledger(
    business_id, order_id, job_id, offer_id, shift_id, rider_user_id,
    entry_type, entry_key, amount, currency, policy_version, snapshot
  ) values (
    p_business_id, p_order_id, v_job.id, v_offer.id, v_shift.id, p_rider_user_id,
    'estimated', 'estimated:' || p_order_id::text, v_offer.estimated_reward,
    v_offer.reward_currency, v_job.policy_version, v_offer.reward_snapshot
  )
  on conflict (business_id, entry_key) do nothing;

  perform public.reconcile_rider_shift(v_shift.id);

  insert into public.dispatch_events(
    business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
    event_type, actor_user_id, actor_role, detail
  ) values (
    p_business_id, v_job.id, p_order_id, v_offer.id, v_shift.id, p_rider_user_id,
    'dispatch.manual_override', auth.uid(), 'business',
    jsonb_build_object('reason', v_reason, 'job_revision', v_job.revision)
  );

  v_result := jsonb_build_object('ok', true, 'code', 'claimed', 'outcome', 'claimed',
    'idempotent_no_op', false, 'job_revision', v_job.revision,
    'assigned_rider_user_id', p_rider_user_id);
  return public.dispatch_store_receipt(
    p_business_id, 'manual_override_dispatch', v_key, v_fingerprint, v_result);
end;
$override$;

-- ---------------------------------------------------------------------------
-- 8. Order lifecycle bridge
-- ---------------------------------------------------------------------------

create or replace function public.sync_order_dispatch_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $lifecycle$
declare
  v_job public.dispatch_jobs%rowtype;
  v_offer public.dispatch_offers%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  -- Ready is the only automatic trigger, and only on a real transition.
  if new.status = 'ready' and old.status is distinct from 'ready'
    and new.assigned_rider_user_id is null then
    perform public.enqueue_rider_dispatch_job(new.id);
    return new;
  end if;

  select j.* into v_job from public.dispatch_jobs j where j.order_id = new.id;
  if not found then return new; end if;

  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    select o.* into v_offer from public.dispatch_offers o
     where o.job_id = v_job.id and o.status = 'accepted' limit 1;
    if found and new.assigned_rider_user_id = v_offer.rider_user_id then
      -- Exactly-once earned entry, frozen at the conditions accepted.
      insert into public.rider_reward_ledger(
        business_id, order_id, job_id, offer_id, shift_id, rider_user_id,
        entry_type, entry_key, amount, currency, policy_version, snapshot
      ) values (
        v_job.business_id, new.id, v_job.id, v_offer.id, v_offer.shift_id,
        v_offer.rider_user_id, 'earned', 'earned:' || new.id::text,
        v_offer.estimated_reward, v_offer.reward_currency, v_job.policy_version,
        v_offer.reward_snapshot || jsonb_build_object('settled_at', v_now)
      )
      on conflict (business_id, entry_key) do nothing;
    end if;
    update public.dispatch_jobs
       set state = 'completed', completed_at = v_now
     where id = v_job.id and state <> 'completed';
    insert into public.dispatch_events(business_id, job_id, order_id, rider_user_id,
      event_type, actor_role, detail)
    values (v_job.business_id, v_job.id, new.id, new.assigned_rider_user_id,
      'dispatch.job_completed', 'system', jsonb_build_object('reward_settled', v_offer.id is not null));
    if v_offer.shift_id is not null then perform public.reconcile_rider_shift(v_offer.shift_id); end if;
    return new;
  end if;

  if new.status in ('cancelled', 'canceled', 'rejected') then
    perform public.lock_and_revoke_job_offers(v_job.id, 'ORDER_' || upper(new.status));
    update public.dispatch_jobs
       set state = 'cancelled', cancelled_at = v_now,
           last_failure_code = 'ORDER_' || upper(new.status)
     where id = v_job.id and state not in ('completed', 'cancelled');
    insert into public.dispatch_events(business_id, job_id, order_id,
      event_type, actor_role, detail)
    values (v_job.business_id, v_job.id, new.id, 'dispatch.job_cancelled', 'system',
      jsonb_build_object('reason', 'ORDER_' || upper(new.status)));
    return new;
  end if;

  -- Any other change that makes the order unofferable revokes the live lease.
  -- An assignment produced by this engine keeps its offer accepted, so this
  -- only catches legacy or out-of-band assignment paths.
  if v_job.state = 'offering'
    and (new.assigned_rider_user_id is not null or new.status <> 'ready') then
    perform public.lock_and_revoke_job_offers(v_job.id, 'ORDER_CHANGED');
    update public.dispatch_jobs
       set state = case when new.assigned_rider_user_id is not null then 'cancelled' else 'queued' end,
           cancelled_at = case when new.assigned_rider_user_id is not null then v_now else null end,
           last_failure_code = 'ORDER_CHANGED', next_attempt_at = v_now
     where id = v_job.id;
  end if;

  return new;
end;
$lifecycle$;

-- Revokes every live lease of one job. Mirrors lock_and_revoke_shift_offers
-- but keyed by job, for order-driven invalidation.
create or replace function public.lock_and_revoke_job_offers(
  p_job_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $revoke_job$
declare
  v_offer record;
  v_count integer := 0;
begin
  for v_offer in
    select o.id as offer_id, o.business_id, o.order_id, o.shift_id, o.rider_user_id
      from public.dispatch_offers o
     where o.job_id = p_job_id and o.status = 'offered'
     order by o.id
     for update
  loop
    update public.dispatch_offers
       set status = 'revoked', responded_at = clock_timestamp(), response_reason = p_reason
     where id = v_offer.offer_id and status = 'offered';
    if found then
      insert into public.dispatch_events(
        business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
        event_type, actor_user_id, actor_role, detail
      ) values (
        v_offer.business_id, p_job_id, v_offer.order_id, v_offer.offer_id,
        v_offer.shift_id, v_offer.rider_user_id, 'dispatch.offer_revoked', auth.uid(),
        'system', jsonb_build_object('reason', p_reason)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$revoke_job$;

drop trigger if exists orders_sync_dispatch_lifecycle on public.orders;
create trigger orders_sync_dispatch_lifecycle
after update of status, assigned_rider_user_id on public.orders
for each row execute function public.sync_order_dispatch_lifecycle();

-- ---------------------------------------------------------------------------
-- 9. Panel projection
-- ---------------------------------------------------------------------------

-- Aggregate control surface. It classifies presence instead of exposing it:
-- no coordinates, no customer name, phone, address or notes ever leave here.
create or replace function public.get_business_dispatch_control(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $control$
declare
  v_now timestamptz := clock_timestamp();
  v_policy public.rider_dispatch_policies%rowtype;
  v_riders jsonb;
  v_jobs jsonb;
  v_metrics jsonb;
  v_alerts jsonb;
  v_assignments integer[];
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'permiso de negocio requerido' using errcode = '42501';
  end if;

  select p.* into v_policy from public.rider_dispatch_policies p
   where p.business_id = p_business_id order by p.version desc limit 1;

  select coalesce(jsonb_agg(r order by r->>'rider_user_id'), '[]'::jsonb) into v_riders
  from (
    select jsonb_build_object(
      'rider_user_id', bm.user_id,
      'max_concurrent_orders', coalesce(sh.max_concurrent_orders, 1),
      'is_blocked', coalesce(pr.is_blocked, false),
      'zone', coalesce(sh.zone_code, pr.zone_code, '*'),
      'assignments_last_4h', (
        select count(*)::integer from public.dispatch_offers o
         where o.business_id = p_business_id and o.rider_user_id = bm.user_id
           and o.status = 'accepted' and o.responded_at >= v_now - interval '4 hours'
      ),
      'shift', case when sh.id is null then null else jsonb_build_object(
        'shift_id', sh.id, 'status', sh.status, 'availability', sh.availability,
        'current_active_orders', sh.current_active_orders,
        'max_concurrent_orders', sh.max_concurrent_orders,
        'started_at', sh.started_at, 'ends_at', sh.ends_at
      ) end,
      'presence', jsonb_build_object(
        'heartbeat_state', case
          when pres.heartbeat_at is null then 'missing'
          when pres.heartbeat_at < v_now - make_interval(secs => v_policy.heartbeat_ttl_seconds) then 'stale'
          else 'fresh' end,
        'gps_state', case
          when pres.captured_at is null then 'missing'
          when pres.captured_at < v_now - make_interval(secs => v_policy.gps_ttl_seconds) then 'stale'
          else 'fresh' end,
        'accuracy_state', case
          when pres.accuracy_m is null then 'missing'
          when pres.accuracy_m > v_policy.max_gps_accuracy_m then 'coarse'
          else 'acceptable' end
      )
    ) as r
    from public.business_members bm
    left join public.rider_dispatch_profiles pr
      on pr.business_id = p_business_id and pr.rider_user_id = bm.user_id
    left join public.rider_shifts sh
      on sh.business_id = p_business_id and sh.rider_user_id = bm.user_id
     and sh.status in ('active','paused')
    left join private.rider_dispatch_presence pres
      on pres.business_id = p_business_id and pres.rider_user_id = bm.user_id
    where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active = true
  ) riders;

  select coalesce(jsonb_agg(j order by j->>'queued_at' desc), '[]'::jsonb) into v_jobs
  from (
    select jsonb_build_object(
      'job_id', dj.id,
      'order_id', dj.order_id,
      'order_code', o.public_code,
      'state', dj.state,
      'revision', dj.revision,
      'round_no', dj.round_no,
      'attempt_count', dj.attempt_count,
      'queued_at', dj.queued_at,
      'first_offer_at', dj.first_offer_at,
      'claimed_at', dj.claimed_at,
      'assigned_rider_user_id', dj.assigned_rider_user_id,
      'last_failure_code', dj.last_failure_code,
      'next_attempt_at', dj.next_attempt_at,
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rider_user_id', e.rider_user_id, 'eligible', e.eligible,
          'score', e.score, 'rank', e.rank, 'exclusion_codes', e.exclusion_codes,
          'distance_to_pickup_m', e.distance_to_pickup_m
        ) order by e.rank nulls last, e.rider_user_id)
        from public.dispatch_evaluations e
        where e.job_id = dj.id and e.round_no = dj.round_no
      ), '[]'::jsonb),
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'event_type', t.event_type, 'occurred_at', t.created_at,
          'reason_code', coalesce(t.detail->>'code', t.detail->>'reason'),
          'actor_role', t.actor_role
        ) order by t.id)
        from (
          select ev.id, ev.event_type, ev.created_at, ev.detail, ev.actor_role
          from public.dispatch_events ev
          where ev.job_id = dj.id order by ev.id desc limit 20
        ) t
      ), '[]'::jsonb)
    ) as j
    from public.dispatch_jobs dj
    join public.orders o on o.id = dj.order_id
    where dj.business_id = p_business_id
      and (dj.state not in ('completed','cancelled') or dj.updated_at >= v_now - interval '6 hours')
    order by dj.queued_at desc
    limit 60
  ) jobs;

  select array_agg(cnt) into v_assignments
  from (
    -- count(o.id), not count(*): the left join yields one null row per Rider
    -- with no assignment, which would otherwise read as one assignment each.
    select count(o.id)::integer as cnt
      from public.business_members bm
      left join public.dispatch_offers o
        on o.business_id = p_business_id and o.rider_user_id = bm.user_id
       and o.status = 'accepted' and o.responded_at >= v_now - interval '24 hours'
     where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active = true
     group by bm.user_id
  ) counts;

  v_metrics := jsonb_build_object(
    'backlog_jobs', (select count(*)::integer from public.dispatch_jobs j
      where j.business_id = p_business_id and j.state in ('queued','ranking','offering')),
    'no_rider_jobs', (select count(*)::integer from public.dispatch_jobs j
      where j.business_id = p_business_id and j.state = 'no_rider_available'),
    'oldest_job_seconds', (select coalesce(max(floor(extract(epoch from (v_now - j.queued_at))))::integer, 0)
      from public.dispatch_jobs j where j.business_id = p_business_id
        and j.state in ('queued','ranking','offering','no_rider_available')),
    'active_riders', (select count(*)::integer from public.rider_shifts s
      where s.business_id = p_business_id and s.status = 'active'),
    'stale_riders', (select count(*)::integer from public.rider_shifts s
      left join private.rider_dispatch_presence pr on pr.shift_id = s.id
      where s.business_id = p_business_id and s.status = 'active'
        and (pr.heartbeat_at is null
             or pr.heartbeat_at < v_now - make_interval(secs => v_policy.heartbeat_ttl_seconds))),
    'ready_to_job_seconds_p95', (
      select round(percentile_cont(0.95) within group (
        order by extract(epoch from (j.queued_at - o.ready_at)))::numeric, 2)
      from public.dispatch_jobs j join public.orders o on o.id = j.order_id
      where j.business_id = p_business_id and o.ready_at is not null
        and j.queued_at >= v_now - interval '24 hours'),
    'job_to_first_offer_seconds_p95', (
      select round(percentile_cont(0.95) within group (
        order by extract(epoch from (j.first_offer_at - j.queued_at)))::numeric, 2)
      from public.dispatch_jobs j
      where j.business_id = p_business_id and j.first_offer_at is not null
        and j.queued_at >= v_now - interval '24 hours'),
    'offer_to_accept_seconds_p95', (
      select round(percentile_cont(0.95) within group (
        order by extract(epoch from (o.responded_at - o.offered_at)))::numeric, 2)
      from public.dispatch_offers o
      where o.business_id = p_business_id and o.status = 'accepted'
        and o.responded_at >= v_now - interval '24 hours'),
    'jain_fairness', case
      when v_assignments is null or array_length(v_assignments, 1) is null then null
      when (select sum(x) from unnest(v_assignments) x) = 0 then 1.0
      else round(
        (power((select sum(x) from unnest(v_assignments) x)::numeric, 2)
         / (array_length(v_assignments, 1)
            * (select sum(power(x::numeric, 2)) from unnest(v_assignments) x))), 3)
      end,
    'assignments_per_rider', to_jsonb(coalesce(v_assignments, '{}'::integer[]))
  );

  select coalesce(jsonb_agg(a order by a->>'code'), '[]'::jsonb) into v_alerts
  from (
    select jsonb_build_object(
      'code', code, 'severity', severity, 'occurrence_count', occurrence_count,
      'last_seen_at', last_seen_at, 'evidence', evidence
    ) as a
    from (
      select 'NO_ELIGIBLE_RIDER' as code, 'warning' as severity,
             count(*)::integer as occurrence_count, max(j.updated_at) as last_seen_at,
             jsonb_build_object('jobs', count(*)::integer) as evidence
        from public.dispatch_jobs j
       where j.business_id = p_business_id and j.state = 'no_rider_available'
       having count(*) > 0
      union all
      select 'DISPATCH_JOB_STALLED', 'critical', count(*)::integer, max(j.queued_at),
             jsonb_build_object('threshold_seconds', v_policy.job_stalled_seconds)
        from public.dispatch_jobs j
       where j.business_id = p_business_id
         and j.state in ('queued','ranking','offering')
         and j.queued_at < v_now - make_interval(secs => v_policy.job_stalled_seconds)
       having count(*) > 0
      union all
      select 'RIDER_HEARTBEAT_STALE', 'warning', count(*)::integer, max(s.state_changed_at),
             jsonb_build_object('riders', count(*)::integer)
        from public.rider_shifts s
        left join private.rider_dispatch_presence pr on pr.shift_id = s.id
       where s.business_id = p_business_id and s.status = 'active'
         and (pr.heartbeat_at is null
              or pr.heartbeat_at < v_now - make_interval(secs => v_policy.heartbeat_ttl_seconds))
       having count(*) > 0
    ) raw
  ) alerts;

  return jsonb_build_object(
    'server_now', v_now,
    'generated_at', v_now,
    'settings', (
      select jsonb_build_object('auto_dispatch_enabled', s.auto_dispatch_enabled,
        'qa_fixture_only', s.qa_fixture_only, 'version', s.version)
      from public.business_dispatch_settings s where s.business_id = p_business_id
    ),
    'riders', v_riders,
    'jobs', v_jobs,
    'metrics', v_metrics,
    'alerts', v_alerts
  );
end;
$control$;

-- ---------------------------------------------------------------------------
-- 10. Legacy claim bypass closure
-- ---------------------------------------------------------------------------

-- A Rider could still reach `ready -> on_the_way` while self-assigning through
-- either legacy signature. Revoking only change_order_status left the bypass
-- open through transition_order, which delegates into it. Both direct grants
-- go away; the Panel keeps using the idempotent four-argument wrapper.
revoke execute on function public.change_order_status(uuid, text, text)
from public, anon, authenticated;

revoke execute on function public.transition_order(uuid, bigint, text)
from public, anon, authenticated;

comment on function public.change_order_status(uuid, text, text) is
  'Legacy helper. Direct execute is revoked: it allowed a Rider to self-assign '
  'ready->on_the_way outside the canonical claim. Reachable only through '
  'security-definer wrappers that enforce CAS, idempotency and dispatch leases.';

comment on function public.transition_order(uuid, bigint, text) is
  'Legacy three-argument transition. Direct execute is revoked because it '
  'delegates into change_order_status and reopened the claim bypass.';

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------

-- Internal helpers stay unreachable from browser roles.
revoke all on function private.dispatch_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function private.dispatch_zones_match(text, text) from public, anon, authenticated;
revoke all on function private.dispatch_lock_job(uuid) from public, anon, authenticated;
revoke all on function private.dispatch_try_lock_job(uuid) from public, anon, authenticated;
revoke all on function private.dispatch_reward_snapshot(public.rider_dispatch_policies, integer) from public, anon, authenticated;
revoke all on function private.dispatch_safe_payload(uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function private.dispatch_evaluate_round(uuid) from public, anon, authenticated;
revoke all on function private.dispatch_advance_job(uuid) from public, anon, authenticated;
revoke all on function private.dispatch_expire_leases(integer) from public, anon, authenticated;
revoke all on function private.rider_dispatch_origin_allowed(uuid, text) from public, anon, authenticated;

revoke all on function public.dispatch_validate_idempotency_key(text) from public, anon, authenticated;
revoke all on function public.dispatch_normalize_zone(text) from public, anon, authenticated;
revoke all on function public.dispatch_current_rider_business() from public, anon, authenticated;
revoke all on function public.dispatch_lock_shift(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_lock_rider(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ensure_rider_dispatch_policy(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_begin_command(text, text, bytea) from public, anon, authenticated;
revoke all on function public.dispatch_store_receipt(uuid, text, text, bytea, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_rider_dispatch_job(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_rider_shift(uuid) from public, anon, authenticated;
revoke all on function public.lock_and_revoke_shift_offers(uuid, text) from public, anon, authenticated;
revoke all on function public.lock_and_revoke_job_offers(uuid, text) from public, anon, authenticated;
revoke all on function public.rider_operational_state_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sync_order_dispatch_lifecycle() from public, anon, authenticated;

-- Rider surface.
revoke all on function public.get_rider_operational_state() from public, anon;
revoke all on function public.rider_work_now(text) from public, anon;
revoke all on function public.rider_start_shift(uuid, bigint, text) from public, anon;
revoke all on function public.rider_pause_shift(uuid, bigint, text) from public, anon;
revoke all on function public.rider_resume_shift(uuid, bigint, text) from public, anon;
revoke all on function public.rider_end_shift(uuid, bigint, text) from public, anon;
revoke all on function public.rider_shift_heartbeat(uuid, bigint, timestamptz, double precision, double precision, double precision, boolean) from public, anon;
revoke all on function public.accept_rider_dispatch_offer(uuid, bigint, text) from public, anon;
revoke all on function public.reject_rider_dispatch_offer(uuid, bigint, text, text) from public, anon;

grant execute on function public.get_rider_operational_state() to authenticated;
grant execute on function public.rider_work_now(text) to authenticated;
grant execute on function public.rider_start_shift(uuid, bigint, text) to authenticated;
grant execute on function public.rider_pause_shift(uuid, bigint, text) to authenticated;
grant execute on function public.rider_resume_shift(uuid, bigint, text) to authenticated;
grant execute on function public.rider_end_shift(uuid, bigint, text) to authenticated;
grant execute on function public.rider_shift_heartbeat(uuid, bigint, timestamptz, double precision, double precision, double precision, boolean) to authenticated;
grant execute on function public.accept_rider_dispatch_offer(uuid, bigint, text) to authenticated;
grant execute on function public.reject_rider_dispatch_offer(uuid, bigint, text, text) to authenticated;

-- Panel surface.
revoke all on function public.get_business_dispatch_control(uuid) from public, anon;
revoke all on function public.schedule_rider_shift(uuid, uuid, timestamptz, timestamptz, text, integer, text) from public, anon;
revoke all on function public.configure_rider_dispatch_profile(uuid, uuid, boolean, text, text, integer, text) from public, anon;
revoke all on function public.configure_business_auto_dispatch(uuid, boolean, boolean, text, text) from public, anon;
revoke all on function public.manual_override_dispatch(uuid, uuid, uuid, text, text, bigint) from public, anon;

grant execute on function public.get_business_dispatch_control(uuid) to authenticated;
grant execute on function public.schedule_rider_shift(uuid, uuid, timestamptz, timestamptz, text, integer, text) to authenticated;
grant execute on function public.configure_rider_dispatch_profile(uuid, uuid, boolean, text, text, integer, text) to authenticated;
grant execute on function public.configure_business_auto_dispatch(uuid, boolean, boolean, text, text) to authenticated;
grant execute on function public.manual_override_dispatch(uuid, uuid, uuid, text, text, bigint) to authenticated;

-- Worker surface: never reachable from a browser session.
revoke all on function public.run_rider_dispatch_cycle(integer, text) from public, anon, authenticated;
grant execute on function public.run_rider_dispatch_cycle(integer, text) to service_role;

comment on function public.accept_rider_dispatch_offer(uuid, bigint, text) is
  'Transactional claim. Locks offer -> job -> order, revalidates lease, shift, '
  'heartbeat and capacity against the server clock, and yields exactly one winner.';
comment on function public.run_rider_dispatch_cycle(integer, text) is
  'Worker cycle: expires leases, advances jobs with FOR UPDATE SKIP LOCKED and '
  'records worker health. service_role only.';
comment on function public.get_business_dispatch_control(uuid) is
  'Panel aggregate. Classifies presence instead of exposing it: no coordinates '
  'and no customer PII cross this boundary.';
