-- TABA2 automated Rider dispatch: authenticated commands and deterministic engine.

-- ---------------------------------------------------------------------------
-- Shared authority, idempotency and normalization helpers
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_validate_idempotency_key(p_key text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
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

create or replace function public.dispatch_normalize_zone(p_zone text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $zone$
  select coalesce(
    nullif(left(trim(both '_' from regexp_replace(lower(btrim(coalesce(p_zone, ''))), '[^a-z0-9]+', '_', 'g')), 40), ''),
    '*'
  );
$zone$;

create or replace function public.dispatch_current_rider_business()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $business$
declare
  v_business_id uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'autenticacion Rider requerida' using errcode = '42501';
  end if;

  select min(bm.business_id::text)::uuid, count(*)::integer
    into v_business_id, v_count
    from public.business_members bm
   where bm.user_id = auth.uid()
     and bm.role = 'rider'
     and bm.is_active = true;

  if v_count = 0 then
    raise exception 'membership Rider activa requerida' using errcode = '42501';
  end if;
  if v_count > 1 then
    raise exception 'membership Rider ambigua' using errcode = '55000';
  end if;
  return v_business_id;
end;
$business$;

create or replace function public.dispatch_lock_shift(p_shift_id uuid)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $lock$
  select pg_advisory_xact_lock(hashtextextended('rider-dispatch-shift:' || p_shift_id::text, 0));
$lock$;

create or replace function public.dispatch_lock_rider(p_business_id uuid, p_rider_user_id uuid)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $lock$
  select pg_advisory_xact_lock(hashtextextended(
    'rider-dispatch-rider:' || p_business_id::text || ':' || p_rider_user_id::text,
    0
  ));
$lock$;

-- Todo camino que toque un job, su lease o su asignacion toma este lock ANTES
-- de cualquier lock de fila. Sin una unica puerta los caminos discrepan en el
-- orden -- accept recorre oferta -> job y el override manual job -> oferta -- y
-- se traban entre si bajo concurrencia.
create or replace function private.dispatch_lock_job(p_job_id uuid)
returns void
language sql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $lock_job$
  select pg_advisory_xact_lock(hashtextextended('rider-dispatch-job:' || p_job_id::text, 0));
$lock_job$;

-- Variante no bloqueante para el worker: un job que otro worker ya esta
-- avanzando se saltea, que es el equivalente advisory de SKIP LOCKED.
create or replace function private.dispatch_try_lock_job(p_job_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $try_lock_job$
  select pg_try_advisory_xact_lock(hashtextextended('rider-dispatch-job:' || p_job_id::text, 0));
$try_lock_job$;

create or replace function private.rider_dispatch_origin_allowed(
  p_order_id uuid,
  p_origin text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $origin$
  select coalesce(p_origin = 'production', false)
    or (
      p_origin = 'qa'
      and exists (
        select 1
          from private.rider_dispatch_qa_allowlist qa
         where qa.order_id = p_order_id
           and qa.expires_at > clock_timestamp()
      )
    );
$origin$;

create or replace function public.ensure_rider_dispatch_policy(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $policy$
declare
  v_version integer;
begin
  if p_business_id is null then
    raise exception 'business_id requerido' using errcode = '22023';
  end if;

  insert into public.rider_dispatch_policies(
    business_id, version, reward_currency
  )
  select b.id, 1, coalesce(nullif(upper(b.currency_code), ''), 'ARS')
    from public.businesses b
   where b.id = p_business_id
  on conflict (business_id, version) do nothing;

  insert into public.business_dispatch_settings(business_id)
  select b.id from public.businesses b where b.id = p_business_id
  on conflict (business_id) do nothing;

  select max(p.version) into v_version
    from public.rider_dispatch_policies p
   where p.business_id = p_business_id;

  if v_version is null then
    raise exception 'negocio inexistente para dispatch' using errcode = '23503';
  end if;
  return v_version;
end;
$policy$;

create or replace function public.dispatch_begin_command(
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $begin$
declare
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_receipt public.dispatch_command_receipts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_operation !~ '^[a-z][a-z0-9_]{2,79}$' or p_request_fingerprint is null then
    raise exception 'comando dispatch invalido' using errcode = '22023';
  end if;

  -- The receipt key is also the serialization key. This prevents two commands
  -- on different aggregate rows from both applying before the receipt conflict.
  perform pg_advisory_xact_lock(hashtextextended(
    auth.uid()::text || ':' || p_operation || ':' || v_key,
    0
  ));

  select r.* into v_receipt
    from public.dispatch_command_receipts r
   where r.actor_user_id = auth.uid()
     and r.operation = p_operation
     and r.idempotency_key = v_key
   for share;

  if found then
    if v_receipt.request_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_no_op', true);
  end if;
  return null;
end;
$begin$;

create or replace function public.dispatch_store_receipt(
  p_business_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $store$
declare
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_stored public.dispatch_command_receipts%rowtype;
begin
  insert into public.dispatch_command_receipts(
    actor_user_id, business_id, operation, idempotency_key,
    request_fingerprint, result
  ) values (
    auth.uid(), p_business_id, p_operation, v_key,
    p_request_fingerprint, p_result
  )
  on conflict (actor_user_id, operation, idempotency_key) do nothing;

  select r.* into v_stored
    from public.dispatch_command_receipts r
   where r.actor_user_id = auth.uid()
     and r.operation = p_operation
     and r.idempotency_key = v_key;

  if v_stored.request_fingerprint <> p_request_fingerprint then
    raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
  end if;
  return v_stored.result;
end;
$store$;

create or replace function public.enqueue_rider_dispatch_job(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $enqueue$
declare
  v_order public.orders%rowtype;
  v_job_id uuid;
  v_policy_version integer;
  v_inserted boolean := false;
  v_settings public.business_dispatch_settings%rowtype;
begin
  select o.* into v_order
    from public.orders o
   where o.id = p_order_id;
  if not found then return null; end if;

  if v_order.status <> 'ready'
    or coalesce(v_order.fulfillment_type, v_order.delivery_mode) <> 'delivery'
    or v_order.assigned_rider_user_id is not null
    or not private.rider_dispatch_origin_allowed(v_order.id, v_order.origin) then
    return null;
  end if;

  v_policy_version := public.ensure_rider_dispatch_policy(v_order.business_id);
  select s.* into v_settings
    from public.business_dispatch_settings s
   where s.business_id = v_order.business_id;
  if not coalesce(v_settings.auto_dispatch_enabled, false)
    or (v_settings.qa_fixture_only and v_order.origin <> 'qa') then
    return null;
  end if;

  insert into public.dispatch_jobs(
    business_id, order_id, state, policy_version, dispatch_zone,
    queued_at, next_attempt_at
  ) values (
    v_order.business_id, v_order.id, 'queued', v_policy_version,
    public.dispatch_normalize_zone(v_order.customer_neighborhood),
    clock_timestamp(), clock_timestamp()
  )
  on conflict (order_id) do nothing
  returning id into v_job_id;

  if v_job_id is not null then
    v_inserted := true;
  else
    select j.id into v_job_id
      from public.dispatch_jobs j
     where j.order_id = v_order.id;
  end if;

  if v_inserted then
    insert into public.dispatch_events(
      business_id, job_id, order_id, event_type, actor_role, detail
    ) values (
      v_order.business_id, v_job_id, v_order.id,
      'dispatch.job_queued', 'system',
      jsonb_build_object(
        'order_revision', v_order.revision,
        'origin', v_order.origin,
        'trigger', 'order_ready'
      )
    );
  end if;
  return v_job_id;
end;
$enqueue$;

create or replace function public.reconcile_rider_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $reconcile$
declare
  v_shift public.rider_shifts%rowtype;
  v_policy public.rider_dispatch_policies%rowtype;
  v_presence private.rider_dispatch_presence%rowtype;
  v_active_count integer := 0;
  v_membership_active boolean := false;
  v_blocked boolean := false;
  v_availability text := 'unavailable';
  v_now timestamptz := clock_timestamp();
begin
  select s.* into v_shift
    from public.rider_shifts s
   where s.id = p_shift_id
   for update;
  if not found then return null; end if;

  select p.* into v_policy
    from public.rider_dispatch_policies p
   where p.business_id = v_shift.business_id
   order by p.version desc
   limit 1;

  if v_shift.status in ('active','paused') then
    -- Capacity includes every active assignment, including a legacy/manual row
    -- that predates dispatch_jobs. No alternate assignment path can hide load.
    select count(*)::integer into v_active_count
      from public.orders o
     where o.business_id = v_shift.business_id
       and o.assigned_rider_user_id = v_shift.rider_user_id
       and o.status in ('assigned','picked_up','on_the_way','arrived');
  else
    select count(*)::integer into v_active_count
      from public.dispatch_jobs j
      join public.orders o on o.id = j.order_id
     where j.claimed_shift_id = v_shift.id
       and o.assigned_rider_user_id = v_shift.rider_user_id
       and o.status in ('assigned','picked_up','on_the_way','arrived');
  end if;

  select exists (
    select 1 from public.business_members bm
     where bm.business_id = v_shift.business_id
       and bm.user_id = v_shift.rider_user_id
       and bm.role = 'rider' and bm.is_active = true
  ) into v_membership_active;

  select coalesce(p.is_blocked, false) into v_blocked
    from public.rider_dispatch_profiles p
   where p.business_id = v_shift.business_id
     and p.rider_user_id = v_shift.rider_user_id;
  v_blocked := coalesce(v_blocked, false);

  select rp.* into v_presence
    from private.rider_dispatch_presence rp
   where rp.shift_id = v_shift.id;

  if v_shift.status = 'active'
    and v_shift.ends_at > v_now
    and v_active_count >= v_shift.max_concurrent_orders then
    v_availability := 'at_capacity';
  elsif v_shift.status = 'active'
    and v_shift.ends_at > v_now
    and v_membership_active
    and not v_blocked
    and v_presence.shift_id is not null
    and not v_presence.is_mock
    and v_presence.heartbeat_at >= v_now - make_interval(secs => v_policy.heartbeat_ttl_seconds)
    and v_presence.captured_at >= v_now - make_interval(secs => v_policy.gps_ttl_seconds)
    and v_presence.accuracy_m <= v_policy.max_gps_accuracy_m then
    v_availability := 'available';
  end if;

  update public.rider_shifts s
     set current_active_orders = least(v_active_count, s.max_concurrent_orders),
         availability = v_availability
   where s.id = v_shift.id
     and (
       s.current_active_orders is distinct from least(v_active_count, s.max_concurrent_orders)
       or s.availability is distinct from v_availability
     )
  returning s.* into v_shift;

  if not found then
    select s.* into v_shift from public.rider_shifts s where s.id = p_shift_id;
  end if;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'status', v_shift.status,
    'availability', v_shift.availability,
    'current_active_orders', v_shift.current_active_orders,
    'max_concurrent_orders', v_shift.max_concurrent_orders,
    'version', v_shift.version
  );
end;
$reconcile$;

create or replace function public.lock_and_revoke_shift_offers(
  p_shift_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $revoke$
declare
  v_offer record;
  v_count integer := 0;
begin
  for v_offer in
    -- Sin `for update` en el join: el orden global de locks es advisory del job
    -- primero y despues las filas. Tomar oferta y job en una sola sentencia
    -- deja el orden a merced del plan y choca con accept/override.
    select o.id as offer_id, o.job_id, o.business_id, o.order_id, o.rider_user_id
      from public.dispatch_offers o
     where o.shift_id = p_shift_id and o.status = 'offered'
     order by o.id
  loop
    perform private.dispatch_lock_job(v_offer.job_id);

    update public.dispatch_offers
       set status = 'revoked', responded_at = clock_timestamp(), response_reason = p_reason
     where id = v_offer.offer_id and status = 'offered';
    if found then
      update public.dispatch_jobs
         set state = 'queued', next_attempt_at = clock_timestamp(),
             last_failure_code = 'OFFER_REVOKED',
             failure_evidence = jsonb_build_object('reason', p_reason)
       where id = v_offer.job_id and state = 'offering';
      insert into public.dispatch_events(
        business_id, job_id, order_id, offer_id, shift_id, rider_user_id,
        event_type, actor_user_id, actor_role, detail
      ) values (
        v_offer.business_id, v_offer.job_id, v_offer.order_id, v_offer.offer_id,
        p_shift_id, v_offer.rider_user_id, 'dispatch.offer_revoked', auth.uid(),
        case when auth.uid() = v_offer.rider_user_id then 'rider' else 'business' end,
        jsonb_build_object('reason', p_reason)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$revoke$;

-- ---------------------------------------------------------------------------
-- Rider and Panel shift/profile commands
-- ---------------------------------------------------------------------------

create or replace function public.rider_work_now(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $work$
declare
  v_business_id uuid := public.dispatch_current_rider_business();
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea := digest(jsonb_build_object('business_id', v_business_id)::text, 'sha256');
  v_replay jsonb;
  v_shift public.rider_shifts%rowtype;
  v_profile public.rider_dispatch_profiles%rowtype;
  v_policy public.rider_dispatch_policies%rowtype;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_replay := public.dispatch_begin_command('rider_work_now', v_key, v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  perform public.dispatch_lock_rider(v_business_id, auth.uid());

  perform public.ensure_rider_dispatch_policy(v_business_id);
  select p.* into v_policy from public.rider_dispatch_policies p
   where p.business_id = v_business_id order by p.version desc limit 1;

  insert into public.rider_dispatch_profiles(business_id, rider_user_id)
  values (v_business_id, auth.uid())
  on conflict (business_id, rider_user_id) do nothing;
  select p.* into v_profile from public.rider_dispatch_profiles p
   where p.business_id = v_business_id and p.rider_user_id = auth.uid()
   for update;
  if v_profile.is_blocked then
    raise exception 'Rider bloqueado para operar' using errcode = '42501';
  end if;

  select s.* into v_shift from public.rider_shifts s
   where s.business_id = v_business_id and s.rider_user_id = auth.uid()
     and s.status in ('active','paused')
   for update;
  if found then
    v_result := jsonb_build_object('ok', false, 'code', 'shift_already_open', 'idempotent_no_op', false,
      'state', jsonb_build_object('server_now', v_now, 'shift', jsonb_build_object(
        'shift_id',v_shift.id,'status',v_shift.status,'availability',v_shift.availability,
        'starts_at',v_shift.starts_at,'ends_at',v_shift.ends_at,'started_at',v_shift.started_at,
        'ended_at',v_shift.ended_at,'state_changed_at',v_shift.state_changed_at,
        'worked_seconds',v_shift.worked_seconds,'paused_seconds',v_shift.paused_seconds,
        'current_active_orders',v_shift.current_active_orders,'max_concurrent_orders',v_shift.max_concurrent_orders,
        'zone',v_shift.zone_code,'version',v_shift.version)));
    return public.dispatch_store_receipt(v_business_id, 'rider_work_now', v_key, v_fingerprint, v_result);
  end if;

  insert into public.rider_shifts(
    business_id, rider_user_id, status, availability,
    starts_at, ends_at, started_at, state_changed_at,
    max_concurrent_orders, zone_code
  ) values (
    v_business_id, auth.uid(), 'active', 'unavailable',
    v_now, v_now + make_interval(secs => v_policy.work_now_horizon_seconds),
    v_now, v_now, v_profile.max_concurrent_orders, v_profile.zone_code
  ) returning * into v_shift;

  insert into public.dispatch_events(
    business_id, shift_id, rider_user_id, event_type, actor_user_id, actor_role, detail
  ) values (
    v_business_id, v_shift.id, auth.uid(), 'rider.shift_started_now', auth.uid(), 'rider',
    jsonb_build_object('availability', 'unavailable', 'heartbeat_required', true)
  );

  v_result := jsonb_build_object(
    'ok', true, 'code', 'shift_started', 'idempotent_no_op', false,
    'state', jsonb_build_object(
      'server_now', v_now,
      'shift', jsonb_build_object(
        'shift_id', v_shift.id, 'status', v_shift.status,
        'availability', v_shift.availability, 'starts_at', v_shift.starts_at,
        'ends_at', v_shift.ends_at, 'started_at', v_shift.started_at,
        'ended_at', v_shift.ended_at, 'state_changed_at', v_shift.state_changed_at,
        'current_active_orders', v_shift.current_active_orders,
        'max_concurrent_orders', v_shift.max_concurrent_orders,
        'zone', v_shift.zone_code, 'version', v_shift.version
      )
    )
  );
  return public.dispatch_store_receipt(v_business_id, 'rider_work_now', v_key, v_fingerprint, v_result);
end;
$work$;

create or replace function public.rider_start_shift(
  p_shift_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $start$
declare
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea := digest(jsonb_build_object('shift_id', p_shift_id, 'version', p_expected_version)::text, 'sha256');
  v_replay jsonb;
  v_shift public.rider_shifts%rowtype;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_replay := public.dispatch_begin_command('rider_start_shift', v_key, v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  perform public.dispatch_lock_shift(p_shift_id);

  select s.* into v_shift from public.rider_shifts s where s.id = p_shift_id for update;
  if not found or v_shift.rider_user_id <> auth.uid() then
    raise exception 'turno inexistente' using errcode = 'P0002';
  end if;
  perform public.dispatch_lock_rider(v_shift.business_id, auth.uid());
  perform public.rider_require_active_membership(v_shift.business_id);
  if v_shift.version <> p_expected_version then
    v_result := jsonb_build_object('ok', false, 'code', 'stale_version', 'idempotent_no_op', false,
      'state', jsonb_build_object('server_now', v_now, 'shift', jsonb_build_object('shift_id', v_shift.id, 'version', v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id, 'rider_start_shift', v_key, v_fingerprint, v_result);
  end if;
  if v_shift.status <> 'scheduled' then
    v_result := jsonb_build_object('ok', false, 'code', 'shift_not_scheduled', 'idempotent_no_op', false,
      'state', jsonb_build_object('server_now', v_now, 'shift', jsonb_build_object('shift_id', v_shift.id, 'status', v_shift.status, 'version', v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id, 'rider_start_shift', v_key, v_fingerprint, v_result);
  end if;
  if v_now < v_shift.starts_at - interval '30 minutes' or v_now >= v_shift.ends_at then
    v_result := jsonb_build_object('ok', false, 'code', 'outside_shift_window', 'idempotent_no_op', false,
      'state', jsonb_build_object('server_now', v_now, 'shift', jsonb_build_object('shift_id', v_shift.id, 'starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at, 'version', v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id, 'rider_start_shift', v_key, v_fingerprint, v_result);
  end if;

  update public.rider_shifts
     set status = 'active', availability = 'unavailable',
         started_at = v_now, state_changed_at = v_now
   where id = v_shift.id
  returning * into v_shift;
  delete from private.rider_dispatch_presence where business_id = v_shift.business_id and rider_user_id = auth.uid();

  insert into public.dispatch_events(business_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
  values(v_shift.business_id,v_shift.id,auth.uid(),'rider.shift_started',auth.uid(),'rider',jsonb_build_object('heartbeat_required',true));
  v_result := jsonb_build_object('ok', true, 'code', 'shift_started', 'idempotent_no_op', false,
    'state', jsonb_build_object('server_now', v_now, 'shift', jsonb_build_object(
      'shift_id',v_shift.id,'status',v_shift.status,'availability',v_shift.availability,
      'starts_at',v_shift.starts_at,'ends_at',v_shift.ends_at,'started_at',v_shift.started_at,
      'ended_at',v_shift.ended_at,'state_changed_at',v_shift.state_changed_at,
      'current_active_orders',v_shift.current_active_orders,'max_concurrent_orders',v_shift.max_concurrent_orders,
      'zone',v_shift.zone_code,'version',v_shift.version)));
  return public.dispatch_store_receipt(v_shift.business_id, 'rider_start_shift', v_key, v_fingerprint, v_result);
end;
$start$;

create or replace function public.rider_pause_shift(
  p_shift_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $pause$
declare
  v_key text := public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea := digest(jsonb_build_object('shift_id',p_shift_id,'version',p_expected_version)::text,'sha256');
  v_replay jsonb; v_shift public.rider_shifts%rowtype; v_now timestamptz := clock_timestamp(); v_result jsonb;
begin
  v_replay := public.dispatch_begin_command('rider_pause_shift',v_key,v_fingerprint);
  if v_replay is not null then return v_replay; end if;
  select s.* into v_shift from public.rider_shifts s where s.id=p_shift_id;
  if not found or v_shift.rider_user_id<>auth.uid() then raise exception 'turno inexistente' using errcode='P0002'; end if;
  perform public.dispatch_lock_shift(v_shift.id);
  select s.* into v_shift from public.rider_shifts s where s.id=p_shift_id for update;
  if v_shift.version<>p_expected_version then
    v_result:=jsonb_build_object('ok',false,'code','stale_version','idempotent_no_op',false,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object('shift_id',v_shift.id,'version',v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id,'rider_pause_shift',v_key,v_fingerprint,v_result);
  end if;
  if v_shift.status<>'active' then
    v_result:=jsonb_build_object('ok',false,'code','shift_not_active','idempotent_no_op',false,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object('shift_id',v_shift.id,'status',v_shift.status,'version',v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id,'rider_pause_shift',v_key,v_fingerprint,v_result);
  end if;
  perform public.lock_and_revoke_shift_offers(v_shift.id,'SHIFT_PAUSED');
  update public.rider_shifts set status='paused',availability='unavailable',
    worked_seconds=worked_seconds+greatest(0,floor(extract(epoch from(v_now-state_changed_at)))::bigint),state_changed_at=v_now
    where id=v_shift.id returning * into v_shift;
  insert into public.dispatch_events(business_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
  values(v_shift.business_id,v_shift.id,auth.uid(),'rider.shift_paused',auth.uid(),'rider','{}');
  v_result:=jsonb_build_object('ok',true,'code','shift_paused','idempotent_no_op',false,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object(
    'shift_id',v_shift.id,'status',v_shift.status,'availability',v_shift.availability,'starts_at',v_shift.starts_at,'ends_at',v_shift.ends_at,
    'started_at',v_shift.started_at,'ended_at',v_shift.ended_at,'state_changed_at',v_shift.state_changed_at,'worked_seconds',v_shift.worked_seconds,
    'paused_seconds',v_shift.paused_seconds,'current_active_orders',v_shift.current_active_orders,'max_concurrent_orders',v_shift.max_concurrent_orders,'zone',v_shift.zone_code,'version',v_shift.version)));
  return public.dispatch_store_receipt(v_shift.business_id,'rider_pause_shift',v_key,v_fingerprint,v_result);
end;
$pause$;

create or replace function public.rider_resume_shift(
  p_shift_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $resume$
declare
  v_key text:=public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea:=digest(jsonb_build_object('shift_id',p_shift_id,'version',p_expected_version)::text,'sha256');
  v_replay jsonb; v_shift public.rider_shifts%rowtype; v_now timestamptz:=clock_timestamp(); v_result jsonb;
begin
  v_replay:=public.dispatch_begin_command('rider_resume_shift',v_key,v_fingerprint); if v_replay is not null then return v_replay; end if;
  perform public.dispatch_lock_shift(p_shift_id);
  select s.* into v_shift from public.rider_shifts s where s.id=p_shift_id for update;
  if not found or v_shift.rider_user_id<>auth.uid() then raise exception 'turno inexistente' using errcode='P0002'; end if;
  perform public.rider_require_active_membership(v_shift.business_id);
  if v_shift.version<>p_expected_version then
    v_result:=jsonb_build_object('ok',false,'code','stale_version','idempotent_no_op',false,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object('shift_id',v_shift.id,'version',v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id,'rider_resume_shift',v_key,v_fingerprint,v_result);
  end if;
  if v_shift.status<>'paused' or v_now>=v_shift.ends_at then
    v_result:=jsonb_build_object('ok',false,'code',case when v_now>=v_shift.ends_at then 'shift_window_ended' else 'shift_not_paused' end,'idempotent_no_op',false,
      'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object('shift_id',v_shift.id,'status',v_shift.status,'version',v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id,'rider_resume_shift',v_key,v_fingerprint,v_result);
  end if;
  update public.rider_shifts set status='active',availability='unavailable',
    paused_seconds=paused_seconds+greatest(0,floor(extract(epoch from(v_now-state_changed_at)))::bigint),state_changed_at=v_now
    where id=v_shift.id returning * into v_shift;
  delete from private.rider_dispatch_presence where shift_id=v_shift.id;
  insert into public.dispatch_events(business_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
  values(v_shift.business_id,v_shift.id,auth.uid(),'rider.shift_resumed',auth.uid(),'rider',jsonb_build_object('heartbeat_required',true));
  v_result:=jsonb_build_object('ok',true,'code','shift_resumed','idempotent_no_op',false,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object(
    'shift_id',v_shift.id,'status',v_shift.status,'availability',v_shift.availability,'starts_at',v_shift.starts_at,'ends_at',v_shift.ends_at,
    'started_at',v_shift.started_at,'ended_at',v_shift.ended_at,'state_changed_at',v_shift.state_changed_at,'worked_seconds',v_shift.worked_seconds,
    'paused_seconds',v_shift.paused_seconds,'current_active_orders',v_shift.current_active_orders,'max_concurrent_orders',v_shift.max_concurrent_orders,'zone',v_shift.zone_code,'version',v_shift.version)));
  return public.dispatch_store_receipt(v_shift.business_id,'rider_resume_shift',v_key,v_fingerprint,v_result);
end;
$resume$;

create or replace function public.rider_end_shift(
  p_shift_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $end$
declare
  v_key text:=public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea:=digest(jsonb_build_object('shift_id',p_shift_id,'version',p_expected_version)::text,'sha256');
  v_replay jsonb; v_shift public.rider_shifts%rowtype; v_now timestamptz:=clock_timestamp(); v_result jsonb;
begin
  v_replay:=public.dispatch_begin_command('rider_end_shift',v_key,v_fingerprint); if v_replay is not null then return v_replay; end if;
  select s.* into v_shift from public.rider_shifts s where s.id=p_shift_id;
  if not found or v_shift.rider_user_id<>auth.uid() then raise exception 'turno inexistente' using errcode='P0002'; end if;
  perform public.dispatch_lock_shift(v_shift.id);
  select s.* into v_shift from public.rider_shifts s where s.id=p_shift_id for update;
  if v_shift.version<>p_expected_version then
    v_result:=jsonb_build_object('ok',false,'code','stale_version','idempotent_no_op',false,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object('shift_id',v_shift.id,'version',v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id,'rider_end_shift',v_key,v_fingerprint,v_result);
  end if;
  if v_shift.status='ended' then
    v_result:=jsonb_build_object('ok',true,'code','shift_ended','idempotent_no_op',true,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object('shift_id',v_shift.id,'status',v_shift.status,'version',v_shift.version)));
    return public.dispatch_store_receipt(v_shift.business_id,'rider_end_shift',v_key,v_fingerprint,v_result);
  end if;
  perform public.lock_and_revoke_shift_offers(v_shift.id,'SHIFT_ENDED');
  update public.rider_shifts set status='ended',availability='unavailable',ended_at=v_now,
    worked_seconds=worked_seconds+case when status='active' then greatest(0,floor(extract(epoch from(v_now-state_changed_at)))::bigint) else 0 end,
    paused_seconds=paused_seconds+case when status='paused' then greatest(0,floor(extract(epoch from(v_now-state_changed_at)))::bigint) else 0 end,
    state_changed_at=v_now where id=v_shift.id returning * into v_shift;
  insert into public.dispatch_events(business_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
  values(v_shift.business_id,v_shift.id,auth.uid(),'rider.shift_ended',auth.uid(),'rider',jsonb_build_object('active_delivery_continues',v_shift.current_active_orders>0));
  v_result:=jsonb_build_object('ok',true,'code','shift_ended','idempotent_no_op',false,'state',jsonb_build_object('server_now',v_now,'shift',jsonb_build_object(
    'shift_id',v_shift.id,'status',v_shift.status,'availability',v_shift.availability,'starts_at',v_shift.starts_at,'ends_at',v_shift.ends_at,
    'started_at',v_shift.started_at,'ended_at',v_shift.ended_at,'state_changed_at',v_shift.state_changed_at,'worked_seconds',v_shift.worked_seconds,
    'paused_seconds',v_shift.paused_seconds,'current_active_orders',v_shift.current_active_orders,'max_concurrent_orders',v_shift.max_concurrent_orders,'zone',v_shift.zone_code,'version',v_shift.version)));
  return public.dispatch_store_receipt(v_shift.business_id,'rider_end_shift',v_key,v_fingerprint,v_result);
end;
$end$;

create or replace function public.rider_operational_state_payload(
  p_business_id uuid,
  p_rider_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $state$
declare
  v_now timestamptz := clock_timestamp();
  v_shift public.rider_shifts%rowtype;
  v_presence private.rider_dispatch_presence%rowtype;
  v_offer public.dispatch_offers%rowtype;
  v_delivery_order_id uuid;
  v_shift_json jsonb;
  v_offer_json jsonb;
  v_delivery jsonb;
begin
  select s.* into v_shift
    from public.rider_shifts s
   where s.business_id = p_business_id
     and s.rider_user_id = p_rider_user_id
   order by
     case s.status when 'active' then 0 when 'paused' then 1 when 'scheduled' then 2 else 3 end,
     case when s.status = 'scheduled' then s.starts_at end,
     s.state_changed_at desc
   limit 1;

  if v_shift.id is not null then
    select p.* into v_presence
      from private.rider_dispatch_presence p
     where p.shift_id = v_shift.id;
    v_shift_json := jsonb_build_object(
      'shift_id', v_shift.id,
      'status', v_shift.status,
      'availability', v_shift.availability,
      'starts_at', v_shift.starts_at,
      'ends_at', v_shift.ends_at,
      'started_at', v_shift.started_at,
      'ended_at', v_shift.ended_at,
      'state_changed_at', v_shift.state_changed_at,
      'worked_seconds', v_shift.worked_seconds,
      'paused_seconds', v_shift.paused_seconds,
      'current_active_orders', v_shift.current_active_orders,
      'max_concurrent_orders', v_shift.max_concurrent_orders,
      'zone', v_shift.zone_code,
      'version', v_shift.version,
      'heartbeat_state', case
        when v_presence.shift_id is null then 'missing'
        when v_presence.heartbeat_at < v_now - interval '90 seconds' then 'stale'
        else 'fresh' end
    );
  end if;

  select o.* into v_offer
    from public.dispatch_offers o
   where o.business_id = p_business_id
     and o.rider_user_id = p_rider_user_id
     and o.status = 'offered'
     and o.lease_expires_at > v_now
   order by o.offered_at, o.id
   limit 1;

  if v_offer.id is not null then
    v_offer_json := jsonb_build_object(
      'offer_id', v_offer.id,
      'job_id', v_offer.job_id,
      'version', v_offer.version,
      'lease_expires_at', v_offer.lease_expires_at,
      'server_now', v_now,
      'estimated_reward', v_offer.estimated_reward,
      'reward_currency', v_offer.reward_currency,
      'payload', v_offer.safe_payload
    );
  end if;

  select o.id into v_delivery_order_id
    from public.orders o
   where o.business_id = p_business_id
     and o.assigned_rider_user_id = p_rider_user_id
     and o.status in ('assigned','picked_up','on_the_way','arrived')
   order by o.updated_at desc, o.id
   limit 1;
  if v_delivery_order_id is not null and p_rider_user_id = auth.uid() then
    v_delivery := public.rider_active_delivery_payload(v_delivery_order_id);
  end if;

  return jsonb_build_object(
    'server_now', v_now,
    'shift', v_shift_json,
    'offer', v_offer_json,
    'activity', jsonb_build_object(
      'active_delivery', v_delivery,
      'estimated_today', coalesce((
        select sum(l.amount) from public.rider_reward_ledger l
         where l.business_id = p_business_id and l.rider_user_id = p_rider_user_id
           and l.entry_type = 'estimated' and l.created_at >= date_trunc('day', v_now)
      ), 0),
      'earned_today', coalesce((
        select sum(l.amount) from public.rider_reward_ledger l
         where l.business_id = p_business_id and l.rider_user_id = p_rider_user_id
           and l.entry_type = 'earned' and l.created_at >= date_trunc('day', v_now)
      ), 0),
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'event_type', x.event_type, 'created_at', x.created_at,
          'code', x.detail->>'code'
        ) order by x.id desc)
        from (
          select e.id,e.event_type,e.created_at,e.detail
          from public.dispatch_events e
          where e.business_id=p_business_id and e.rider_user_id=p_rider_user_id
          order by e.id desc limit 10
        ) x
      ), '[]'::jsonb)
    )
  );
end;
$state$;

create or replace function public.get_rider_operational_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get$
declare
  v_business_id uuid := public.dispatch_current_rider_business();
begin
  return public.rider_operational_state_payload(v_business_id, auth.uid());
end;
$get$;

create or replace function public.rider_shift_heartbeat(
  p_shift_id uuid,
  p_expected_version bigint,
  p_captured_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_is_mock boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $heartbeat$
declare
  v_shift public.rider_shifts%rowtype;
  v_policy public.rider_dispatch_policies%rowtype;
  v_profile public.rider_dispatch_profiles%rowtype;
  v_old_presence private.rider_dispatch_presence%rowtype;
  v_now timestamptz := clock_timestamp();
  v_key text;
  v_fingerprint bytea;
  v_replay jsonb;
  v_result jsonb;
  v_code text;
  v_became_fresh boolean := false;
begin
  if p_shift_id is null or p_expected_version is null or p_captured_at is null then
    raise exception 'heartbeat incompleto' using errcode='22023';
  end if;
  v_key := 'heartbeat-' || encode(digest(p_shift_id::text || ':' || p_captured_at::text, 'sha256'), 'hex');
  v_fingerprint := digest(jsonb_build_object(
    'shift_id',p_shift_id,'version',p_expected_version,'captured_at',p_captured_at,
    'lat',p_lat,'lng',p_lng,'accuracy',p_accuracy,'is_mock',coalesce(p_is_mock,false)
  )::text,'sha256');
  v_replay := public.dispatch_begin_command('rider_shift_heartbeat',v_key,v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  select s.* into v_shift from public.rider_shifts s where s.id=p_shift_id;
  if not found or v_shift.rider_user_id<>auth.uid() then raise exception 'turno inexistente' using errcode='P0002'; end if;
  perform public.dispatch_lock_shift(v_shift.id);
  select s.* into v_shift from public.rider_shifts s where s.id=p_shift_id for update;
  perform public.rider_require_active_membership(v_shift.business_id);
  select p.* into v_policy from public.rider_dispatch_policies p where p.business_id=v_shift.business_id order by p.version desc limit 1;
  select p.* into v_profile from public.rider_dispatch_profiles p where p.business_id=v_shift.business_id and p.rider_user_id=auth.uid();

  if v_shift.version<>p_expected_version then v_code:='stale_version';
  elsif v_shift.status<>'active' or v_now>=v_shift.ends_at then v_code:='shift_not_active';
  elsif coalesce(v_profile.is_blocked,false) then v_code:='rider_blocked';
  elsif coalesce(p_is_mock,false) then v_code:='mock_location_rejected';
  elsif p_lat not between -90 and 90 or p_lng not between -180 and 180 then v_code:='coordinates_invalid';
  elsif p_accuracy is null or p_accuracy<0 or p_accuracy>v_policy.max_gps_accuracy_m then v_code:='gps_inaccurate';
  elsif p_captured_at<v_now-interval '10 minutes' then v_code:='gps_stale';
  elsif p_captured_at>v_now+interval '2 minutes' then v_code:='gps_future';
  end if;

  if v_code is not null then
    v_result:=jsonb_build_object('ok',false,'code',v_code,'idempotent_no_op',false,
      'state',public.rider_operational_state_payload(v_shift.business_id,auth.uid()));
    return public.dispatch_store_receipt(v_shift.business_id,'rider_shift_heartbeat',v_key,v_fingerprint,v_result);
  end if;

  select p.* into v_old_presence from private.rider_dispatch_presence p
   where p.business_id=v_shift.business_id and p.rider_user_id=auth.uid() for update;
  v_became_fresh := v_old_presence.shift_id is null
    or v_old_presence.shift_id<>v_shift.id
    or v_old_presence.heartbeat_at<v_now-make_interval(secs=>v_policy.heartbeat_ttl_seconds)
    or v_old_presence.captured_at<v_now-make_interval(secs=>v_policy.gps_ttl_seconds)
    or v_old_presence.accuracy_m>v_policy.max_gps_accuracy_m;

  insert into private.rider_dispatch_presence(
    shift_id,business_id,rider_user_id,heartbeat_at,captured_at,latitude,longitude,
    accuracy_m,is_mock,client_request_key,request_fingerprint,updated_at
  ) values (
    v_shift.id,v_shift.business_id,auth.uid(),v_now,p_captured_at,p_lat,p_lng,
    p_accuracy,false,v_key,v_fingerprint,v_now
  )
  on conflict (business_id,rider_user_id) do update set
    shift_id=excluded.shift_id,heartbeat_at=excluded.heartbeat_at,captured_at=excluded.captured_at,
    latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,
    is_mock=false,client_request_key=excluded.client_request_key,
    request_fingerprint=excluded.request_fingerprint,updated_at=excluded.updated_at;

  perform public.reconcile_rider_shift(v_shift.id);
  if v_became_fresh then
    update public.dispatch_jobs j
       set state='queued',round_no=j.round_no+1,next_attempt_at=v_now,
           last_failure_code=null,failure_evidence='{}'::jsonb
     where j.business_id=v_shift.business_id and j.state='no_rider_available'
       and exists(select 1 from public.orders o where o.id=j.order_id and o.status='ready' and o.assigned_rider_user_id is null);
  end if;

  insert into public.dispatch_events(business_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
  values(v_shift.business_id,v_shift.id,auth.uid(),'rider.heartbeat_accepted',auth.uid(),'rider',
    jsonb_build_object('receipt_key',v_key,'became_fresh',v_became_fresh,'accuracy_bucket',case when p_accuracy<=25 then 'high' when p_accuracy<=75 then 'medium' else 'accepted' end));
  v_result:=jsonb_build_object('ok',true,'code','heartbeat_accepted','idempotent_no_op',false,
    'state',public.rider_operational_state_payload(v_shift.business_id,auth.uid()));
  return public.dispatch_store_receipt(v_shift.business_id,'rider_shift_heartbeat',v_key,v_fingerprint,v_result);
end;
$heartbeat$;

create or replace function public.schedule_rider_shift(
  p_business_id uuid,
  p_rider_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_zone text,
  p_max_concurrent_orders integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $schedule$
declare
  v_key text:=public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea:=digest(jsonb_build_object('business_id',p_business_id,'rider_user_id',p_rider_user_id,'starts_at',p_starts_at,'ends_at',p_ends_at,'zone',public.dispatch_normalize_zone(p_zone),'capacity',p_max_concurrent_orders)::text,'sha256');
  v_replay jsonb; v_shift public.rider_shifts%rowtype; v_result jsonb;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  v_replay:=public.dispatch_begin_command('schedule_rider_shift',v_key,v_fingerprint); if v_replay is not null then return v_replay; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or p_max_concurrent_orders<>1 then raise exception 'ventana/capacidad de turno invalida' using errcode='22023'; end if;
  perform 1 from public.business_members bm where bm.business_id=p_business_id and bm.user_id=p_rider_user_id and bm.role='rider' and bm.is_active=true;
  if not found then raise exception 'Rider activo del negocio requerido' using errcode='42501'; end if;
  perform public.dispatch_lock_rider(p_business_id,p_rider_user_id);
  if exists(select 1 from public.rider_shifts s where s.business_id=p_business_id and s.rider_user_id=p_rider_user_id and s.status<>'ended'
    and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')) then
    raise exception 'turno superpuesto' using errcode='23P01';
  end if;
  insert into public.rider_shifts(business_id,rider_user_id,status,availability,starts_at,ends_at,max_concurrent_orders,zone_code,scheduled_by)
  values(p_business_id,p_rider_user_id,'scheduled','unavailable',p_starts_at,p_ends_at,1,public.dispatch_normalize_zone(p_zone),auth.uid()) returning * into v_shift;
  insert into public.dispatch_events(business_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
  values(p_business_id,v_shift.id,p_rider_user_id,'business.shift_scheduled',auth.uid(),'business',jsonb_build_object('starts_at',p_starts_at,'ends_at',p_ends_at,'zone',v_shift.zone_code));
  v_result:=jsonb_build_object('ok',true,'code','shift_scheduled','idempotent_no_op',false,'shift',jsonb_build_object('shift_id',v_shift.id,'status',v_shift.status,'availability',v_shift.availability,'starts_at',v_shift.starts_at,'ends_at',v_shift.ends_at,'zone',v_shift.zone_code,'version',v_shift.version));
  return public.dispatch_store_receipt(p_business_id,'schedule_rider_shift',v_key,v_fingerprint,v_result);
end;
$schedule$;

create or replace function public.configure_rider_dispatch_profile(
  p_business_id uuid,
  p_rider_user_id uuid,
  p_is_blocked boolean,
  p_block_reason text,
  p_zone text,
  p_max_concurrent_orders integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $profile$
declare
  v_key text:=public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea:=digest(jsonb_build_object('business_id',p_business_id,'rider_user_id',p_rider_user_id,'blocked',coalesce(p_is_blocked,false),'reason',btrim(coalesce(p_block_reason,'')),'zone',public.dispatch_normalize_zone(p_zone),'capacity',p_max_concurrent_orders)::text,'sha256');
  v_replay jsonb; v_profile public.rider_dispatch_profiles%rowtype; v_shift_id uuid; v_result jsonb;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  v_replay:=public.dispatch_begin_command('configure_rider_dispatch_profile',v_key,v_fingerprint); if v_replay is not null then return v_replay; end if;
  if p_max_concurrent_orders<>1 then raise exception 'capacidad piloto debe ser 1' using errcode='22023'; end if;
  if coalesce(p_is_blocked,false) and char_length(btrim(coalesce(p_block_reason,''))) not between 5 and 300 then raise exception 'motivo de bloqueo requerido' using errcode='22023'; end if;
  perform 1 from public.business_members bm where bm.business_id=p_business_id and bm.user_id=p_rider_user_id and bm.role='rider';
  if not found then raise exception 'membership Rider requerida' using errcode='42501'; end if;
  perform public.dispatch_lock_rider(p_business_id,p_rider_user_id);
  select s.id into v_shift_id from public.rider_shifts s where s.business_id=p_business_id and s.rider_user_id=p_rider_user_id and s.status in('active','paused') limit 1;
  if v_shift_id is not null then perform public.dispatch_lock_shift(v_shift_id); perform public.lock_and_revoke_shift_offers(v_shift_id,'PROFILE_CHANGED'); end if;
  insert into public.rider_dispatch_profiles(business_id,rider_user_id,is_blocked,block_reason,zone_code,max_concurrent_orders,configured_by)
  values(p_business_id,p_rider_user_id,coalesce(p_is_blocked,false),case when p_is_blocked then btrim(p_block_reason) else null end,public.dispatch_normalize_zone(p_zone),1,auth.uid())
  on conflict(business_id,rider_user_id) do update set is_blocked=excluded.is_blocked,block_reason=excluded.block_reason,zone_code=excluded.zone_code,max_concurrent_orders=1,configured_by=auth.uid(),updated_at=clock_timestamp()
  returning * into v_profile;
  if v_shift_id is not null then update public.rider_shifts set zone_code=v_profile.zone_code,max_concurrent_orders=1,availability='unavailable' where id=v_shift_id; end if;
  insert into public.dispatch_events(business_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
  values(p_business_id,v_shift_id,p_rider_user_id,'business.rider_profile_configured',auth.uid(),'business',jsonb_build_object('is_blocked',v_profile.is_blocked,'zone',v_profile.zone_code,'capacity',1));
  v_result:=jsonb_build_object('ok',true,'code','profile_configured','idempotent_no_op',false,'profile',jsonb_build_object('rider_user_id',p_rider_user_id,'is_blocked',v_profile.is_blocked,'block_reason',v_profile.block_reason,'zone',v_profile.zone_code,'max_concurrent_orders',1));
  return public.dispatch_store_receipt(p_business_id,'configure_rider_dispatch_profile',v_key,v_fingerprint,v_result);
end;
$profile$;

create or replace function public.configure_business_auto_dispatch(
  p_business_id uuid,
  p_enabled boolean,
  p_qa_fixture_only boolean,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $switch$
declare
  v_key text:=public.dispatch_validate_idempotency_key(p_idempotency_key);
  v_fingerprint bytea:=digest(jsonb_build_object('business_id',p_business_id,'enabled',coalesce(p_enabled,false),'qa_fixture_only',coalesce(p_qa_fixture_only,true),'reason',btrim(coalesce(p_reason,'')))::text,'sha256');
  v_replay jsonb; v_settings public.business_dispatch_settings%rowtype; v_result jsonb; v_offer record;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 8 and 500 then raise exception 'motivo operativo requerido' using errcode='22023'; end if;
  v_replay:=public.dispatch_begin_command('configure_business_auto_dispatch',v_key,v_fingerprint); if v_replay is not null then return v_replay; end if;
  perform public.ensure_rider_dispatch_policy(p_business_id);
  update public.business_dispatch_settings set auto_dispatch_enabled=coalesce(p_enabled,false),qa_fixture_only=coalesce(p_qa_fixture_only,true),change_reason=btrim(p_reason),changed_by=auth.uid()
    where business_id=p_business_id returning * into v_settings;
  if not v_settings.auto_dispatch_enabled then
    for v_offer in select o.id,o.job_id,o.order_id,o.shift_id,o.rider_user_id from public.dispatch_offers o where o.business_id=p_business_id and o.status='offered' order by o.id loop
      perform private.dispatch_lock_job(v_offer.job_id);
      update public.dispatch_offers set status='revoked',responded_at=clock_timestamp(),response_reason='AUTO_DISPATCH_DISABLED' where id=v_offer.id;
      update public.dispatch_jobs set state='queued',last_failure_code='AUTO_DISPATCH_DISABLED',failure_evidence=jsonb_build_object('preserved',true),next_attempt_at=clock_timestamp() where id=v_offer.job_id;
      insert into public.dispatch_events(business_id,job_id,order_id,offer_id,shift_id,rider_user_id,event_type,actor_user_id,actor_role,detail)
      values(p_business_id,v_offer.job_id,v_offer.order_id,v_offer.id,v_offer.shift_id,v_offer.rider_user_id,'dispatch.offer_revoked',auth.uid(),'business',jsonb_build_object('reason','AUTO_DISPATCH_DISABLED'));
    end loop;
  else
    perform public.enqueue_rider_dispatch_job(o.id) from public.orders o where o.business_id=p_business_id and o.status='ready' and o.assigned_rider_user_id is null and (not v_settings.qa_fixture_only or o.origin='qa');
  end if;
  insert into public.dispatch_events(business_id,event_type,actor_user_id,actor_role,detail)
  values(p_business_id,'business.auto_dispatch_configured',auth.uid(),'business',jsonb_build_object('enabled',v_settings.auto_dispatch_enabled,'qa_fixture_only',v_settings.qa_fixture_only,'reason',btrim(p_reason)));
  v_result:=jsonb_build_object('ok',true,'code',case when v_settings.auto_dispatch_enabled then 'auto_dispatch_enabled' else 'auto_dispatch_disabled' end,'idempotent_no_op',false,'settings',jsonb_build_object('auto_dispatch_enabled',v_settings.auto_dispatch_enabled,'qa_fixture_only',v_settings.qa_fixture_only,'version',v_settings.version));
  return public.dispatch_store_receipt(p_business_id,'configure_business_auto_dispatch',v_key,v_fingerprint,v_result);
end;
$switch$;
