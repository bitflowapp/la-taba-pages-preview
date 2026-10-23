// QA-only drill of the second-audit mechanisms, with SYNTHETIC data and NO Mercado Pago call (QA has no seller
// connected). It proves, on the hosted QA project and through the REAL pg_cron + Vault/HMAC dispatch + deployed Edge
// worker, that:
//   1. a pending provider payment carries its own follow-up schedule and becomes due; with no seller connected the
//      scheduler does NOT enqueue reads that could only fail forever (20261022130000), and the integrity check
//      (pg_cron) turns the overdue payment into ONE visible finding and a PAYMENT_DISCREPANCY_OPEN alert instead of
//      dropping it (20261022140000);
//   2. a job whose worker died (processing, lease expired) is not re-claimed first and does not hog the queue: it is
//      reaped to retry_wait with an interruption counted, and gets a backoff;
//   3. the pipeline health now reports the follow-up schedule.
// Each run owns its synthetic tenant and removes it in finally; a saved receipt permits cleanup after interruption.
//   node scripts/recovery/qa-drill-late-changes.mjs --run-file <outside-repo.json> [--local] [--cleanup-only]
import assert from 'node:assert/strict';
import { runDrill } from './qa-drill-runtime.mjs';
const started = Date.now();
const log = row => console.log(JSON.stringify({ t: Math.round((Date.now() - started) / 1000), ...row }));

await runDrill('late-changes', async ({ query, run, sleep, tick }) => {
  const ids=run.ids, PREFERENCE=run.preference;
  const refs = (await query(`select cs.id as session, pi.id as intent, pi.external_reference as ref from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id where pi.business_id = '${ids.business}'`))[0];
  await query(`update public.checkout_sessions set created_at = clock_timestamp() - interval '30 minutes' where id='${refs.session}'`);

  // 1. A pending payment: it has a schedule from the moment it is recorded.
  const snapshot = await query(`select public.record_mercadopago_payment_snapshot('${refs.intent}', jsonb_build_object(
      'provider_payment_id','${run.payment}','external_reference','${refs.ref}','preference_id','${PREFERENCE}','merchant_order_id','DRILL-MO',
      'collector_id','${run.collector}','currency','ARS','transaction_amount','2500.00','status','pending','payment_method','rapipago','live_mode',true,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount','0.00','raw_response_hash', repeat('c',64)),'drill-simulated',null) as r`);
  const watch = (await query(`select watch_state, next_check_at > clock_timestamp() as in_the_future from public.payment_provider_payments where payment_intent_id='${refs.intent}' and provider_payment_id='${run.payment}'`))[0];
  assert.equal(watch?.in_the_future,true);
  log({ phase: 'pending-recorded-with-schedule', snapshot: snapshot[0].r, watch });
  // Time passes: the payment was first seen 3 hours ago and has not been read since.
  await query(`update public.payment_provider_payments set first_seen_at = clock_timestamp() - interval '3 hours', last_seen_at = clock_timestamp() - interval '3 hours' where payment_intent_id='${refs.intent}' and provider_payment_id='${run.payment}'`);
  const due = (await query(`select watch_state, next_check_at < clock_timestamp() as overdue from public.payment_provider_payments where payment_intent_id='${refs.intent}' and provider_payment_id='${run.payment}'`))[0];
  assert.equal(due?.overdue,true);
  log({ phase: 'pending-payment-is-due', due });
  // The integrity check runs inside the checkout sweep every 5 minutes; the alert sweep every minute.
  let finding = null; let alert = null;
  for (let i = 0; i < 48 && !(finding && alert); i += 1) {
    await tick(`select public.run_financial_integrity_checks(200); select public.reconcile_operational_alerts_for_business('${ids.business}');`);
    await sleep(10000);
    finding = (await query(`select kind, status, severity, details->>'reason' as reason from public.payment_discrepancies
        where payment_intent_id='${refs.intent}' and kind='pending_payment_unchecked' limit 1`))[0] || null;
    alert = (await query(`select alert_code, severity, status from public.operational_alerts
        where business_id='${ids.business}' and alert_code='PAYMENT_DISCREPANCY_OPEN' and status<>'resolved' limit 1`))[0] || null;
  }
  const reads = (await query(`select count(*)::int n from public.payment_outbox where payment_intent_id='${refs.intent}' and topic='payment_reconcile'`))[0].n;
  log({ phase: 'unreadable-pending-payment-is-a-visible-finding', finding, alert, readsEnqueuedWithoutSeller: reads });
  assert.ok(finding && alert,'pending payment must produce a finding and an alert');
  assert.equal(reads,0,'no reads without a connected seller');
  assert.equal((await query(`select count(*)::int n from public.payment_discrepancies where payment_intent_id='${refs.intent}' and kind='pending_payment_unchecked'`))[0].n,1);
  // Neutralize it so the drill's second part is read in isolation.
  await query(`update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where payment_intent_id='${refs.intent}' and status <> 'completed'`);

  // 2. A worker that died: processing, lease expired. Nobody re-claims it first.
  await query(`insert into public.payment_outbox(payment_intent_id, topic, resource_id, status, owner, lease_expires_at, attempts)
      values ('${refs.intent}', 'payment', '${run.job}', 'processing', 'drill-dead-worker', clock_timestamp() - interval '1 minute', 1)`);
  let reaped = null;
  for (let i = 0; i < 12 && !reaped; i += 1) {
    await tick(`select public.claim_payment_outbox_v2('drill-reaper',1,60);`);
    await sleep(10000);
    const row = (await query(`select status, attempts, interruptions, owner, left(last_error, 80) as last_error, next_attempt_at > clock_timestamp() as backing_off
        from public.payment_outbox where payment_intent_id='${refs.intent}' and resource_id='${run.job}' limit 1`))[0];
    if (row && (row.interruptions >= 1 || row.status === 'retry_wait')) reaped = row;
  }
  log({ phase: 'dead-worker-job-was-reaped-and-backs-off', job: reaped });
  assert.equal(reaped?.status,'retry_wait');
  assert.equal(reaped?.interruptions,1);
  assert.equal(reaped?.backing_off,true);

  const health = (await query(`select public.payments_pipeline_health() as h`))[0].h;
  log({ phase: 'pipeline-health', outbox: health.outbox, watch: health.watch, ledger: health.ledger });

  // runDrill removes this run's data in finally, including on an assertion failure.
});
