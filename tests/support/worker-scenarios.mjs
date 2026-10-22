// node --experimental-vm-modules tests/support/worker-scenarios.mjs <scenario>
// Drives the REAL payment worker + adapter against REAL PostgreSQL with a SIMULATED Mercado Pago.
// Prints one JSON document. Used by tests/mercadopago-worker-recovery.test.mjs (which asserts on it).
import { createFixture, dropDatabases, query as q, REFERENCE } from './worker-fixture.mjs';

const setup = createFixture;

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
  dropDatabases();
}
