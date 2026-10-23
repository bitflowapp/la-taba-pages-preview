-- The scheduled worker must also run when there is nothing in the outbox (the provider ledger sweep has no job),
-- must not storm, and a stalled payments pipeline must become a visible alert (forensic finding F11).
--
-- REVERSAL: re-apply the dispatcher body from 20260909011239 and the alerts function from 20260810140000 +
-- 20261022110000; drop the two helper functions. Nothing here touches financial rows.

-- True when a connected seller's provider ledger is due for a read (same predicate as claim_provider_ledger_window).
create function private.provider_ledger_due(p_period_minutes integer default 10) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1
      from public.mp_seller_connections c
      left join public.provider_ledger_cursors cu on cu.business_id = c.business_id and cu.environment = c.environment
     where c.status = 'connected' and c.protected_tokens is not null
       and (cu.business_id is null
            or ((cu.lease_expires_at is null or cu.lease_expires_at < clock_timestamp())
                and (cu.window_end is not null
                     or cu.last_completed_at is null
                     or cu.last_completed_at < clock_timestamp() - make_interval(mins => greatest(1, coalesce(p_period_minutes, 10))))
                and (cu.consecutive_failures = 0
                     or cu.updated_at < clock_timestamp() - make_interval(mins => least(60, 2 ^ least(cu.consecutive_failures, 6))::integer))))
  ) $$;

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.dispatch_payment_outbox_worker_v3_body(text)'::regprocedure);
  v_new := replace(v_def,
    E'  if not v_due then return null; end if;\n',
    E'  -- The provider ledger sweep has no outbox job: it is due on its own clock.\n'
    || E'  if not v_due then v_due := private.provider_ledger_due(); end if;\n'
    || E'  if not v_due then return null; end if;\n'
    -- No storm: at most one dispatch every 4 seconds, whoever asks (cron, insert kick, retries).
    || E'  if exists(select 1 from private.a1_a4_payment_dispatch_audit a where a.requested_at > clock_timestamp() - interval ''4 seconds'') then return null; end if;\n');
  if v_new = v_def then raise exception 'DISPATCHER_PATTERN_MISMATCH'; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Pipeline health: what is waiting, for how long, and what keeps failing. Counts only, no business data.
-- ---------------------------------------------------------------------------------------------------------------
create function public.payments_pipeline_health() returns jsonb
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
      'dead_letter', (select count(*) from public.payment_outbox o where o.status in ('failed', 'dead_letter'))),
    'ledger', jsonb_build_object(
      'connected_sellers', (select count(*) from public.mp_seller_connections c where c.status = 'connected' and c.protected_tokens is not null),
      'max_lag_seconds', (select round(extract(epoch from clock_timestamp() - min(coalesce(cu.last_completed_at, c.updated_at))))
          from public.mp_seller_connections c
          left join public.provider_ledger_cursors cu on cu.business_id = c.business_id and cu.environment = c.environment
         where c.status = 'connected' and c.protected_tokens is not null),
      'failing_cursors', (select count(*) from public.provider_ledger_cursors cu where cu.consecutive_failures >= 3)),
    'money', jsonb_build_object(
      'approved_without_order_over_10m', (select count(*) from public.payment_intents pi
          where pi.order_id is null and pi.provider_status = 'approved' and pi.paid_amount is not null
            and pi.updated_at < clock_timestamp() - interval '10 minutes'),
      'open_discrepancies_critical', (select count(*) from public.payment_discrepancies d where d.status <> 'resolved' and d.severity = 'critical'),
      'open_discrepancies_total', (select count(*) from public.payment_discrepancies d where d.status <> 'resolved'),
      'ambiguous_refunds', (select count(*) from public.payment_refunds r where r.status = 'ambiguous')),
    'last_worker_dispatch_at', (select max(a.requested_at) from private.a1_a4_payment_dispatch_audit a));
