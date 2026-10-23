// QA-only drill of the scheduled recovery path, with SYNTHETIC data and a SIMULATED provider fact (no Mercado Pago
// call, no money). It proves, on the hosted QA project, that the pg_cron jobs + Vault/HMAC dispatch + Edge worker
// recover interrupted work by themselves:
//   1. a payment recorded as approved but never finalized (the process "died") becomes ONE order by the cron sweep,
//      stock moving once;
//   2. a queued job whose provider lookup fails is retried with backoff (it is not lost and does not storm).
// Each run owns its synthetic tenant and removes it in finally; a saved receipt permits cleanup after interruption.
//   node scripts/recovery/qa-drill-recovery.mjs --run-file <outside-repo.json> [--local] [--cleanup-only]
import assert from 'node:assert/strict';
import { runDrill } from './qa-drill-runtime.mjs';
const started = Date.now();
const log = row => console.log(JSON.stringify({ t: Math.round((Date.now() - started) / 1000), ...row }));

await runDrill('recovery', async ({ query, run, sleep, tick, local }) => {
  const ids=run.ids;
  const refs = (await query(`select cs.id as session, pi.id as intent, pi.external_reference as ref from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id where pi.business_id = '${ids.business}'`))[0];
  const before = (await query(`select stock from public.products where id='${ids.product}'`))[0].stock;
  log({ phase: 'fixture-created', stockAfterReserve: before });

  // 1. Approved fact recorded, process "dies" before finalizing; the reservation window lapses on top of it.
  const snapshot = await query(`select public.record_mercadopago_payment_snapshot('${refs.intent}', jsonb_build_object(
      'provider_payment_id','${run.payment}','external_reference','${refs.ref}','preference_id','${run.preference}','merchant_order_id','DRILL-MO',
      'collector_id','${run.collector}','currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount','0.00','raw_response_hash', repeat('d',64)),'drill-simulated',null) as r`);
  log({ phase: 'approved-recorded-not-finalized', snapshot: snapshot[0].r });
  await query(`update public.checkout_sessions set expires_at = clock_timestamp() - interval '1 second', created_at = clock_timestamp() - interval '2 hours' where id='${refs.session}'`);
  if(local) {
    log({phase:'waiting-for-real-45-second-recovery-threshold'});
    await new Promise(resolve=>setTimeout(resolve,46000));
  }
  let order = null;
  for (let i = 0; i < 48 && !order; i += 1) {
    await tick(`select public.retry_stuck_paid_checkouts(50);`);
    await sleep(10000);
    order = (await query(`select o.id, o.status from public.orders o join public.payment_intents pi on pi.order_id = o.id where pi.id='${refs.intent}'`))[0] || null;
  }
  const after = (await query(`select
      (select stock from public.products where id='${ids.product}') stock,
      (select count(*) from public.orders where business_id='${ids.business}')::int orders,
      (select coalesce(jsonb_agg(jsonb_build_object('status',status,'qty',quantity)),'[]') from public.inventory_reservations where checkout_session_id='${refs.session}') reservations`))[0];
  log({ phase: 'cron-recovered-the-order', recovered: Boolean(order), ...after });
  assert.ok(order,'approved checkout must recover');
  assert.equal(after.orders,1,'exactly one order');
  assert.equal(after.stock,before,'stock must move only once');
  assert.deepEqual(after.reservations,[{status:'converted',qty:2}]);

  // 2. A job whose provider lookup cannot succeed (no seller connection in QA): retried with backoff, never lost.
  const queued=(await query(`insert into public.payment_outbox(payment_intent_id, topic) values ('${refs.intent}', 'payment_reconcile') returning id`))[0];
  // Isolated mode models a worker cut, without making a provider request.
  if(local) await query(`update public.payment_outbox set status='processing',owner='drill-dead-worker',attempts=1,lease_expires_at=clock_timestamp()-interval '1 minute' where id='${queued.id}'`);
  await tick(`select public.claim_payment_outbox_v2('drill-reaper',1,60);`);
  let job;
  for(let i=0;i<18;i+=1) {
    await sleep(10000);
    job = (await query(`select status, attempts, next_attempt_at > clock_timestamp() as backing_off, left(last_error, 80) as last_error
      from public.payment_outbox where id='${queued.id}'`))[0];
    if(job?.status==='retry_wait'&&job.backing_off) break;
  }
  const health = (await query(`select public.payments_pipeline_health() as h`))[0].h;
  const runs = await query(`select j.jobname, count(*) filter (where d.status='succeeded')::int ok, count(*) filter (where d.status='failed')::int failed
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid where d.start_time > now() - interval '20 minutes' group by 1 order by 1`);
  log({ phase: 'failed-job-retried-with-backoff', job, outbox: health.outbox, cronRuns: runs });
  assert.equal(job?.status,'retry_wait');
  assert.ok(job.attempts>=1);
  assert.equal(job.backing_off,true);

  // runDrill cleans the entire owned fixture in finally; receipt survives a hard kill.
});
