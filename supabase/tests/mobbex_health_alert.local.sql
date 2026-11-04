-- Mobbex health alert: contract of 20261103020000_mobbex_operational_alert.sql against the REAL schema.
-- The runner (scripts/mobbex/run-mobbex-db-tests.mjs) prepends the helpers of mobbex_ledger.local.sql
-- (pg_temp.check / raises / as_user / as_service / as_admin / make_tenant / new_checkout / snap / intent_of),
-- applies both Mobbex migrations, runs this inside a transaction and rolls everything back.

select pg_temp.as_admin();

do $$
declare
  t jsonb; t2 jsonb; c jsonb; i uuid; ref text; v_biz uuid; v_biz2 uuid; v_owner uuid; v_owner2 uuid;
  v_def text; v_count integer; v_alert public.operational_alerts%rowtype;
begin
  -- ═══ 0. Wired exactly once, and the previous alerts are still in the same function ═══
  v_def := pg_get_functiondef('public.reconcile_operational_alerts_for_business(uuid)'::regprocedure);
  perform pg_temp.check((length(v_def) - length(replace(v_def, 'list_mobbex_operational_alerts', ''))) = length('list_mobbex_operational_alerts'),
    'the Mobbex lister is wired into the alert reconciliation exactly once');
  perform pg_temp.check(position('MERCADOPAGO_SELLER_CANNOT_CHARGE' in v_def) > 0 and position('ORDER_STALLED' in v_def) > 0,
    'the pre-existing alert findings are still in the reconciliation');
  perform pg_temp.check(not exists (select 1 from information_schema.role_routine_grants
      where routine_name in ('list_mobbex_operational_alerts', 'set_mobbex_health_alert') and grantee in ('anon', 'authenticated', 'PUBLIC')),
    'neither new function is callable by the browser roles');

  t := pg_temp.make_tenant('h1', 10);
  t2 := pg_temp.make_tenant('h2', 10);
  v_biz := (t ->> 'business')::uuid; v_biz2 := (t2 ->> 'business')::uuid;
  v_owner := (t ->> 'owner')::uuid; v_owner2 := (t2 ->> 'owner')::uuid;
  perform public.configure_mobbex_business(v_biz, true, 'test', 'not_requested', null, 'qa-runner');
  perform public.configure_mobbex_business(v_biz2, true, 'test', 'not_requested', null, 'qa-runner');

  -- A payment whose amount does not match what the server decided: the ledger sends it to security review.
  c := pg_temp.new_checkout(t, 1, 'mbxhealth0001');
  i := pg_temp.intent_of((c ->> 'checkout_session_id')::uuid);
  ref := c ->> 'reference';
  perform public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'PID-H1', '1.00', 0, 'a'), 'reconciliation');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i) = 'security_review_required',
    'fixture: the mismatching payment is in security review');

  -- ═══ 1. OFF by default: nothing is listed and the panel shows nothing ═══
  perform pg_temp.check((select health_alert_enabled from public.mobbex_business_settings where business_id = v_biz) = false, 'the alert is off by default');
  perform pg_temp.check((select count(*) from public.list_mobbex_operational_alerts(v_biz)) = 0, 'off: the lister returns no rows even with a payment in review');
  perform pg_temp.as_user(v_owner);
  perform public.refresh_operational_alerts(v_biz);
  perform pg_temp.as_admin();
  perform pg_temp.check(not exists (select 1 from public.operational_alerts where business_id = v_biz and alert_code like 'MOBBEX\_%'), 'off: no Mobbex alert reaches the panel');

  -- ═══ 2. Enabling is an explicit act, only for the service role ═══
  perform pg_temp.as_user(v_owner);
  perform pg_temp.raises(format($q$select public.set_mobbex_health_alert(%L, true)$q$, v_biz), 'permission denied', 'a browser session cannot enable the alert');
  perform pg_temp.raises(format($q$select * from public.list_mobbex_operational_alerts(%L)$q$, v_biz), 'permission denied', 'a browser session cannot call the lister');
  perform pg_temp.as_admin();
  perform pg_temp.raises($q$select public.set_mobbex_health_alert(gen_random_uuid(), true)$q$, 'sin configuracion', 'an unconfigured business cannot be switched');
  perform public.set_mobbex_health_alert(v_biz, true);

  -- ═══ 3. ON: the panel's own refresh raises exactly one alert, with counts and codes only ═══
  perform pg_temp.check((select count(*) from public.list_mobbex_operational_alerts(v_biz)) = 1, 'on: one finding for the payment in review');
  perform pg_temp.as_user(v_owner);
  perform public.refresh_operational_alerts(v_biz);
  perform pg_temp.as_admin();
  select * into v_alert from public.operational_alerts where business_id = v_biz and alert_code = 'MOBBEX_PAYMENT_NEEDS_REVIEW';
  perform pg_temp.check(found and v_alert.status = 'open' and v_alert.severity = 'ACTION_REQUIRED', 'on: the panel shows an open ACTION_REQUIRED alert');
  perform pg_temp.check((v_alert.evidence ->> 'count')::integer = 1 and v_alert.evidence -> 'reasons' = '["amount_mismatch"]'::jsonb,
    'the evidence is a count and the internal reason code');
  perform pg_temp.check((select array_agg(k order by k) from jsonb_object_keys(v_alert.evidence) k) = array['count', 'reasons'],
    'the evidence has exactly two keys: no credential, contact data or amount can ride along');
  perform pg_temp.check(v_alert.evidence::text !~* '(token|secret|apikey|api_key|email|phone|1250)', 'the evidence text carries nothing sensitive');

  -- ═══ 4. Other businesses are untouched: no leak either way ═══
  perform public.set_mobbex_health_alert(v_biz2, true);
  perform pg_temp.check((select count(*) from public.list_mobbex_operational_alerts(v_biz2)) = 0, 'a healthy business with the alert on has no alert');
  perform pg_temp.as_user(v_owner2);
  perform public.refresh_operational_alerts(v_biz2);
  perform pg_temp.as_admin();
  perform pg_temp.check(not exists (select 1 from public.operational_alerts where business_id = v_biz2 and alert_code like 'MOBBEX\_%'), 'the other business sees none of it');

  -- ═══ 5. The three conditions ═══
  -- mobbex_touch rewrites updated_at on every UPDATE; it is switched off (inside this rolled-back transaction) only to age a row.
  alter table public.mobbex_payment_intents disable trigger mobbex_intents_touch;
  update public.mobbex_payment_intents set internal_status = 'approved_order_pending', paid_amount = expected_amount,
         provider_payment_id = 'PID-H1', updated_at = clock_timestamp() - interval '30 minutes' where id = i;
  perform pg_temp.check((select alert_code from public.list_mobbex_operational_alerts(v_biz) where severity = 'CRITICAL') = 'MOBBEX_PAID_WITHOUT_ORDER',
    'a payment approved 30 minutes ago without an order is CRITICAL');
  update public.mobbex_payment_intents set updated_at = clock_timestamp() - interval '2 minutes' where id = i;
  perform pg_temp.check(not exists (select 1 from public.list_mobbex_operational_alerts(v_biz) where alert_code = 'MOBBEX_PAID_WITHOUT_ORDER'),
    'a payment approved 2 minutes ago is still inside the normal window');
  alter table public.mobbex_payment_intents enable trigger mobbex_intents_touch;
  insert into public.mobbex_jobs (payment_intent_id, reason, status, failures, last_error) values (i, 'webhook', 'dead_letter', 12, 'auth:401');
  perform pg_temp.check((select count(*) from public.list_mobbex_operational_alerts(v_biz) where alert_code = 'MOBBEX_RECONCILIATION_STUCK') = 1,
    'an exhausted reconciliation job raises MOBBEX_RECONCILIATION_STUCK');
  -- Auditoría sesión 5: una devolución enviada sin confirmar hace más de una hora también llega al panel del comercio
  -- (antes sólo la veía mobbex_pipeline_health, global).
  insert into public.mobbex_refunds (payment_intent_id, idempotency_key, amount, status, requested_at)
  values (i, gen_random_uuid(), 100, 'ambiguous', clock_timestamp() - interval '2 hours');
  perform pg_temp.check((select (evidence ->> 'count')::integer from public.list_mobbex_operational_alerts(v_biz) where alert_code = 'MOBBEX_REFUND_UNRESOLVED') = 1,
    'a refund unconfirmed for over an hour raises MOBBEX_REFUND_UNRESOLVED for that business');
  perform pg_temp.check(not exists (select 1 from public.list_mobbex_operational_alerts(v_biz2) where alert_code = 'MOBBEX_REFUND_UNRESOLVED'),
    'another business does not see it');
  update public.mobbex_refunds set status = 'approved', completed_at = clock_timestamp() where payment_intent_id = i;
  perform pg_temp.check(not exists (select 1 from public.list_mobbex_operational_alerts(v_biz) where alert_code = 'MOBBEX_REFUND_UNRESOLVED'),
    'a settled refund raises nothing');

  -- ═══ 6. It resolves by itself when the condition is gone, and switching it off silences it ═══
  delete from public.mobbex_jobs where payment_intent_id = i;
  update public.mobbex_payment_intents set internal_status = 'refunded', refunded_amount = paid_amount, attention_reason = null, review_reason = null where id = i;
  perform pg_temp.as_user(v_owner);
  perform public.refresh_operational_alerts(v_biz);
  perform pg_temp.as_admin();
  perform pg_temp.check((select status from public.operational_alerts where business_id = v_biz and alert_code = 'MOBBEX_PAYMENT_NEEDS_REVIEW') = 'resolved',
    'the alert resolves itself once nobody has to intervene');
  update public.mobbex_payment_intents set attention_reason = 'duplicate_approved_payment' where id = i;
  perform public.set_mobbex_health_alert(v_biz, false);
  perform pg_temp.check((select count(*) from public.list_mobbex_operational_alerts(v_biz)) = 0, 'switched off again: silent');

  raise notice 'MOBBEX_HEALTH_ALERT_ALL_PASS';
end $$;
