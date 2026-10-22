// node --experimental-vm-modules tests/support/worker-scenarios.mjs <scenario>
// Drives the REAL payment worker + adapter against REAL PostgreSQL with a SIMULATED Mercado Pago.
// Prints one JSON document. Used by tests/mercadopago-worker-recovery.test.mjs (which asserts on it).
import { psqlRaw } from '../../scripts/local-db/lib.mjs';
import { committedFixtureSql, FIXTURE_IDS } from '../db/harness.mjs';
import { createPgServiceClient } from './pg-service-client.mjs';
import { ProviderSim } from './provider-sim.mjs';
import { loadWorker } from './worker-sandbox.mjs';

const TEMPLATE = process.env.TABA_LOCAL_DB || 'taba_local_work';
const REFERENCE = id => `taba2:checkout:${id}`;

const created = [];
function newDatabase(label) {
  const db = `taba_local_it_${label}_${process.pid}`.toLowerCase();
  created.push(db);
  psqlRaw('postgres', `drop database if exists ${db} with (force); create database ${db} template ${TEMPLATE};`);
  return db;
}
const q = (db, sql) => {
  const r = psqlRaw(db, sql, { tuples: true });
  const line = r.stdout.split('\n').map(s => s.trim()).filter(Boolean).pop();
  return line ? JSON.parse(line) : null;
};

async function setup(label, { quantity = 2, connect = false } = {}) {
  const db = newDatabase(label);
  psqlRaw(db, committedFixtureSql(quantity));
  const ids = q(db, `select jsonb_build_object('session',cs.id,'intent',pi.id,'reference',pi.external_reference) from public.payment_intents pi join public.checkout_sessions cs on cs.id=pi.checkout_session_id where pi.business_id='${FIXTURE_IDS.business}'`);
  if (connect) {
    psqlRaw(db, `insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values('${FIXTURE_IDS.business}','test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '30 days');`);
  }
  const service = createPgServiceClient(db);
  const provider = new ProviderSim();
  const worker = await loadWorker({ service, provider, businessId: FIXTURE_IDS.business });
  const sql = text => psqlRaw(db, text);
  const has = table => q(db, `select to_jsonb(to_regclass('public.${table}') is not null)`) === true;
  const hasPayments = has('payment_provider_payments');
  const hasDisc = has('payment_discrepancies');
  const hasCursor = has('provider_ledger_cursors');
  const state = () => q(db, `select jsonb_build_object(
    'orders',(select count(*) from public.orders where business_id='${FIXTURE_IDS.business}'),
    'stock',(select stock from public.products where id='${FIXTURE_IDS.product}'),
    'intent',(select jsonb_build_object('status',internal_status,'provider_id',provider_payment_id,'provider_status',provider_status,'review',security_review_reason,'refunded',refunded_amount) from public.payment_intents where id='${ids.intent}'),
    'payments',${hasPayments ? `(select coalesce(jsonb_agg(jsonb_build_object('id',provider_payment_id,'status',status,'financing',is_financing) order by provider_payment_id),'[]') from public.payment_provider_payments where payment_intent_id='${ids.intent}')` : 'null'},
    'discrepancies',${hasDisc ? `(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'status',status,'severity',severity,'occ',occurrences) order by kind,provider_payment_id),'[]') from public.payment_discrepancies where business_id='${FIXTURE_IDS.business}')` : 'null'},
    'jobs',(select coalesce(jsonb_agg(jsonb_build_object('topic',topic,'status',status,'attempts',attempts,'error',last_error) order by created_at),'[]') from public.payment_outbox),
    'reservations',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'qty',quantity)),'[]') from public.inventory_reservations where checkout_session_id='${ids.session}'),
    'cursor',${hasCursor ? `(select to_jsonb(c) from public.provider_ledger_cursors c where business_id='${FIXTURE_IDS.business}')` : 'null'})`);
  const enqueueReconcile = () => sql(`insert into public.payment_outbox(payment_intent_id,topic) values('${ids.intent}','payment_reconcile');`);
  const dueNow = () => sql(`update public.payment_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where status in ('retry_wait','pending');`);
  const snapshot = (payment, source = 'webhook') => q(db, `select to_jsonb(public.record_mercadopago_payment_snapshot('${ids.intent}','${JSON.stringify({
    provider_payment_id: String(payment.id), external_reference: payment.external_reference, preference_id: 'FORENSIC-PREF', merchant_order_id: payment.order.id,
    collector_id: payment.collector_id, currency: 'ARS', transaction_amount: Number(payment.transaction_amount).toFixed(2), status: payment.status,
    payment_method: 'visa', live_mode: true, provider_occurred_at: payment.date_last_updated, refunded_amount: '0.00', raw_response_hash: 'a'.repeat(64),
  })}'::jsonb,'${source}',null))`);
  return { db, ids, provider, worker, sql, state, enqueueReconcile, dueNow, snapshot, service };
}

