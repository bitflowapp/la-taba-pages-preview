-- Second independent audit (Astra), findings 1 and 2.
--
--  1. Reconciliation could miss LATE changes of payments:
--     - the provider ledger was read by CREATION date inside a ~2 h window, so a refund, a chargeback or the approval
--       of an offline (ticket) payment made days after the payment was never seen again;
--     - it paged by position (offset), which the provider caps (10 000) and which skips rows when an already-read
--       payment changes while the window is being paged;
--     - a payment that was still `pending` was re-read on EVERY scheduler tick (no backoff) or, when settled, never;
--       a checkout with only rejected payments was re-read forever (the closure evidence only counted empty answers);
--     - an approved, completed order was never verified again, so the "unverified" finding was a time bomb;
--     - the orphan inbox kept the severity of the FIRST sighting: pending (low) approved later stayed low.
--  2. The worker could outlive the wall clock the platform grants it (150 s Free / 400 s paid):
--     - a ledger page of 50 slow payments does not fit; the cursor only moved after the whole page => livelock;
--     - jobs were claimed in a batch with a 90 s lease, so late ones lapsed unstarted; a job that is killed every
--       time was re-claimed FIRST on every run and starved the rest of the queue.
--
-- Everything here is additive or replaces function bodies; no financial row is rewritten except the derived,
-- recomputable watch columns. The previous functions keep working for a worker that was not redeployed yet.
--
-- REVERSAL: re-apply the previous bodies of claim_payment_outbox_v2 (20260908190758), claim_provider_ledger_window,
-- enqueue_checkout_provider_probes, run_financial_integrity_checks, record_orphan_provider_payment
-- (20261022110000), private.open_payment_discrepancy (20261022100000) and payments_pipeline_health (20261022120000);
-- drop the trigger payment_provider_payments_watch and the functions added below. The added columns are inert.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Discrepancies escalate: the same fact seen again with more severity becomes more severe, never less.
-- ---------------------------------------------------------------------------------------------------------------
create function private.discrepancy_severity_rank(p_severity text) returns integer
language sql immutable set search_path = pg_catalog as $$
  select case lower(coalesce(p_severity, '')) when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end $$;

