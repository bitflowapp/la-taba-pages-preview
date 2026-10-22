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
// The synthetic tenant (suffix fc) is paused at the end. Refuses any project other than the recovery QA project.
//   node scripts/recovery/qa-drill-late-changes.mjs [--cleanup-only]
import fs from 'node:fs';
import { withRecoveryProject } from './hosted-client.mjs';
import { committedFixtureSql } from '../../tests/db/harness.mjs';

const target = JSON.parse(fs.readFileSync('deploy/recovery-free-hosted.json', 'utf8'));
if (target.projectRef !== 'ixewllzzuzpqrkxzmfzx' || target.environment !== 'test') throw new Error('QA project only');
const SUFFIX = 'fc';
const ids = { business: `20000000-0000-4000-8000-0000000000${SUFFIX}`, product: `30000000-0000-4000-8000-0000000000${SUFFIX}` };
// Preference ids are unique across the whole project: every drill tenant needs its own.
const PREFERENCE = `DRILL-${SUFFIX.toUpperCase()}-PREF`;
const fixture = committedFixtureSql(2)
  .replaceAll('0000000000fa', `0000000000${SUFFIX}`).replaceAll('forensic-fix', `drill-${SUFFIX}-qa`)
  .replaceAll('forensicfix000001', `drillcheckout${SUFFIX}01`).replaceAll('FORENSIC-PREF', PREFERENCE);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const started = Date.now();
const log = row => console.log(JSON.stringify({ t: Math.round((Date.now() - started) / 1000), ...row }));

await withRecoveryProject(target, async ({ query }) => {
  const exists = (await query(`select count(*)::int n from public.businesses where id = '${ids.business}'`))[0].n;
  if (process.argv.includes('--cleanup-only')) {
    await query(`update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where payment_intent_id in (select id from public.payment_intents where business_id='${ids.business}') and status <> 'completed'`);
    await query(`update public.businesses set status='paused', is_active=false, ordering_enabled=false where id='${ids.business}'`);
    log({ phase: 'paused-synthetic-tenant' });
    return;
  }
  if (exists) throw new Error('drill tenant already exists; run --cleanup-only or choose another suffix');
  await query(fixture);
  const refs = (await query(`select cs.id as session, pi.id as intent, pi.external_reference as ref from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id where pi.business_id = '${ids.business}'`))[0];
  await query(`update public.checkout_sessions set created_at = clock_timestamp() - interval '30 minutes' where id='${refs.session}'`);

  // 1. A pending payment: it has a schedule from the moment it is recorded.
  const snapshot = await query(`select public.record_mercadopago_payment_snapshot('${refs.intent}', jsonb_build_object(
      'provider_payment_id','990000000101','external_reference','${refs.ref}','preference_id','${PREFERENCE}','merchant_order_id','DRILL-MO',
      'collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','pending','payment_method','rapipago','live_mode',true,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount','0.00','raw_response_hash', repeat('c',64)),'drill-simulated',null) as r`);
  const watch = (await query(`select watch_state, next_check_at > clock_timestamp() as in_the_future from public.payment_provider_payments where provider_payment_id='990000000101'`))[0];
  log({ phase: 'pending-recorded-with-schedule', snapshot: snapshot[0].r, watch });
  // Time passes: the payment was first seen 3 hours ago and has not been read since.
  await query(`update public.payment_provider_payments set first_seen_at = clock_timestamp() - interval '3 hours', last_seen_at = clock_timestamp() - interval '3 hours' where provider_payment_id='990000000101'`);
  const due = (await query(`select watch_state, next_check_at < clock_timestamp() as overdue from public.payment_provider_payments where provider_payment_id='990000000101'`))[0];
  log({ phase: 'pending-payment-is-due', due });
  // The integrity check runs inside the checkout sweep every 5 minutes; the alert sweep every minute.
  let finding = null; let alert = null;
  for (let i = 0; i < 48 && !(finding && alert); i += 1) {
    await sleep(10000);
    finding = (await query(`select kind, status, severity, details->>'reason' as reason from public.payment_discrepancies
        where payment_intent_id='${refs.intent}' and kind='pending_payment_unchecked' limit 1`))[0] || null;
    alert = (await query(`select alert_code, severity, status from public.operational_alerts
        where business_id='${ids.business}' and alert_code='PAYMENT_DISCREPANCY_OPEN' and status<>'resolved' limit 1`))[0] || null;
  }
  const reads = (await query(`select count(*)::int n from public.payment_outbox where payment_intent_id='${refs.intent}' and topic='payment_reconcile'`))[0].n;
  log({ phase: 'unreadable-pending-payment-is-a-visible-finding', finding, alert, readsEnqueuedWithoutSeller: reads });
  // Neutralize it so the drill's second part is read in isolation.
  await query(`update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where payment_intent_id='${refs.intent}' and status <> 'completed'`);

  // 2. A worker that died: processing, lease expired. Nobody re-claims it first.
  await query(`insert into public.payment_outbox(payment_intent_id, topic, resource_id, status, owner, lease_expires_at, attempts)
      values ('${refs.intent}', 'payment', '990000000102', 'processing', 'drill-dead-worker', clock_timestamp() - interval '1 minute', 1)`);
  let reaped = null;
  for (let i = 0; i < 12 && !reaped; i += 1) {
    await sleep(10000);
    const row = (await query(`select status, attempts, interruptions, owner, left(last_error, 80) as last_error, next_attempt_at > clock_timestamp() as backing_off
        from public.payment_outbox where payment_intent_id='${refs.intent}' and resource_id='990000000102' limit 1`))[0];
    if (row && (row.interruptions >= 1 || row.status === 'retry_wait')) reaped = row;
  }
  log({ phase: 'dead-worker-job-was-reaped-and-backs-off', job: reaped });

  const health = (await query(`select public.payments_pipeline_health() as h`))[0].h;
  log({ phase: 'pipeline-health', outbox: health.outbox, watch: health.watch, ledger: health.ledger });

  // Close the drill.
  await query(`update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where payment_intent_id='${refs.intent}' and status <> 'completed'`);
  await query(`update public.businesses set status='paused', is_active=false, ordering_enabled=false where id='${ids.business}'`);
  log({ phase: 'drill-closed', tenant: 'paused' });
});