const scenarios = {
  // F06: the rejected attempt is already pinned; the approved retry has no webhook and the buyer never came back.
  async f06_rejected_pinned_then_approved_retry() {
    const t = await setup('f06');
    const rejected = t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'rejected' });
    t.snapshot(rejected);
    t.provider.addPayment({ id: 991000002, reference: t.ids.reference, status: 'approved' });
    t.enqueueReconcile();
    const run = await t.worker.invoke();
    return { run, state: t.state(), calls: t.provider.calls.map(c => c.path) };
  },
  // F07: the merchant-order lookup answers 503. The job retries; nothing is sent to review; the next read finalizes.
  async f07_merchant_order_503_then_ok() {
    const t = await setup('f07');
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.provider.failNext(/\/merchant_orders\//, 503, 1);
    t.enqueueReconcile();
    const first = await t.worker.invoke();
    const afterFirst = t.state();
    t.dueNow();
    const second = await t.worker.invoke();
    return { first, afterFirst, second, state: t.state() };
  },
  // F08: the approved payment sits on the second page of the reference search.
  async f08_approved_on_second_page() {
    const t = await setup('f08page');
    for (let i = 0; i < 60; i += 1) t.provider.addPayment({ id: 880000000 + i, reference: t.ids.reference, status: 'rejected' });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.enqueueReconcile();
    const run = await t.worker.invoke();
    return { run, state: t.state(), searches: t.provider.calls.filter(c => c.path.startsWith('/v1/payments/search')).map(c => c.path) };
  },
  // F04/F06: two approved payments for the same checkout are both recorded; one order; a critical discrepancy.
  async two_approved_payments() {
    const t = await setup('twoapproved');
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.provider.addPayment({ id: 991000002, reference: t.ids.reference, status: 'approved' });
    t.enqueueReconcile();
    const run = await t.worker.invoke();
    return { run, state: t.state() };
  },
  // F09: a refund whose id never arrived is parked, not retried to death, and nothing is POSTed.
  async f09_unknown_refund_identity() {
    const t = await setup('f09');
    const pay = t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.snapshot(pay);
    t.sql(`select public.finalize_paid_checkout_session('${t.ids.session}');`);
    t.sql(`insert into public.payment_refunds(payment_intent_id,amount,status,reason) values('${t.ids.intent}',2500,'ambiguous','lost response');
      insert into public.payment_outbox(payment_intent_id,refund_id,topic) select '${t.ids.intent}',id,'refund_reconcile' from public.payment_refunds where payment_intent_id='${t.ids.intent}';`);
    t.provider.addRefundTo(991000001, { id: 881000009, amount: 2500, payment_id: 991000001 });
    const run = await t.worker.invoke();
    const hold = q(t.db, `select to_jsonb(private.payment_financial_hold('${t.ids.intent}'))`);
    const refund = q(t.db, `select to_jsonb(r) - 'raw_response_hash' from public.payment_refunds r where payment_intent_id='${t.ids.intent}'`);
    return { run, state: t.state(), hold, refund, posts: t.provider.calls.filter(c => c.method === 'POST') };
  },
  // F08: no webhook, no job, no browser. The ledger sweep finds the approved payment and an orphan.
  async f08_ledger_sweep_without_webhook() {
    const t = await setup('f08ledger', { connect: true });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.provider.addPayment({ id: 771000001, reference: REFERENCE('00000000-0000-4000-8000-0000000000aa'), status: 'approved' });
    t.provider.addPayment({ id: 661000001, reference: 'someone-elses-order', status: 'approved' });
    const first = await t.worker.invoke();
    const afterFirst = t.state();
    const second = await t.worker.invoke();
    return { first, second, afterFirst, state: t.state(), outsideCalls: t.provider.calls.filter(c => c.path.includes('661000001')) };
  },
  // Crash between recording the payment and finalizing: the next run completes it exactly once.
  async crash_before_finalize_then_retry() {
    const t = await setup('crash');
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.enqueueReconcile();
    let crashed = false;
    const inner = t.service.rpc.bind(t.service);
    t.service.rpc = async (name, args) => {
      if (name === 'finalize_paid_checkout_session' && !crashed) { crashed = true; return { data: null, error: { code: '08006', message: 'connection lost' } }; }
      return inner(name, args);
    };
    const first = await t.worker.invoke();
    const afterFirst = t.state();
    t.dueNow();
    const second = await t.worker.invoke();
    return { first, afterFirst, second, state: t.state() };
  },
  // The provider is down for the whole ledger window: the cursor does not move and failures back off.
  async ledger_provider_down() {
    const t = await setup('ledgerdown', { connect: true });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.provider.failNext(/\/v1\/payments\/search/, 503, 100);
    const first = await t.worker.invoke();
    const second = await t.worker.invoke();
    return { first, second, state: t.state(), searches: t.provider.calls.filter(c => c.path.startsWith('/v1/payments/search')).length };
  },
  // Duplicates and a storm: the same job replayed many times never double-books and never floods the provider.
  async replay_storm_is_idempotent() {
    const t = await setup('storm');
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    const results = [];
    for (let i = 0; i < 5; i += 1) { t.enqueueReconcile(); results.push((await t.worker.invoke()).body.completed); }
    return { results, state: t.state(), providerCalls: t.provider.calls.length };
  },
};

const name = process.argv[2];
if (!scenarios[name]) { console.error('unknown scenario ' + name); process.exit(2); }
try {
  const out = await scenarios[name]();
  console.log('RESULT_JSON ' + JSON.stringify(out));
} finally {
  for (const db of created) psqlRaw('postgres', `drop database if exists ${db} with (force);`, { check: false });
}