create or replace function private.open_payment_discrepancy(
  p_business_id uuid, p_payment_intent_id uuid, p_checkout_session_id uuid, p_kind text, p_severity text,
  p_blocks_recovery boolean, p_provider_payment_id text, p_details jsonb, p_dedupe_key text,
  p_refund_id uuid default null, p_seller_id text default null, p_environment text default null,
  p_provider_refund_id text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_id uuid; v_inserted boolean;
begin
  insert into public.payment_discrepancies as d (
    business_id, payment_intent_id, checkout_session_id, refund_id, kind, severity, blocks_recovery,
    environment, seller_id, provider_payment_id, provider_refund_id, details, dedupe_key)
  values (p_business_id, p_payment_intent_id, p_checkout_session_id, p_refund_id, p_kind, p_severity, p_blocks_recovery,
    p_environment, p_seller_id, p_provider_payment_id, p_provider_refund_id, coalesce(p_details, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) do update
    set occurrences = d.occurrences + 1, last_detected_at = clock_timestamp(),
        details = d.details || excluded.details,
        -- A recurrence with MORE severity escalates the finding (a pending payment that is approved later); it never
        -- lowers one, and it never lifts a block a person has not resolved.
        severity = case when private.discrepancy_severity_rank(excluded.severity) > private.discrepancy_severity_rank(d.severity)
                        then excluded.severity else d.severity end,
        blocks_recovery = d.blocks_recovery or excluded.blocks_recovery,
        -- A recurrence of something already closed reopens it, and an escalation reopens an acknowledged one.
        status = case when d.status = 'resolved' then 'open'
                      when d.status = 'acknowledged'
                           and private.discrepancy_severity_rank(excluded.severity) > private.discrepancy_severity_rank(d.severity) then 'open'
                      else d.status end,
        resolved_at = case when d.status = 'resolved' then null else d.resolved_at end,
        resolved_by = case when d.status = 'resolved' then null else d.resolved_by end,
        resolution = case when d.status = 'resolved' then null else d.resolution end
  returning d.id, (d.xmax = 0) into v_id, v_inserted;
  if v_inserted and p_payment_intent_id is not null then
    insert into public.payment_events (payment_intent_id, event_type, provider_event_id, details)
    values (p_payment_intent_id, 'payment.discrepancy_opened', p_provider_payment_id,
      jsonb_build_object('kind', p_kind, 'severity', p_severity, 'discrepancy_id', v_id));
  end if;
  return v_id;
end $$;

-- An orphan keeps the identity (seller, reference, currency, amount) and the LAST status the provider reported.
create or replace function public.record_orphan_provider_payment(
  p_business_id uuid, p_environment text, p_payment jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_pid text := nullif(btrim(coalesce(p_payment ->> 'id', '')), ''); v_status text := lower(coalesce(p_payment ->> 'status', 'unknown'));
  v_existing uuid;
begin
  if v_pid is null or p_payment ->> 'external_reference' !~ '^taba2:checkout:[0-9a-f-]{36}$' then
    raise exception 'pago huerfano invalido' using errcode = '22023';
  end if;
  -- The ledger window overlaps on purpose: the SAME provider version seen again changes nothing (no reopening of a
  -- finding a person already resolved, no inflated counters). A different status or update time is a new fact.
  select d.id into v_existing from public.payment_discrepancies d
   where d.dedupe_key = 'orphan:' || p_environment || ':' || v_pid
     and d.details ->> 'last_status_seen' = v_status
     and (d.details ->> 'provider_updated') is not distinct from (p_payment ->> 'date_last_updated');
  if found then return v_existing; end if;
  return private.open_payment_discrepancy(p_business_id, null, null, 'orphan_provider_payment',
    case when v_status in ('approved', 'refunded', 'charged_back') then 'critical' else 'low' end,
    v_status in ('approved', 'refunded', 'charged_back'), v_pid,
    jsonb_build_object('status', v_status, 'amount', p_payment ->> 'transaction_amount', 'currency', p_payment ->> 'currency_id',
      'external_reference', p_payment ->> 'external_reference', 'created', p_payment ->> 'date_created',
      'provider_updated', p_payment ->> 'date_last_updated', 'last_status_seen', v_status),
    'orphan:' || p_environment || ':' || v_pid, null, p_payment ->> 'collector_id', p_environment);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Every provider payment carries its own follow-up schedule until the provider settles it with evidence.
--    pending / in_process / authorized : re-read on a backoff (1 min -> 6 h) until a terminal status is observed.
--    approved                          : verified on a ladder (15 m, 1 h, 6 h, 24 h, 3 d, 7 d, 14 d, 30 d) so a refund or a
--                                        chargeback made later is found even if no webhook arrives.
--    rejected / cancelled / expired / refunded / charged_back / defective : settled (nothing left to watch).
--    The schedule is derived from first_seen_at / last_seen_at, so any observation (webhook, ledger, probe) advances it.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.payment_provider_payments
  add column if not exists next_check_at timestamptz,
  add column if not exists watch_state text not null default 'settled';
alter table public.payment_provider_payments
  drop constraint if exists payment_provider_payments_watch_state_check;
alter table public.payment_provider_payments
  add constraint payment_provider_payments_watch_state_check check (watch_state in ('pending', 'verify', 'settled'));
create index if not exists payment_provider_payments_watch_idx
  on public.payment_provider_payments (next_check_at) where next_check_at is not null;
comment on column public.payment_provider_payments.next_check_at is
  'When the provider must be asked about this payment again. NULL = settled with evidence.';

create function private.provider_payment_watch_trigger() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_status text := lower(btrim(coalesce(new.status, '')));
  v_age interval;
  v_rung interval;
  v_rungs interval[] := array['15 minutes', '1 hour', '6 hours', '24 hours', '3 days', '7 days', '14 days', '30 days']::interval[];
begin
  new.watch_state := 'settled';
  new.next_check_at := null;
  if new.validation_error is not null then return new; end if;
  if v_status in ('pending', 'in_process', 'authorized') then
    v_age := new.last_seen_at - new.first_seen_at;
    new.watch_state := 'pending';
    new.next_check_at := new.last_seen_at + case
      when v_age < interval '10 minutes' then interval '1 minute'
      when v_age < interval '1 hour' then interval '5 minutes'
      when v_age < interval '6 hours' then interval '15 minutes'
      when v_age < interval '48 hours' then interval '1 hour'
      else interval '6 hours' end;
  elsif v_status = 'approved' then
    foreach v_rung in array v_rungs loop
      if new.first_seen_at + v_rung > new.last_seen_at then
        new.watch_state := 'verify';
        new.next_check_at := new.first_seen_at + v_rung;
        exit;
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger payment_provider_payments_watch
  before insert or update on public.payment_provider_payments
  for each row execute function private.provider_payment_watch_trigger();

-- Existing rows get their schedule (the trigger derives it from last_seen_at).
update public.payment_provider_payments set last_seen_at = last_seen_at;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Jobs: a job whose owner died or ran out of time is NOT re-claimed first; it backs off, and a claimed job that
--    never started gets its attempt back. The worker can heartbeat, and release a job it cannot finish in time.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.payment_outbox
  add column if not exists interruptions integer not null default 0;
alter table public.payment_outbox
  drop constraint if exists payment_outbox_interruptions_check;
alter table public.payment_outbox
  add constraint payment_outbox_interruptions_check check (interruptions >= 0);

create or replace function public.claim_payment_outbox_v2(
  p_owner text, p_limit integer default 20, p_lease_seconds integer default 90
)
returns setof public.payment_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_reaped record;
begin
  if nullif(btrim(p_owner), '') is null then raise exception 'owner requerido' using errcode = '22023'; end if;
  -- Reap what a dead or overrun worker left behind. A job that was only CLAIMED never ran: it is due again and gets
  -- its attempt back. A job that was PROCESSING was interrupted: it waits (exponential backoff) so it cannot hog the
  -- front of the queue, and after the same eight attempts as an explicit failure it is parked as dead_letter (alert).
  for v_reaped in
    update public.payment_outbox o
       set status = case when o.status = 'claimed' then 'pending'
                         when o.attempts >= 8 then 'dead_letter' else 'retry_wait' end,
           attempts = case when o.status = 'claimed' then greatest(o.attempts - 1, 0) else o.attempts end,
           interruptions = o.interruptions + case when o.status = 'processing' then 1 else 0 end,
           lease_expires_at = null,
           last_error = case when o.status = 'processing' then 'lease_expired_interrupted' else o.last_error end,
           next_attempt_at = case when o.status = 'claimed' or o.attempts >= 8 then o.next_attempt_at
                                  else clock_timestamp() + make_interval(secs => least(3600, 15 * (2 ^ least(o.attempts, 8))::integer)) end
     where o.status in ('claimed', 'processing')
       and coalesce(o.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp()
     returning o.id, o.status as new_status, o.webhook_receipt_id
  loop
    if v_reaped.webhook_receipt_id is not null and v_reaped.new_status in ('retry_wait', 'dead_letter') then
      update public.payment_webhook_receipts
         set processing_status = v_reaped.new_status, last_error = 'lease_expired_interrupted'
       where id = v_reaped.webhook_receipt_id;
    end if;
  end loop;

  return query
  with candidate as (
    select o.id
      from public.payment_outbox o
     where o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp()
     order by o.next_attempt_at, o.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.payment_outbox o
     set status = 'claimed', owner = left(btrim(p_owner), 200),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 600))),
         attempts = o.attempts + 1
    from candidate c
   where o.id = c.id
  returning o.*;
end;
$$;
revoke all on function public.claim_payment_outbox_v2(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_payment_outbox_v2(text, integer, integer) to service_role;

-- Still ours? Extends the lease while the worker is alive and working.
create function public.extend_payment_outbox_lease(p_job_id uuid, p_owner text, p_lease_seconds integer default 60)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  update public.payment_outbox
     set lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 60), 600)))
   where id = p_job_id and owner = p_owner and status in ('claimed', 'processing')
     and lease_expires_at > clock_timestamp();
  return found;
