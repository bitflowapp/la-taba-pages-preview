// F11: the scheduled worker dispatch (Vault + HMAC + pg_net stand-in), the ledger-due clock, the storm guard and the
// pipeline health / alert. The signature produced by PostgreSQL is verified by the REAL worker verification code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap } from './harness.mjs';
import {
  validatePaymentWorkerSignature, PAYMENT_WORKER_SIGNATURE_MAX_AGE_SECONDS, signPaymentWorkerRequest,
} from '../../supabase/functions/_shared/payment-worker-signature.ts';

const SECRET = 'S'.repeat(48);
const URL = 'https://abcdefghij.supabase.co/functions/v1/mercadopago-payment-worker';
const VAULT = `insert into vault.secrets(name,secret) values ('taba_payment_worker_url','${URL}'),('taba_payment_worker_hmac_secret','${SECRET}');`;
const CONNECT = `insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values(v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '1 day');`;
const LAST_REQUEST = `select jsonb_build_object('url',url,'headers',headers) from net.http_request_queue order by id desc limit 1`;

test('no Vault secrets, no dispatch: it is silent, not an error', () => {
  const s = runScenario(`${CONNECT} v_extra:=to_jsonb(public.dispatch_payment_outbox_worker('cron')); v_result:=jsonb_build_object('id',v_extra,'queued',(select count(*) from net.http_request_queue));`);
  assert.equal(s.result.id, null);
  assert.equal(s.result.queued, 0);
});

test('an idle outbox with a connected seller still dispatches (the provider ledger sweep has no job)', () => {
  const s = runScenario(`${VAULT} ${CONNECT} v_extra:=to_jsonb(public.dispatch_payment_outbox_worker('cron')); v_result:=jsonb_build_object('id',v_extra is not null and v_extra<>'null'::jsonb,'queued',(select count(*) from net.http_request_queue));`);
  assert.equal(s.result.id, true);
  assert.equal(s.result.queued, 1);
});

test('nothing due and nobody connected: no dispatch at all', () => {
  const s = runScenario(`${VAULT} v_extra:=to_jsonb(public.dispatch_payment_outbox_worker('cron')); v_result:=jsonb_build_object('id',v_extra,'queued',(select count(*) from net.http_request_queue));`);
  assert.equal(s.result.id, null);
  assert.equal(s.result.queued, 0);
});

test('storm guard: repeated dispatches inside four seconds produce one request', () => {
  const s = runScenario(`${VAULT} ${CONNECT}
    insert into public.payment_outbox(payment_intent_id,topic) values (v_intent,'payment_reconcile');
    perform public.dispatch_payment_outbox_worker('cron'); perform public.dispatch_payment_outbox_worker('cron'); perform public.dispatch_payment_outbox_worker('outbox');
    v_result:=jsonb_build_object('queued',(select count(*) from net.http_request_queue),'audited',(select count(*) from private.a1_a4_payment_dispatch_audit));`);
  assert.equal(s.result.queued, 1);
  assert.equal(s.result.audited, 1);
});

test('the HMAC PostgreSQL signs is accepted by the real worker verifier; tampering, a wrong secret and replays are not', async () => {
  const s = runScenario(`${VAULT} ${CONNECT} perform public.dispatch_payment_outbox_worker('cron'); v_result:=(${LAST_REQUEST});`);
  const h = s.result.headers;
  const input = {
    secret: SECRET, timestamp: h['x-taba-worker-timestamp'], nonce: h['x-taba-worker-nonce'], signature: h['x-taba-worker-signature'],
  };
  assert.equal(s.result.url, URL);
  assert.equal(await validatePaymentWorkerSignature(input), true);
  assert.equal(await validatePaymentWorkerSignature({ ...input, secret: 'X'.repeat(48) }), false, 'wrong secret');
  assert.equal(await validatePaymentWorkerSignature({ ...input, nonce: '11111111-1111-4111-8111-111111111111' }), false, 'tampered nonce');
  assert.equal(await validatePaymentWorkerSignature({ ...input, nowSeconds: Number(input.timestamp) + PAYMENT_WORKER_SIGNATURE_MAX_AGE_SECONDS + 5 }), false, 'replay after the window');
  assert.equal(await validatePaymentWorkerSignature({ ...input, signature: await signPaymentWorkerRequest('Y'.repeat(48), input.timestamp, input.nonce) }), false, 'signed with another key');
});