end $$;
revoke all on function public.payments_pipeline_health() from public, anon, authenticated;
grant execute on function public.payments_pipeline_health() to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Alert: the pipeline itself is stalled or failing repeatedly (one per business, resolves when the cause clears).
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.reconcile_operational_alerts_for_business(uuid)'::regprocedure);
  v_new := replace(v_def, E'    ) findings\n  loop',
    E'\n      union all\n\n'
    || E'      select ''CRITICAL'', ''PAYMENT_PIPELINE_STALLED'', ''business'', p_business_id, null::uuid,\n'
    || E'        ''El procesamiento de pagos está demorado o falla en forma repetida.''::text,\n'
    || E'        ''Revisar el estado del procesador de pagos y del reloj; no repetir cobros. Los cobros aprobados no se pierden: quedan en cola.''::text,\n'
    || E'        jsonb_build_object(\n'
    || E'          ''due_over_5m'', (select count(*) from public.payment_outbox o join public.payment_intents pi2 on pi2.id = o.payment_intent_id\n'
    || E'              where pi2.business_id = p_business_id and o.status in (''pending'', ''retry_wait'') and o.next_attempt_at < clock_timestamp() - interval ''5 minutes''),\n'
    || E'          ''stale_leases'', (select count(*) from public.payment_outbox o join public.payment_intents pi2 on pi2.id = o.payment_intent_id\n'
    || E'              where pi2.business_id = p_business_id and o.status in (''claimed'', ''processing'') and o.lease_expires_at < clock_timestamp() - interval ''5 minutes''),\n'
    || E'          ''dead_letter'', (select count(*) from public.payment_outbox o join public.payment_intents pi2 on pi2.id = o.payment_intent_id\n'
    || E'              where pi2.business_id = p_business_id and o.status in (''failed'', ''dead_letter'')),\n'
    || E'          ''repeated_failures'', (select count(*) from public.payment_outbox o join public.payment_intents pi2 on pi2.id = o.payment_intent_id\n'
    || E'              where pi2.business_id = p_business_id and o.status in (''pending'', ''retry_wait'', ''claimed'', ''processing'') and o.attempts >= 5),\n'
    || E'          ''ledger_lag_minutes'', (select round(extract(epoch from clock_timestamp() - coalesce(cu.last_completed_at, c.updated_at)) / 60)\n'
    || E'              from public.mp_seller_connections c left join public.provider_ledger_cursors cu on cu.business_id = c.business_id and cu.environment = c.environment\n'
    || E'              where c.business_id = p_business_id and c.status = ''connected'' and c.protected_tokens is not null limit 1))\n'
    || E'      where exists (select 1 from public.payment_outbox o join public.payment_intents pi2 on pi2.id = o.payment_intent_id\n'
    || E'              where pi2.business_id = p_business_id\n'
    || E'                and ((o.status in (''pending'', ''retry_wait'') and o.next_attempt_at < clock_timestamp() - interval ''5 minutes'')\n'
    || E'                  or (o.status in (''claimed'', ''processing'') and o.lease_expires_at < clock_timestamp() - interval ''5 minutes'')\n'
    || E'                  or o.status in (''failed'', ''dead_letter'')\n'
    || E'                  or (o.status in (''pending'', ''retry_wait'', ''claimed'', ''processing'') and o.attempts >= 5)))\n'
    || E'         or exists (select 1 from public.mp_seller_connections c left join public.provider_ledger_cursors cu on cu.business_id = c.business_id and cu.environment = c.environment\n'
    || E'              where c.business_id = p_business_id and c.status = ''connected'' and c.protected_tokens is not null\n'
    || E'                and coalesce(cu.last_completed_at, c.updated_at) < clock_timestamp() - interval ''30 minutes'')\n'
    || E'    ) findings\n  loop');
  if v_new = v_def then raise exception 'ALERT_PIPELINE_TAIL_MISMATCH'; end if;
  execute v_new;
end $$;
