-- Reconciliation that does not depend on webhooks, a durable discrepancy inbox, a disconnect that cannot strand
-- open payments, and a payments console that cannot hide old incidents (forensic findings F06-F10, F14).
--
-- REVERSAL: nothing here deletes financial rows. To back out, restore mp_disconnect_preflight / mp_disconnect_checked /
-- enqueue_checkout_provider_probes / list_business_payments / reconcile_operational_alerts_for_business from their
-- previous migrations and drop provider_ledger_cursors. Added columns and tables are inert when unused.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Discrepancy inbox: read, acknowledge, resolve (audited), write (worker)
-- ---------------------------------------------------------------------------------------------------------------
create function public.list_payment_discrepancies(
  p_business_id uuid, p_status text default 'open', p_limit integer default 100, p_offset integer default 0
) returns setof jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'discrepancias no autorizadas' using errcode = '42501';
  end if;
  return query
  select jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'severity', d.severity, 'status', d.status, 'blocks_recovery', d.blocks_recovery,
    'payment_intent_id', d.payment_intent_id, 'checkout_session_id', d.checkout_session_id, 'refund_id', d.refund_id,
    'provider_payment_id_short', case when d.provider_payment_id is null then null else right(d.provider_payment_id, 6) end,
    'occurrences', d.occurrences, 'first_detected_at', d.first_detected_at, 'last_detected_at', d.last_detected_at,
    'resolution', d.resolution, 'resolved_at', d.resolved_at,
    'details', d.details - 'raw')
  from public.payment_discrepancies d
  where d.business_id = p_business_id
    and (p_status = 'all' or (p_status = 'open' and d.status <> 'resolved') or d.status = p_status)
  order by case d.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
           d.last_detected_at desc, d.id
  limit greatest(1, least(coalesce(p_limit, 100), 500)) offset greatest(0, coalesce(p_offset, 0));
end $$;
revoke all on function public.list_payment_discrepancies(uuid, text, integer, integer) from public, anon;
grant execute on function public.list_payment_discrepancies(uuid, text, integer, integer) to authenticated;

create function public.resolve_payment_discrepancy(p_id uuid, p_resolution text, p_note text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_d public.payment_discrepancies%rowtype; v_actor uuid := auth.uid(); v_intent public.payment_intents%rowtype;
begin
  select * into v_d from public.payment_discrepancies where id = p_id for update;
  if not found then raise exception 'discrepancia inexistente' using errcode = 'P0002'; end if;
  if v_actor is null or v_d.business_id is null or not public.has_business_role(v_d.business_id, array['owner', 'admin']) then
    raise exception 'resolucion no autorizada' using errcode = '42501';
  end if;
  if p_resolution not in ('acknowledged', 'order_created', 'refunded_in_provider', 'verified_no_loss', 'duplicate_refunded', 'not_executed_in_provider') then
    raise exception 'resolucion invalida' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'la nota de evidencia es obligatoria (10+ caracteres)' using errcode = '22023';
  end if;
  if p_resolution = 'acknowledged' then
    update public.payment_discrepancies set status = 'acknowledged', resolution_note = left(btrim(p_note), 500) where id = p_id and status = 'open';
  else
    -- A paid purchase may only be closed as "order created" when the order really exists.
    if v_d.kind = 'paid_without_order' and p_resolution = 'order_created' then
      select * into v_intent from public.payment_intents where id = v_d.payment_intent_id;
      if v_intent.order_id is null then
        raise exception 'el pedido todavia no existe' using errcode = '55000';
      end if;
    end if;
    update public.payment_discrepancies
       set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = v_actor, resolution = p_resolution,
           resolution_note = left(btrim(p_note), 500)
     where id = p_id;
  end if;
  if v_d.payment_intent_id is not null then
    insert into public.payment_events (payment_intent_id, event_type, details)
    values (v_d.payment_intent_id, 'payment.discrepancy_' || case when p_resolution = 'acknowledged' then 'acknowledged' else 'resolved' end,
      jsonb_build_object('discrepancy_id', p_id, 'kind', v_d.kind, 'resolution', p_resolution, 'actor_user_id', v_actor));
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'resolution', p_resolution);
end $$;
revoke all on function public.resolve_payment_discrepancy(uuid, text, text) from public, anon;
grant execute on function public.resolve_payment_discrepancy(uuid, text, text) to authenticated;