end $$;

-- The worker ran out of time: hand the job back instead of failing it. While it happens rarely the attempt is
-- refunded; a job interrupted three times in a row is genuinely too big and starts spending its retry budget.
create function public.release_payment_outbox_job(
  p_job_id uuid, p_owner text, p_delay_seconds integer default 5, p_error_code text default null
) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_job public.payment_outbox%rowtype; v_status text; v_attempts integer; v_delay integer;
begin
  select * into v_job from public.payment_outbox o where o.id = p_job_id and o.owner = p_owner for update;
  if not found or v_job.status not in ('claimed', 'processing') then return null; end if;
  if v_job.status = 'claimed' then
    update public.payment_outbox set status = 'pending', attempts = greatest(attempts - 1, 0), lease_expires_at = null
     where id = v_job.id;
    return 'pending';
  end if;
  v_attempts := case when v_job.interruptions < 3 then greatest(v_job.attempts - 1, 0) else v_job.attempts end;
  v_status := case when v_attempts >= 8 then 'dead_letter' else 'retry_wait' end;
  -- Once it has been interrupted three times it is genuinely too big for one invocation: wait like a failure would.
  v_delay := case when v_job.interruptions < 3 then greatest(1, least(coalesce(p_delay_seconds, 5), 3600))
                  else least(3600, 15 * (2 ^ least(v_attempts, 8))::integer) end;
  update public.payment_outbox
     set status = v_status, lease_expires_at = null, interruptions = interruptions + 1, attempts = v_attempts,
         last_error = left(coalesce(p_error_code, 'worker_time_budget'), 160),
         next_attempt_at = case when v_status = 'dead_letter' then next_attempt_at
                                else clock_timestamp() + make_interval(secs => v_delay) end
   where id = v_job.id;
  if v_job.webhook_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = v_status, last_error = left(coalesce(p_error_code, 'worker_time_budget'), 160)
     where id = v_job.webhook_receipt_id;
  end if;
  return v_status;
