// QA-only drill of the scheduled recovery path, with SYNTHETIC data and a SIMULATED provider fact (no Mercado Pago
// call, no money). It proves, on the hosted QA project, that the pg_cron jobs + Vault/HMAC dispatch + Edge worker
// recover interrupted work by themselves:
//   1. a payment recorded as approved but never finalized (the process "died") becomes ONE order by the cron sweep,
//      stock moving once;
//   2. a queued job whose provider lookup fails is retried with backoff (it is not lost and does not storm).
// The synthetic tenant is paused at the end. Refuses any project other than the recovery QA project.
//   node scripts/recovery/qa-drill-recovery.mjs [--cleanup-only]
import fs from 'node:fs';
import { withRecoveryProject } from './hosted-client.mjs';
import { committedFixtureSql } from '../../tests/db/harness.mjs';

const target = JSON.parse(fs.readFileSync('deploy/recovery-free-hosted.json', 'utf8'));
if (target.projectRef !== 'ixewllzzuzpqrkxzmfzx' || target.environment !== 'test') throw new Error('QA project only');
const SUFFIX = 'fb';
const ids = { business: `20000000-0000-4000-8000-0000000000${SUFFIX}`, product: `30000000-0000-4000-8000-0000000000${SUFFIX}`, user: `10000000-0000-4000-8000-0000000000${SUFFIX}` };
const fixture = committedFixtureSql(2)
  .replaceAll('0000000000fa', `0000000000${SUFFIX}`).replaceAll('forensic-fix', `drill-${SUFFIX}-qa`)
  .replaceAll('forensicfix000001', `drillcheckout${SUFFIX}01`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const started = Date.now();
const log = row => console.log(JSON.stringify({ t: Math.round((Date.now() - started) / 1000), ...row }));

await withRecoveryProject(target, async ({ query }) => {
  const exists = (await query(`select count(*)::int n from public.businesses where id = '${ids.business}'`))[0].n;
  if (process.argv.includes('--cleanup-only')) {
    await query(`update public.businesses set status='paused', is_active=false, ordering_enabled=false where id='${ids.business}'`);
    log({ phase: 'paused-synthetic-tenant' });
    return;
  }
  if (exists) throw new Error('drill tenant already exists; run --cleanup-only or choose another suffix');
  await query(fixture);
  const refs = (await query(`select cs.id as session, pi.id as intent, pi.external_reference as ref from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id where pi.business_id = '${ids.business}'`))[0];
  const before = (await query(`select stock from public.products where id='${ids.product}'`))[0].stock;
  log({ phase: 'fixture-created', stockAfterReserve: before });

  // 1. Approved fact recorded, process "dies" before finalizing; the reservation window lapses on top of it.
  const snapshot = await query(`select public.record_mercadopago_payment_snapshot('${refs.intent}', jsonb_build_object(
      'provider_payment_id','990000000001','external_reference','${refs.ref}','preference_id','FORENSIC-PREF','merchant_order_id','DRILL-MO',
      'collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount','0.00','raw_response_hash', repeat('d',64)),'drill-simulated',null) as r`);
  log({ phase: 'approved-recorded-not-finalized', snapshot: snapshot[0].r });
  await query(`update public.checkout_sessions set expires_at = clock_timestamp() - interval '1 second', created_at = clock_timestamp() - interval '2 hours' where id='${refs.session}'`);
  let order = null;
  for (let i = 0; i < 24 && !order; i += 1) {
    await sleep(10000);
    order = (await query(`select o.id, o.status from public.orders o join public.payment_intents pi on pi.order_id = o.id where pi.id='${refs.intent}'`))[0] || null;
  }
  const after = (await query(`select
      (select stock from public.products where id='${ids.product}') stock,
      (select count(*) from public.orders where business_id='${ids.business}')::int orders,
      (select coalesce(jsonb_agg(jsonb_build_object('status',status,'qty',quantity)),'[]') from public.inventory_reservations where checkout_session_id='${refs.session}') reservations`))[0];
  log({ phase: 'cron-recovered-the-order', recovered: Boolean(order), ...after });

  // 2. A job whose provider lookup cannot succeed (no seller connection in QA): retried with backoff, never lost.
  await query(`insert into public.payment_outbox(payment_intent_id, topic) values ('${refs.intent}', 'payment_reconcile')`);
  await sleep(100000);
  const job = (await query(`select status, attempts, next_attempt_at > clock_timestamp() as backing_off, left(last_error, 80) as last_error
      from public.payment_outbox where payment_intent_id='${refs.intent}' order by created_at desc limit 1`))[0];
  const health = (await query(`select public.payments_pipeline_health() as h`))[0].h;
  const runs = await query(`select j.jobname, count(*) filter (where d.status='succeeded')::int ok, count(*) filter (where d.status='failed')::int failed
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid where d.start_time > now() - interval '20 minutes' group by 1 order by 1`);
  log({ phase: 'failed-job-retried-with-backoff', job, outbox: health.outbox, cronRuns: runs });

  // Close the drill: the job is neutralized, the synthetic tenant is paused.
  await query(`update public.payment_outbox set status = 'completed', completed_at = clock_timestamp() where payment_intent_id='${refs.intent}' and status <> 'completed'`);
  await query(`update public.businesses set status='paused', is_active=false, ordering_enabled=false where id='${ids.business}'`);
  log({ phase: 'drill-closed', tenant: 'paused' });
});