test('a Vault URL that is not the canonical worker URL is refused, and a short secret too', () => {
  const bad = runScenario(`insert into vault.secrets(name,secret) values ('taba_payment_worker_url','https://evil.example/functions/v1/mercadopago-payment-worker'),('taba_payment_worker_hmac_secret','${SECRET}'); ${CONNECT}
    begin perform public.dispatch_payment_outbox_worker('cron'); v_result:=jsonb_build_object('r','sent'); exception when others then v_result:=jsonb_build_object('r',SQLSTATE); end;`);
  assert.equal(bad.result.r, '22023');
  const short = runScenario(`insert into vault.secrets(name,secret) values ('taba_payment_worker_url','${URL}'),('taba_payment_worker_hmac_secret','short'); ${CONNECT}
    begin perform public.dispatch_payment_outbox_worker('cron'); v_result:=jsonb_build_object('r','sent'); exception when others then v_result:=jsonb_build_object('r',SQLSTATE); end;`);
  assert.equal(short.result.r, '22023');
});

test('pipeline health reports backlog, stale leases, repeated failures and dead letters without business data', () => {
  const s = runScenario(`${CONNECT}
    insert into public.payment_outbox(payment_intent_id,topic,status,next_attempt_at,attempts,last_error) values
      (v_intent,'payment_reconcile','retry_wait',clock_timestamp()-interval '20 minutes',6,'provider_503');
    v_result:=public.payments_pipeline_health();`);
  assert.equal(s.result.outbox.due_jobs, 1);
  assert.ok(s.result.outbox.oldest_due_age_seconds >= 1200);
  assert.equal(s.result.outbox.repeated_failures, 1);
  assert.equal(s.result.ledger.connected_sellers, 1);
  assert.ok(!JSON.stringify(s.result).includes('collector-retry'));
});

test('a stalled pipeline raises one critical alert and clears it when the cause is gone', () => {
  const s = runScenario(`insert into public.payment_outbox(payment_intent_id,topic,status,next_attempt_at,attempts) values (v_intent,'payment_reconcile','retry_wait',clock_timestamp()-interval '20 minutes',2);
    perform public.reconcile_operational_alerts_for_business(v_business);
    v_before:=(select coalesce(jsonb_agg(alert_code||':'||status||':'||severity),'[]'::jsonb) from public.operational_alerts where business_id=v_business and alert_code='PAYMENT_PIPELINE_STALLED');
    update public.payment_outbox set status='completed',completed_at=now();
    perform public.reconcile_operational_alerts_for_business(v_business);
    v_extra:=(select coalesce(jsonb_agg(alert_code||':'||status),'[]'::jsonb) from public.operational_alerts where business_id=v_business and alert_code='PAYMENT_PIPELINE_STALLED');`);
  assert.deepEqual(s.before, ['PAYMENT_PIPELINE_STALLED:open:CRITICAL']);
  assert.deepEqual(s.extra, ['PAYMENT_PIPELINE_STALLED:resolved']);
});

test('a dead-lettered job is an alert, and a healthy idle pipeline is not', () => {
  const idle = runScenario(`perform public.reconcile_operational_alerts_for_business(v_business);
    v_result:=jsonb_build_object('n',(select count(*) from public.operational_alerts where alert_code='PAYMENT_PIPELINE_STALLED' and status<>'resolved'));`);
  assert.equal(idle.result.n, 0);
  const dead = runScenario(`insert into public.payment_outbox(payment_intent_id,topic,status,attempts) values (v_intent,'payment_reconcile','dead_letter',8);
    perform public.reconcile_operational_alerts_for_business(v_business);
    v_result:=jsonb_build_object('n',(select count(*) from public.operational_alerts where alert_code='PAYMENT_PIPELINE_STALLED' and status<>'resolved'));`);
  assert.equal(dead.result.n, 1);
});

test('a replayed snapshot job is idempotent at the storm level: the same job cannot be claimed twice', () => {
  const s = runScenario(`v_result:=${snap('approved')};
    insert into public.payment_outbox(payment_intent_id,topic) values (v_intent,'payment_reconcile');
    v_before:=(select jsonb_agg(to_jsonb(j)) from public.claim_payment_outbox_v2('worker-a',5,60) j);
    v_extra:=(select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from public.claim_payment_outbox_v2('worker-b',5,60) j);`);
  assert.equal(s.before.length, 1);
  assert.deepEqual(s.extra, [], 'a leased job is invisible to a second worker');
});