end $$;
revoke all on function public.extend_payment_outbox_lease(uuid, text, integer),
  public.release_payment_outbox_job(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.extend_payment_outbox_lease(uuid, text, integer),
  public.release_payment_outbox_job(uuid, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Provider ledger: read by LAST UPDATE, with a keyset cursor (timestamp + how many rows at that exact timestamp
--    are done) instead of a position, checkpointed during the page and releasable.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.provider_ledger_cursors add column if not exists cursor_at timestamptz;
comment on column public.provider_ledger_cursors.cursor_at is
  'Last provider date_last_updated fully handled in the open window. next_offset = rows already handled AT that timestamp.';

-- Windows opened by the previous reader were positions in a creation-date ordering: they mean nothing to this one.
-- Close them, and re-read the last seven days by last update once (idempotent): that is how a late change that the
-- previous reader could never see (a refund, a chargeback, a late approval) is caught up on.
update public.provider_ledger_cursors
   set window_begin = null, window_end = null, cursor_at = null, next_offset = 0,
       lease_owner = null, lease_expires_at = null,
       watermark_at = least(watermark_at, clock_timestamp() - interval '7 days'), updated_at = clock_timestamp()
 where window_end is not null or watermark_at > clock_timestamp() - interval '7 days';

create function private.provider_ts(p_ts timestamptz) returns text
language sql immutable set search_path = pg_catalog as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create or replace function public.claim_provider_ledger_window(
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
    -- The window is [watermark - overlap, now] by DATE_LAST_UPDATED, in provider precision (milliseconds).
    update public.provider_ledger_cursors
       set window_begin = date_trunc('milliseconds', watermark_at - make_interval(mins => greatest(0, coalesce(p_overlap_minutes, 120)))),
           window_end = date_trunc('milliseconds', clock_timestamp()),
           cursor_at = date_trunc('milliseconds', watermark_at - make_interval(mins => greatest(0, coalesce(p_overlap_minutes, 120)))),
           next_offset = 0, last_started_at = clock_timestamp()
     where business_id = v_row.business_id and environment = v_row.environment
     returning * into v_row;
  end if;
  update public.provider_ledger_cursors
     set lease_owner = p_owner, lease_expires_at = clock_timestamp() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 150))),
         updated_at = clock_timestamp()
   where business_id = v_row.business_id and environment = v_row.environment;
  return jsonb_build_object('business_id', v_row.business_id, 'environment', v_row.environment,
    'begin', private.provider_ts(v_row.window_begin), 'end', private.provider_ts(v_row.window_end),
    'cursor_at', private.provider_ts(coalesce(v_row.cursor_at, v_row.window_begin)), 'offset', v_row.next_offset);
end $$;