create function public.record_payment_discrepancy(
  p_business_id uuid, p_payment_intent_id uuid, p_kind text, p_severity text, p_blocks_recovery boolean,
  p_provider_payment_id text, p_details jsonb, p_dedupe_key text, p_environment text default null, p_seller_id text default null
) returns uuid
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  select private.open_payment_discrepancy(p_business_id, p_payment_intent_id, null, p_kind, p_severity,
    coalesce(p_blocks_recovery, false), p_provider_payment_id, coalesce(p_details, '{}'::jsonb), p_dedupe_key,
    null, p_seller_id, p_environment) $$;
revoke all on function public.record_payment_discrepancy(uuid, uuid, text, text, boolean, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_discrepancy(uuid, uuid, text, text, boolean, text, jsonb, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. F09: a refund whose provider identity was lost
-- ---------------------------------------------------------------------------------------------------------------
-- The worker parks it here instead of retrying eight times and dead-lettering. The refund stays `ambiguous`, which
-- freezes recovery and full-refund orders (payment_financial_hold), and an owner/admin resolves it WITH evidence.
create function public.park_refund_identity_unknown(p_refund_id uuid, p_evidence jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_r public.payment_refunds%rowtype; v_i public.payment_intents%rowtype;
begin
  select * into v_r from public.payment_refunds where id = p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_i from public.payment_intents where id = v_r.payment_intent_id for update;
  select * into v_r from public.payment_refunds where id = p_refund_id for update;
  if v_r.status in ('approved', 'rejected', 'failed') then return null; end if;
  return private.open_payment_discrepancy(v_i.business_id, v_i.id, v_i.checkout_session_id, 'refund_identity_unknown',
    'critical', true, v_i.provider_payment_id,
    jsonb_build_object('refund_id', p_refund_id, 'amount', v_r.amount, 'requested_at', v_r.requested_at,
      'provider_refunds_seen', coalesce(p_evidence -> 'provider_refunds', '[]'::jsonb)),
    'refund_identity_unknown:' || p_refund_id::text, p_refund_id, null, v_i.environment);
end $$;
revoke all on function public.park_refund_identity_unknown(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.park_refund_identity_unknown(uuid, jsonb) to service_role;

create function public.resolve_ambiguous_refund(
  p_refund_id uuid, p_outcome text, p_provider_refund_id text, p_note text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_r public.payment_refunds%rowtype;
  v_i public.payment_intents%rowtype;
  v_id text := nullif(btrim(coalesce(p_provider_refund_id, '')), '');
  v_total numeric(12, 2);
begin
  select * into v_r from public.payment_refunds where id = p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_i from public.payment_intents where id = v_r.payment_intent_id for update;
  select * into v_r from public.payment_refunds where id = p_refund_id for update;
  if v_actor is null or not public.has_business_role(v_i.business_id, array['owner', 'admin']) then
    raise exception 'resolucion no autorizada' using errcode = '42501';
  end if;
  if v_r.status <> 'ambiguous' then raise exception 'el reembolso no esta pendiente de aclaracion' using errcode = '55000'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'la nota de evidencia es obligatoria (10+ caracteres)' using errcode = '22023';
  end if;
  if p_outcome = 'executed' then
    if v_id is null or v_id !~ '^[1-9][0-9]{0,31}$' then
      raise exception 'identidad de reembolso invalida' using errcode = '22023';
    end if;
    if exists (select 1 from public.payment_refunds x where x.provider_refund_id = v_id and x.id <> p_refund_id and x.origin <> 'external') then
      raise exception 'esa identidad ya pertenece a otro reembolso' using errcode = '23505';
    end if;
    delete from public.payment_refunds where provider_refund_id = v_id and origin = 'external' and payment_intent_id = v_i.id;
    update public.payment_refunds
       set provider_refund_id = v_id, status = 'approved', completed_at = clock_timestamp(),
           reason = left(coalesce(reason, '') || ' | resolved: ' || btrim(p_note), 300)
     where id = p_refund_id;
    v_total := private.refresh_refund_totals(v_i.id, null, null, v_r.requested_at);
    if v_i.internal_status <> 'security_review_required' then
      update public.payment_intents
         set internal_status = case when v_total >= coalesce(paid_amount, expected_amount) then 'refunded' else 'partially_refunded' end
       where id = v_i.id;
    end if;
  elsif p_outcome = 'not_executed' then
    update public.payment_refunds
       set status = 'failed', completed_at = clock_timestamp(),
           reason = left(coalesce(reason, '') || ' | not executed: ' || btrim(p_note), 300)
     where id = p_refund_id;
  else
    raise exception 'resultado invalido' using errcode = '22023';
  end if;
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp()
   where refund_id = p_refund_id and topic = 'refund_reconcile' and status in ('pending', 'claimed', 'processing', 'retry_wait', 'failed', 'dead_letter');
  update public.payment_discrepancies
     set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = v_actor,
         resolution = case p_outcome when 'executed' then 'refunded_in_provider' else 'not_executed_in_provider' end,
         resolution_note = left(btrim(p_note), 500)
   where refund_id = p_refund_id and kind = 'refund_identity_unknown' and status <> 'resolved';
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_i.id, 'payment.refund_ambiguity_resolved',
    jsonb_build_object('refund_id', p_refund_id, 'outcome', p_outcome, 'actor_user_id', v_actor));
  return jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'outcome', p_outcome);
end $$;
revoke all on function public.resolve_ambiguous_refund(uuid, text, text, text) from public, anon;
grant execute on function public.resolve_ambiguous_refund(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. F08: provider truth probes that do not give up on a counter or a clock
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.record_provider_probe_empty(p_payment_intent_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_expires timestamptz;
begin
  select cs.expires_at into v_expires from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id where pi.id = p_payment_intent_id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (p_payment_intent_id, 'payment.provider_probe_empty',
    jsonb_build_object('source', 'provider_truth_sweep', 'after_expiry_grace', coalesce(clock_timestamp() > v_expires + interval '24 hours', false)));
end $$;

create or replace function public.enqueue_checkout_provider_probes(p_limit integer default 50) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_inserted integer;
begin
  -- A checkout is only "closed with evidence" after the preference expired, a 24 h grace for late/offline payments
  -- passed, and three further probes (taken after that grace) found nothing. Counters and ages alone never close it.
  with probes as (
    select pi.id as intent_id,
           count(*) filter (where pe.event_type = 'payment.provider_probe_empty') as empties,
           count(*) filter (where pe.event_type = 'payment.provider_probe_empty'
                              and pe.server_recorded_at > cs.expires_at + interval '24 hours') as empties_after_grace,
           max(pe.server_recorded_at) filter (where pe.event_type = 'payment.provider_probe_empty') as last_probe
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      left join public.payment_events pe on pe.payment_intent_id = pi.id and pe.event_type = 'payment.provider_probe_empty'
     where cs.completed_order_id is null and pi.order_id is null
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and nullif(btrim(coalesce(pi.external_reference, '')), '') is not null
       and pi.internal_status not in ('completed', 'refunded', 'partially_refunded', 'charged_back', 'security_review_required')
       and cs.created_at < clock_timestamp() - interval '90 seconds'
     group by pi.id, cs.expires_at, cs.created_at
  ), due as (
    select p.intent_id from probes p
     where p.empties_after_grace < 3
       and (p.last_probe is null or p.last_probe < clock_timestamp() - case
              when p.empties < 5 then interval '2 minutes'
              when p.empties < 20 then interval '10 minutes'
              else interval '1 hour' end)
       and not exists (select 1 from public.payment_outbox po
                        where po.payment_intent_id = p.intent_id and po.topic = 'payment_reconcile'
                          and po.status in ('pending', 'claimed', 'processing', 'retry_wait'))
     order by coalesce(p.last_probe, '-infinity'::timestamptz)
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  select d.intent_id, 'payment_reconcile', null from due d
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. F08: provider ledger sweep (independent of intents and webhooks)
-- ---------------------------------------------------------------------------------------------------------------
create table public.provider_ledger_cursors (
  business_id uuid not null references public.businesses(id) on delete restrict,
  environment text not null check (environment in ('test', 'production')),
  watermark_at timestamptz not null,
  window_begin timestamptz,
  window_end timestamptz,
  next_offset integer not null default 0 check (next_offset >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  pages_total bigint not null default 0,
  payments_seen bigint not null default 0,
  orphans_found bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, environment)
);
alter table public.provider_ledger_cursors enable row level security;
revoke all on public.provider_ledger_cursors from public, anon, authenticated;
grant all on public.provider_ledger_cursors to service_role;
create trigger a1_a4_financial_interlock_v5 before insert or update or delete or truncate on public.provider_ledger_cursors
  for each statement execute function private.a1_a4_financial_write_guard_v5();
alter table public.provider_ledger_cursors enable always trigger a1_a4_financial_interlock_v5;

-- One due (business, environment) with a lease. The window is [watermark - overlap, now]; a window is finished only
-- when every page was read, so a crash resumes at next_offset and never skips payments.
create function public.claim_provider_ledger_window(
  p_owner text, p_lease_seconds integer default 150, p_backfill_days integer default 7,
  p_overlap_minutes integer default 120, p_period_minutes integer default 10
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_row public.provider_ledger_cursors%rowtype;
begin
  if char_length(btrim(coalesce(p_owner, ''))) < 3 then raise exception 'owner invalido' using errcode = '22023'; end if;
  insert into public.provider_ledger_cursors (business_id, environment, watermark_at)
  select c.business_id, c.environment, clock_timestamp() - make_interval(days => greatest(1, least(coalesce(p_backfill_days, 7), 60)))
    from public.mp_seller_connections c
   where c.status = 'connected' and c.protected_tokens is not null
  on conflict (business_id, environment) do nothing;

  select cu.* into v_row
    from public.provider_ledger_cursors cu
    join public.mp_seller_connections c on c.business_id = cu.business_id and c.environment = cu.environment
   where c.status = 'connected' and c.protected_tokens is not null
     and (cu.lease_expires_at is null or cu.lease_expires_at < clock_timestamp())
     and (cu.window_end is not null                                   -- resume an unfinished window
          or cu.last_completed_at is null
          or cu.last_completed_at < clock_timestamp() - make_interval(mins => greatest(1, coalesce(p_period_minutes, 10))))
     and (cu.consecutive_failures = 0
          or cu.updated_at < clock_timestamp() - make_interval(mins => least(60, 2 ^ least(cu.consecutive_failures, 6))::integer))
   order by coalesce(cu.last_completed_at, '-infinity'::timestamptz)
   limit 1
   for update of cu skip locked;
  if not found then return null; end if;

  if v_row.window_end is null then
    update public.provider_ledger_cursors
       set window_begin = watermark_at - make_interval(mins => greatest(0, coalesce(p_overlap_minutes, 120))),
           window_end = clock_timestamp(), next_offset = 0, last_started_at = clock_timestamp()
     where business_id = v_row.business_id and environment = v_row.environment
     returning * into v_row;
  end if;
  update public.provider_ledger_cursors
     set lease_owner = p_owner, lease_expires_at = clock_timestamp() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 150))),
         updated_at = clock_timestamp()
   where business_id = v_row.business_id and environment = v_row.environment;
  return jsonb_build_object('business_id', v_row.business_id, 'environment', v_row.environment,
    'begin', v_row.window_begin, 'end', v_row.window_end, 'offset', v_row.next_offset);
end $$;

create function public.record_provider_ledger_page(
  p_owner text, p_business_id uuid, p_environment text, p_next_offset integer, p_done boolean,
  p_payments_seen integer default 0, p_orphans_found integer default 0, p_error text default null
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_row public.provider_ledger_cursors%rowtype;
begin
  select * into v_row from public.provider_ledger_cursors
   where business_id = p_business_id and environment = p_environment for update;
  if not found or v_row.lease_owner is distinct from p_owner then return false; end if;
  if p_error is not null then
    update public.provider_ledger_cursors
       set consecutive_failures = consecutive_failures + 1, last_error = left(p_error, 200),
           lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
     where business_id = p_business_id and environment = p_environment;
    return true;
  end if;
  if coalesce(p_done, false) then
    update public.provider_ledger_cursors
       set watermark_at = window_end, window_begin = null, window_end = null, next_offset = 0,
           last_completed_at = clock_timestamp(), last_error = null, consecutive_failures = 0,
           pages_total = pages_total + 1, payments_seen = payments_seen + greatest(0, p_payments_seen),
           orphans_found = orphans_found + greatest(0, p_orphans_found),
           lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
     where business_id = p_business_id and environment = p_environment;
  else
    update public.provider_ledger_cursors
       set next_offset = greatest(0, p_next_offset), pages_total = pages_total + 1,
           payments_seen = payments_seen + greatest(0, p_payments_seen),
           orphans_found = orphans_found + greatest(0, p_orphans_found),
           last_error = null, consecutive_failures = 0, updated_at = clock_timestamp()
     where business_id = p_business_id and environment = p_environment;
  end if;
  return true;
end $$;

-- A provider payment that carries OUR reference format but has no intent here: money that never became a purchase.
create function public.record_orphan_provider_payment(
  p_business_id uuid, p_environment text, p_payment jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_pid text := nullif(btrim(coalesce(p_payment ->> 'id', '')), ''); v_status text := lower(coalesce(p_payment ->> 'status', 'unknown'));
begin
  if v_pid is null or p_payment ->> 'external_reference' !~ '^taba2:checkout:[0-9a-f-]{36}$' then
    raise exception 'pago huerfano invalido' using errcode = '22023';
  end if;
  return private.open_payment_discrepancy(p_business_id, null, null, 'orphan_provider_payment',
    case when v_status in ('approved', 'refunded', 'charged_back') then 'critical' else 'low' end,
    v_status in ('approved', 'refunded', 'charged_back'), v_pid,
    jsonb_build_object('status', v_status, 'amount', p_payment ->> 'transaction_amount', 'currency', p_payment ->> 'currency_id',
      'external_reference', p_payment ->> 'external_reference', 'created', p_payment ->> 'date_created'),
    'orphan:' || p_environment || ':' || v_pid, null, p_payment ->> 'collector_id', p_environment);
end $$;
revoke all on function public.claim_provider_ledger_window(text, integer, integer, integer, integer),
  public.record_provider_ledger_page(text, uuid, text, integer, boolean, integer, integer, text),
  public.record_orphan_provider_payment(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_provider_ledger_window(text, integer, integer, integer, integer),
  public.record_provider_ledger_page(text, uuid, text, integer, boolean, integer, integer, text),
  public.record_orphan_provider_payment(uuid, text, jsonb) to service_role;

-- Local-to-provider direction: money that the books say exists but the provider has not confirmed recently, and
-- approved money with no order. Idempotent; every finding is a durable discrepancy, never a state change.
create function public.run_financial_integrity_checks(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_unverified integer := 0; v_no_order integer := 0; v_row record;
begin
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.provider_payment_id, pi.environment
      from public.payment_intents pi
     where pi.order_id is not null and pi.paid_amount is not null
       and pi.created_at > clock_timestamp() - interval '30 days'
       and not exists (select 1 from public.payment_provider_payments x
                        where x.payment_intent_id = pi.id and x.is_financing
                          and x.last_seen_at > clock_timestamp() - interval '24 hours'
                          and x.raw_response_hash is not null)
     order by pi.created_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'order_paid_unverified',
      'high', false, v_row.provider_payment_id, jsonb_build_object('reason', 'no provider verification in the last 24 hours'),
      'order_paid_unverified:' || v_row.id::text, null, null, v_row.environment);
    v_unverified := v_unverified + 1;
  end loop;
  -- Verified again later => the finding closes itself.
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'verified_no_loss',
         resolution_note = 'the provider confirmed the payment again'
   where d.kind = 'order_paid_unverified' and d.status <> 'resolved'
     and exists (select 1 from public.payment_provider_payments x where x.payment_intent_id = d.payment_intent_id and x.is_financing
                   and x.last_seen_at > clock_timestamp() - interval '24 hours' and x.raw_response_hash is not null);
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.provider_payment_id, pi.environment
      from public.payment_intents pi
     where pi.order_id is null and pi.provider_status = 'approved' and pi.paid_amount is not null
       and pi.updated_at < clock_timestamp() - interval '10 minutes'
       and pi.internal_status not in ('refunded', 'partially_refunded', 'charged_back')
     order by pi.updated_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'paid_without_order',
      'high', false, v_row.provider_payment_id, jsonb_build_object('stage', 'integrity_check'),
      'paid_without_order:' || v_row.id::text, null, null, v_row.environment);
    v_no_order := v_no_order + 1;
  end loop;
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'order_created',
         resolution_note = 'the order now exists'
   where d.kind = 'paid_without_order' and d.status <> 'resolved'
     and exists (select 1 from public.payment_intents pi where pi.id = d.payment_intent_id and pi.order_id is not null);
  return jsonb_build_object('order_paid_unverified', v_unverified, 'paid_without_order', v_no_order);
end $$;
revoke all on function public.run_financial_integrity_checks(integer) from public, anon, authenticated;
grant execute on function public.run_financial_integrity_checks(integer) to service_role;

create or replace function public.sweep_expired_checkout_sessions() returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_released integer;
begin
  v_released := public.expire_checkout_sessions(200);
  perform public.retry_stuck_paid_checkouts(25);
  if extract(minute from clock_timestamp())::integer % 5 = 0 then
    perform public.run_financial_integrity_checks(200);
  end if;
  return coalesce(v_released, 0);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. F10: a disconnect that counts everything that can still move money
-- ---------------------------------------------------------------------------------------------------------------
alter table public.mp_seller_connections add column if not exists disconnect_requested_at timestamptz;

create or replace function public.mp_disconnect_preflight(p_business_id uuid, p_environment text) returns jsonb
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  with intents as (
    select i.id, i.internal_status, i.checkout_session_id, i.approved_at, i.order_id, i.provider_status, i.updated_at,
           s.status as session_status, s.expires_at as session_expires_at
      from public.payment_intents i
      join public.checkout_sessions s on s.id = i.checkout_session_id
     where i.business_id = p_business_id and i.environment = p_environment and i.provider = 'mercadopago'
  ), conn as (
    select c.status, c.protected_tokens is not null as has_tokens
      from public.mp_seller_connections c where c.business_id = p_business_id and c.environment = p_environment
  )
  select jsonb_build_object(
    -- Anything that can still receive, or still needs, a provider read: statuses in flight, approved money with no
    -- order, a checkout whose session can still take a payment (INCLUDING one whose last card was rejected: the buyer
    -- may retry inside the same preference), and a 24 h tail for late/offline payments after expiry.
    'open_payments', (select count(*) from intents i
       where i.internal_status in ('pending', 'in_process', 'approved_order_pending', 'approved', 'ambiguous', 'security_review_required')
          or (i.order_id is null and i.provider_status = 'approved')
          or (i.session_status not in ('completed', 'cancelled', 'expired') and i.session_expires_at > now() - interval '15 minutes')
          or (i.order_id is null and i.session_expires_at > now() - interval '24 hours'
              and i.internal_status in ('created', 'preference_creating', 'preference_created', 'redirected', 'rejected', 'cancelled', 'expired', 'failed'))),
    'refunds_in_progress', (select count(*) from public.payment_refunds r join intents i on i.id = r.payment_intent_id
       where r.status in ('requested', 'processing', 'ambiguous')),
    'cancellations_in_progress', (select count(*) from public.payment_cancellations c join intents i on i.id = c.payment_intent_id
       where c.status in ('requested', 'processing', 'ambiguous')),
    'queued_jobs', (select count(*) from public.payment_outbox o
       where o.status in ('pending', 'claimed', 'processing', 'retry_wait')
         and (o.payment_intent_id in (select id from intents)
              or o.webhook_receipt_id in (select w.id from public.payment_webhook_receipts w
                                           where w.seller_business_id = p_business_id and w.environment = p_environment))),
    -- Unresolved financial findings need the seller's authorization to be closed (provider lookups, refunds).
    'open_discrepancies', (select count(*) from public.payment_discrepancies d
       where d.business_id = p_business_id and d.status <> 'resolved'
         and (d.environment is null or d.environment = p_environment)
         and d.kind <> 'order_paid_unverified'),
    -- The provider ledger must have been read completely AFTER the last financial activity: otherwise a payment made
    -- minutes ago, still unseen, would lose the only credential able to look it up.
    'ledger_unsynced', (select case
        when not coalesce((select has_tokens and status = 'connected' from conn), false) then 0
        when not exists (select 1 from intents) then 0
        when coalesce((select cu.last_completed_at from public.provider_ledger_cursors cu
                        where cu.business_id = p_business_id and cu.environment = p_environment), '-infinity'::timestamptz)
             >= (select max(i.updated_at) from intents i) then 0
        else 1 end),
    'approved_last_180_days', (select count(*) from intents i
       where i.internal_status in ('approved', 'completed', 'partially_refunded')
         and i.approved_at > now() - interval '180 days')
  ) $$;

create or replace function public.mp_disconnect_checked(p_business_id uuid, p_environment text, p_execute boolean) returns jsonb
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare v_pending jsonb; v_blocking bigint;
begin
  perform 1 from public.mp_seller_connections where business_id = p_business_id and environment = p_environment for update;
  update public.business_payment_settings set enabled = false, updated_at = now()
   where business_id = p_business_id and environment = p_environment and enabled;
  v_pending := public.mp_disconnect_preflight(p_business_id, p_environment);
  v_blocking := (v_pending ->> 'open_payments')::bigint + (v_pending ->> 'refunds_in_progress')::bigint
    + (v_pending ->> 'cancellations_in_progress')::bigint + (v_pending ->> 'queued_jobs')::bigint
    + (v_pending ->> 'open_discrepancies')::bigint + (v_pending ->> 'ledger_unsynced')::bigint;
  if v_blocking > 0 then
    if coalesce(p_execute, false) then
      update public.mp_seller_connections set disconnect_requested_at = coalesce(disconnect_requested_at, now())
       where business_id = p_business_id and environment = p_environment;
    end if;
    return jsonb_build_object('ok', false, 'code', 'pending_operations', 'paused', true, 'pending', v_pending);
  end if;
  if not coalesce(p_execute, false) then
    return jsonb_build_object('ok', false, 'code', 'ready_to_disconnect', 'paused', true, 'pending', v_pending);
  end if;
  perform public.mp_disconnect(p_business_id, p_environment);
  update public.mp_seller_connections set disconnect_requested_at = null
   where business_id = p_business_id and environment = p_environment;
  return jsonb_build_object('ok', true, 'paused', true, 'pending', v_pending);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. F14: the console never truncates silently; incidents come first
-- ---------------------------------------------------------------------------------------------------------------
create function private.payment_intent_needs_attention(p_intent_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select coalesce(i.internal_status in ('approved_order_pending', 'approved', 'security_review_required', 'ambiguous', 'pending', 'in_process'), false)
      or coalesce(i.order_id is null and i.provider_status = 'approved', false)
      or exists (select 1 from public.payment_discrepancies d where d.payment_intent_id = i.id and d.status <> 'resolved')
      or exists (select 1 from public.payment_outbox o where o.payment_intent_id = i.id and o.status in ('failed', 'dead_letter'))
      or exists (select 1 from public.payment_refunds r where r.payment_intent_id = i.id and r.status in ('requested', 'processing', 'ambiguous'))
  from public.payment_intents i where i.id = p_intent_id $$;

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.list_business_payments(uuid)'::regprocedure);
  v_new := replace(v_def, 'public.list_business_payments(p_business_id uuid)',
    'public.list_business_payments(p_business_id uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 200, p_search text DEFAULT NULL::text)');
  if v_new = v_def then raise exception 'LIST_PAYMENTS_HEADER_MISMATCH'; end if;
  v_def := v_new;
  v_new := replace(v_def, E'    ''can_recover_order'', v_can_operate and public.can_recover_paid_checkout(pi.id)\n',
    E'    ''can_recover_order'', v_can_operate and public.can_recover_paid_checkout(pi.id),\n'
    || E'    ''financial_hold'', private.payment_financial_hold(pi.id),\n'
    || E'    ''needs_attention'', private.payment_intent_needs_attention(pi.id),\n'
    || E'    ''open_discrepancies'', (select count(*) from public.payment_discrepancies d where d.payment_intent_id = pi.id and d.status <> ''resolved'')\n');
  if v_new = v_def then raise exception 'LIST_PAYMENTS_FIELDS_MISMATCH'; end if;
  v_def := v_new;
  v_new := replace(v_def, E'  where pi.business_id = p_business_id\n  order by pi.created_at desc\n  limit 200;',
    E'  where pi.business_id = p_business_id\n'
    || E'    and (nullif(btrim(coalesce(p_search, '''')), '''') is null\n'
    || E'         or pi.external_reference ilike ''%'' || btrim(p_search) || ''%''\n'
    || E'         or pi.provider_payment_id = btrim(p_search) or right(coalesce(pi.provider_payment_id, ''''), 6) = btrim(p_search)\n'
    || E'         or o.public_code ilike btrim(p_search))\n'
    || E'  order by private.payment_intent_needs_attention(pi.id) desc, pi.created_at desc, pi.id\n'
    || E'  limit greatest(1, least(coalesce(p_limit, 200), 500)) offset greatest(0, coalesce(p_offset, 0));');
  if v_new = v_def then raise exception 'LIST_PAYMENTS_TAIL_MISMATCH'; end if;
  drop function public.list_business_payments(uuid);
  execute v_new;
  revoke all on function public.list_business_payments(uuid, integer, integer, text) from public, anon;
  grant execute on function public.list_business_payments(uuid, integer, integer, text) to authenticated;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Alerts: open discrepancies are alerts; "unverified checkout" is open-ended until closed with evidence
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.reconcile_operational_alerts_for_business(uuid)'::regprocedure);
  v_new := replace(v_def,
    E'        and cs.created_at > clock_timestamp() - interval ''48 hours''\n        and not exists (\n          select 1 from public.payment_events pe\n           where pe.payment_intent_id = pi.id\n             and pe.event_type = ''payment.provider_probe_empty''\n        )\n',
    E'        and (\n          select count(*) from public.payment_events pe\n           where pe.payment_intent_id = pi.id\n             and pe.event_type = ''payment.provider_probe_empty''\n             and pe.server_recorded_at > cs.expires_at + interval ''24 hours''\n        ) < 3\n');
  if v_new = v_def then raise exception 'ALERT_UNVERIFIED_PATTERN_MISMATCH'; end if;
  v_def := v_new;
  v_new := replace(v_def, E'    ) findings\n  loop',
    E'\n      union all\n\n'
    || E'      select\n'
    || E'        case when d.severity in (''critical'', ''high'') then ''CRITICAL'' else ''ACTION_REQUIRED'' end,\n'
    || E'        ''PAYMENT_DISCREPANCY_OPEN'', ''payment_discrepancy'', d.id, coalesce(pi.correlation_id, d.id),\n'
    || E'        (case d.kind\n'
    || E'          when ''paid_without_order'' then ''Pago aprobado sin pedido: recuperar o devolver.''\n'
    || E'          when ''multiple_approved_payments'' then ''Más de un pago aprobado para el mismo checkout.''\n'
    || E'          when ''provider_payment_inconsistent'' then ''Pago del proveedor inconsistente con el checkout.''\n'
    || E'          when ''refund_identity_unknown'' then ''Devolución sin identidad confirmada por el proveedor.''\n'
    || E'          when ''orphan_provider_payment'' then ''Pago en Mercado Pago sin checkout local.''\n'
    || E'          when ''order_paid_unverified'' then ''Pedido cobrado sin verificación reciente del proveedor.''\n'
    || E'          else ''Discrepancia financiera abierta.'' end)::text,\n'
    || E'        ''Abrir Pagos > Discrepancias y resolver con evidencia del proveedor; no repetir cobros ni devoluciones.''::text,\n'
    || E'        jsonb_build_object(''discrepancy_id'', d.id, ''kind'', d.kind, ''blocks_recovery'', d.blocks_recovery, ''occurrences'', d.occurrences)\n'
    || E'      from public.payment_discrepancies d\n'
    || E'      left join public.payment_intents pi on pi.id = d.payment_intent_id\n'
    || E'      where d.business_id = p_business_id and d.status <> ''resolved''\n'
    || E'    ) findings\n  loop');
  if v_new = v_def then raise exception 'ALERT_FINDINGS_TAIL_MISMATCH'; end if;
  execute v_new;
end $$;