create function public.record_provider_ledger_checkpoint(
  p_owner text, p_business_id uuid, p_environment text, p_cursor_at timestamptz, p_cursor_skip integer,
  p_payments_seen integer default 0, p_orphans_found integer default 0, p_done boolean default false,
  p_error text default null, p_release boolean default false, p_lease_seconds integer default 90
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_row public.provider_ledger_cursors%rowtype; v_moves boolean;
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
       set watermark_at = window_end, window_begin = null, window_end = null, cursor_at = null, next_offset = 0,
           last_completed_at = clock_timestamp(), last_error = null, consecutive_failures = 0,
           pages_total = pages_total + 1, payments_seen = payments_seen + greatest(0, p_payments_seen),
           orphans_found = orphans_found + greatest(0, p_orphans_found),
           lease_owner = null, lease_expires_at = null, updated_at = clock_timestamp()
     where business_id = p_business_id and environment = p_environment;
    return true;
  end if;
  -- The cursor only moves forward; a late or repeated checkpoint can never rewind it.
  v_moves := p_cursor_at is not null and p_cursor_at >= coalesce(v_row.cursor_at, '-infinity'::timestamptz);
  update public.provider_ledger_cursors
     set cursor_at = case when v_moves then date_trunc('milliseconds', p_cursor_at) else cursor_at end,
         next_offset = case when v_moves then greatest(0, coalesce(p_cursor_skip, 0)) else next_offset end,
         pages_total = pages_total + 1,
         payments_seen = payments_seen + greatest(0, p_payments_seen),
         orphans_found = orphans_found + greatest(0, p_orphans_found),
         last_error = null, consecutive_failures = 0,
         lease_owner = case when coalesce(p_release, false) then null else lease_owner end,
         lease_expires_at = case when coalesce(p_release, false) then null
                                 else clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 600))) end,
         updated_at = clock_timestamp()
   where business_id = p_business_id and environment = p_environment;
  return true;
end $$;

-- A payment the provider lists that we already hold unchanged (same status, same last update) is only "seen again":
-- one cheap write instead of a full re-read. Anything different (or unknown) returns false and is read in full.
create function public.provider_payment_unchanged(
  p_environment text, p_seller_id text, p_provider_payment_id text, p_status text, p_updated_at timestamptz
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_updated_at is null or nullif(btrim(coalesce(p_provider_payment_id, '')), '') is null then return false; end if;
  -- A payment whose purchase still waits for its order is always read in full (the finalize step may be pending).
  update public.payment_provider_payments x set last_seen_at = clock_timestamp()
    from public.payment_intents pi
   where pi.id = x.payment_intent_id and pi.internal_status <> 'approved_order_pending'
     and x.provider = 'mercadopago' and x.environment = p_environment and x.seller_id = btrim(coalesce(p_seller_id, ''))
     and x.provider_payment_id = btrim(p_provider_payment_id)
     and x.status = lower(btrim(coalesce(p_status, '')))
     and x.validation_error is null and x.raw_response_hash is not null
     and date_trunc('milliseconds', x.provider_event_at) = date_trunc('milliseconds', p_updated_at);
  return found;
end $$;

revoke all on function public.record_provider_ledger_checkpoint(text, uuid, text, timestamptz, integer, integer, integer, boolean, text, boolean, integer),
  public.provider_payment_unchanged(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_provider_ledger_checkpoint(text, uuid, text, timestamptz, integer, integer, integer, boolean, text, boolean, integer),
  public.provider_payment_unchanged(text, text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. What the scheduler enqueues: payments that are due on their own schedule, and intents never answered.
-- ---------------------------------------------------------------------------------------------------------------
create function public.record_provider_probe_seen(p_payment_intent_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_expires timestamptz;
begin
  select cs.expires_at into v_expires from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id where pi.id = p_payment_intent_id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (p_payment_intent_id, 'payment.provider_probe_seen',
    jsonb_build_object('source', 'provider_truth_sweep', 'after_expiry_grace', coalesce(clock_timestamp() > v_expires + interval '24 hours', false)));
end $$;
revoke all on function public.record_provider_probe_seen(uuid) from public, anon, authenticated;
grant execute on function public.record_provider_probe_seen(uuid) to service_role;

create or replace function public.enqueue_checkout_provider_probes(p_limit integer default 50) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200)); v_watch integer; v_probes integer;
begin
  -- (a) Payments the provider has not settled yet, or that are due for their verification: ask by the payment itself.
  with due as (
    select distinct on (w.payment_intent_id) w.payment_intent_id, w.provider_payment_id, w.next_check_at
      from public.payment_provider_payments w
     where w.next_check_at is not null and w.next_check_at <= clock_timestamp()
       and not exists (select 1 from public.payment_outbox po
                        where po.payment_intent_id = w.payment_intent_id and po.topic = 'payment_reconcile'
                          and po.status in ('pending', 'claimed', 'processing', 'retry_wait'))
     order by w.payment_intent_id, w.next_check_at
  ), ranked as (
    select * from due order by next_check_at limit v_limit
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  select r.payment_intent_id, 'payment_reconcile', r.provider_payment_id from ranked r
  on conflict do nothing;
  get diagnostics v_watch = row_count;

  -- (b) Intents the provider never told us about (or whose attempts all failed): a checkout is only "closed with
  -- evidence" after the preference expired, a 24 h grace for late/offline payments passed, and three further reads
  -- (empty answers OR answers that only held settled, non-money payments) found nothing new. A counter or an age
  -- alone never closes it. Intents with a payment on a schedule (a) are not read again here.
  with probes as (
    select pi.id as intent_id,
           count(*) filter (where pe.event_type in ('payment.provider_probe_empty', 'payment.provider_probe_seen')) as reads,
           count(*) filter (where pe.event_type in ('payment.provider_probe_empty', 'payment.provider_probe_seen')
                              and pe.server_recorded_at > cs.expires_at + interval '24 hours') as reads_after_grace,
           max(pe.server_recorded_at) filter (where pe.event_type in ('payment.provider_probe_empty', 'payment.provider_probe_seen')) as last_probe
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      left join public.payment_events pe on pe.payment_intent_id = pi.id
           and pe.event_type in ('payment.provider_probe_empty', 'payment.provider_probe_seen')
     where cs.completed_order_id is null and pi.order_id is null
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and nullif(btrim(coalesce(pi.external_reference, '')), '') is not null
       and pi.internal_status not in ('completed', 'refunded', 'partially_refunded', 'charged_back', 'security_review_required')
       and cs.created_at < clock_timestamp() - interval '90 seconds'
       and not exists (select 1 from public.payment_provider_payments w
                        where w.payment_intent_id = pi.id and w.next_check_at is not null)
     group by pi.id, cs.expires_at, cs.created_at
  ), due as (
    select p.intent_id from probes p
     where p.reads_after_grace < 3
       and (p.last_probe is null or p.last_probe < clock_timestamp() - case
              when p.reads < 5 then interval '2 minutes'
              when p.reads < 20 then interval '10 minutes'
              else interval '1 hour' end)
       and not exists (select 1 from public.payment_outbox po
                        where po.payment_intent_id = p.intent_id and po.topic = 'payment_reconcile'
                          and po.status in ('pending', 'claimed', 'processing', 'retry_wait'))
     order by coalesce(p.last_probe, '-infinity'::timestamptz)
     limit v_limit
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  select d.intent_id, 'payment_reconcile', null from due d
  on conflict do nothing;
  get diagnostics v_probes = row_count;
  return coalesce(v_watch, 0) + coalesce(v_probes, 0);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Integrity checks: "unverified" now means the verification ladder is overdue, and a pending payment nobody
--    has re-read for an hour is itself a finding (the safety net behind the schedule).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.run_financial_integrity_checks(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_unverified integer := 0; v_no_order integer := 0; v_pending integer := 0; v_row record;
begin
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.provider_payment_id, pi.environment
      from public.payment_intents pi
     where pi.order_id is not null and pi.paid_amount is not null
       and pi.created_at > clock_timestamp() - interval '30 days'
       and exists (select 1 from public.payment_provider_payments x
                    where x.payment_intent_id = pi.id and x.is_financing and x.watch_state = 'verify'
                      and x.next_check_at < clock_timestamp() - interval '1 hour')
     order by pi.created_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'order_paid_unverified',
      'high', false, v_row.provider_payment_id, jsonb_build_object('reason', 'provider verification is overdue'),
      'order_paid_unverified:' || v_row.id::text, null, null, v_row.environment);
    v_unverified := v_unverified + 1;
  end loop;
  -- Verified again later => the finding closes itself.
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'verified_no_loss',
         resolution_note = 'the provider confirmed the payment again'
   where d.kind = 'order_paid_unverified' and d.status <> 'resolved'
     and not exists (select 1 from public.payment_provider_payments x
                      where x.payment_intent_id = d.payment_intent_id and x.is_financing and x.watch_state = 'verify'
                        and x.next_check_at < clock_timestamp() - interval '1 hour');
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.environment, x.provider_payment_id, x.id as watch_id
      from public.payment_provider_payments x
      join public.payment_intents pi on pi.id = x.payment_intent_id
     where x.watch_state = 'pending' and x.next_check_at < clock_timestamp() - interval '1 hour'
     order by x.next_check_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'pending_payment_unchecked',
      'high', false, v_row.provider_payment_id, jsonb_build_object('reason', 'a pending provider payment was not re-read on schedule'),
      'pending_unchecked:' || v_row.watch_id::text, null, null, v_row.environment);
    v_pending := v_pending + 1;
  end loop;
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'checked_again',
         resolution_note = 'the pending payment was read again or settled'
   where d.kind = 'pending_payment_unchecked' and d.status <> 'resolved'
     and not exists (select 1 from public.payment_provider_payments x
                      where x.payment_intent_id = d.payment_intent_id and x.watch_state = 'pending'
                        and x.next_check_at < clock_timestamp() - interval '1 hour');
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
  return jsonb_build_object('order_paid_unverified', v_unverified, 'paid_without_order', v_no_order, 'pending_payment_unchecked', v_pending);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Pipeline health: how many payments are overdue on their own schedule, and how many jobs were interrupted.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.payments_pipeline_health() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare v_scheduler jsonb;
begin
  begin
    select coalesce(jsonb_agg(jsonb_build_object('job', job_name, 'active', active, 'last_start', last_start,
      'last_status', last_status, 'failures_since_success', failures_since_success) order by job_name), '[]'::jsonb)
      into v_scheduler from public.list_scheduler_health();
  exception when others then v_scheduler := '[]'::jsonb;
  end;
  return jsonb_build_object(
    'checked_at', clock_timestamp(),
    'scheduler', v_scheduler,
    'outbox', jsonb_build_object(
      'due_jobs', (select count(*) from public.payment_outbox o where o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp()),
      'oldest_due_age_seconds', (select round(extract(epoch from clock_timestamp() - min(o.next_attempt_at)))
          from public.payment_outbox o where o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp()),
      'expired_leases', (select count(*) from public.payment_outbox o where o.status in ('claimed', 'processing') and o.lease_expires_at < clock_timestamp()),
      'repeated_failures', (select count(*) from public.payment_outbox o where o.status in ('pending', 'retry_wait', 'claimed', 'processing') and o.attempts >= 5),
      'interrupted_jobs', (select count(*) from public.payment_outbox o where o.status in ('pending', 'retry_wait', 'claimed', 'processing') and o.interruptions >= 1),
      'dead_letter', (select count(*) from public.payment_outbox o where o.status in ('failed', 'dead_letter'))),
    'ledger', jsonb_build_object(
      'connected_sellers', (select count(*) from public.mp_seller_connections c where c.status = 'connected' and c.protected_tokens is not null),
      'max_lag_seconds', (select round(extract(epoch from clock_timestamp() - min(coalesce(cu.last_completed_at, c.updated_at))))
          from public.mp_seller_connections c
          left join public.provider_ledger_cursors cu on cu.business_id = c.business_id and cu.environment = c.environment
         where c.status = 'connected' and c.protected_tokens is not null),
      'failing_cursors', (select count(*) from public.provider_ledger_cursors cu where cu.consecutive_failures >= 3)),
    'watch', jsonb_build_object(
      'pending_payments', (select count(*) from public.payment_provider_payments x where x.watch_state = 'pending'),
      'pending_overdue_over_1h', (select count(*) from public.payment_provider_payments x where x.watch_state = 'pending' and x.next_check_at < clock_timestamp() - interval '1 hour'),
      'verification_overdue_over_1h', (select count(*) from public.payment_provider_payments x where x.watch_state = 'verify' and x.next_check_at < clock_timestamp() - interval '1 hour')),
    'money', jsonb_build_object(
      'approved_without_order_over_10m', (select count(*) from public.payment_intents pi
          where pi.order_id is null and pi.provider_status = 'approved' and pi.paid_amount is not null
            and pi.updated_at < clock_timestamp() - interval '10 minutes'),
      'open_discrepancies_critical', (select count(*) from public.payment_discrepancies d where d.status <> 'resolved' and d.severity = 'critical'),
      'open_discrepancies_total', (select count(*) from public.payment_discrepancies d where d.status <> 'resolved'),
      'ambiguous_refunds', (select count(*) from public.payment_refunds r where r.status = 'ambiguous')),
    'last_worker_dispatch_at', (select max(a.requested_at) from private.a1_a4_payment_dispatch_audit a));
end $$;
