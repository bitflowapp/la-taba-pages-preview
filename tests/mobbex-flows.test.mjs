// Orchestration tests: checkout creation, webhook, reconciliation, worker, refund, availability.
// The ledger and Mobbex are SIMULATED (in-memory). What proves the financial state machine is the SQL contract
// (supabase/tests/mobbex_ledger.local.sql, run by scripts/mobbex/run-mobbex-db-tests.mjs); what these tests prove is
// that the Edge layer asks the right questions, trusts only confirmed reads and never lets a forged input reach the money.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { MobbexApiError } from '../supabase/functions/_shared/mobbex/client.ts';
import { resolveMobbexConfig } from '../supabase/functions/_shared/mobbex/config.ts';
import { LedgerError, createMobbexCheckout, handleMobbexWebhook, reconcileMobbexPayment, runMobbexWorker } from '../supabase/functions/_shared/mobbex/handlers.ts';
import { MOBBEX_REFUND_CONFIRMATION, mobbexAvailability, mobbexCheckoutStatus, refundMobbexPayment } from '../supabase/functions/_shared/mobbex/customer-handlers.ts';
import { mobbexWebhookToken } from '../supabase/functions/_shared/mobbex/webhook.ts';
import { PaymentProviderRegistry, UnsupportedProviderOperation, mercadoPagoProviderDescriptor } from '../supabase/functions/_shared/payment-provider.ts';
import { MobbexCheckoutProvider } from '../supabase/functions/_shared/mobbex/provider.ts';

const SECRET = 's'.repeat(40);
const USER = '10000000-0000-4000-8000-000000000001';
const BUSINESS = '20000000-0000-4000-8000-000000000001';
const SESSION = '30000000-0000-4000-8000-000000000001';
const INTENT = '40000000-0000-4000-8000-000000000001';
const REFERENCE = `taba2-mbx-${SESSION}`;
const sha256Hex = async (text) => createHash('sha256').update(text).digest('hex');
const envValues = { MOBBEX_ENABLED: 'true', MOBBEX_ENVIRONMENT: 'test', MOBBEX_API_KEY: 'KEY', MOBBEX_ACCESS_TOKEN: 'TOKEN', MOBBEX_WEBHOOK_TOKEN_SECRET: SECRET };
const config = () => resolveMobbexConfig((name) => envValues[name]);
const disabled = () => resolveMobbexConfig(() => undefined);

/** A ledger double that records every call and answers like the SQL functions do for the documented cases. */
function fakeLedger(overrides = {}) {
  const calls = [];
  const note = (name, args) => calls.push({ name, args });
  const ledger = {
    calls,
    availability: async (id) => { note('availability', [id]); return { available: true, environment: 'test' }; },
    createSession: async (user, payload) => { note('createSession', [user, payload]); return { checkout_session_id: SESSION, total: 2500 }; },
    prepareCheckout: async (session, user) => {
      note('prepareCheckout', [session, user]);
      return { claimed: true, intent_id: INTENT, reference: REFERENCE, environment: 'test', expected_amount: '2500.00', checkout_session_id: SESSION,
        expires_at: new Date(Date.now() + 14 * 60_000).toISOString(), items: [{ name: 'Cola 1 l', quantity: 2, subtotal: '2500.00' }] };
    },
    recordCheckoutCreated: async (...args) => note('recordCheckoutCreated', args),
    recordCheckoutFailed: async (...args) => note('recordCheckoutFailed', args),
    recordCheckoutUncertain: async (...args) => note('recordCheckoutUncertain', args),
    recordWebhookReceipt: async (input) => { note('recordWebhookReceipt', [input]); return { intent_id: INTENT, duplicate: false }; },
    recordSnapshot: async (intent, snapshot, source) => { note('recordSnapshot', [intent, snapshot, source]); return { ok: true, internal_status: 'completed' }; },
    recordNoOperation: async (...args) => { note('recordNoOperation', args); return { closed: false, retry_after_seconds: 30 }; },
    claimJobs: async () => [],
    finishJob: async (...args) => { note('finishJob', args); return args[2] === 'done' ? 'completed' : 'retry_wait'; },
    sweep: async () => ({ enqueued: 0 }),
    ...overrides,
  };
  return ledger;
}

const approvedBody = (extra = {}) => ({ result: true, data: { transaction: { payment: { id: 'OP-1', reference: REFERENCE, total: 2500, status: { code: '200' }, currency: { code: 'ARS' } } }, transactions: [{ uid: 'T', status: '200' }], ...extra } });
function fakeOperations(overrides = {}) {
  const calls = [];
  return {
    calls,
    createCheckout: async (input) => { calls.push({ name: 'createCheckout', input }); return { checkoutId: 'CHK:1', url: 'https://mobbex.com/p/checkout/v2/CHK:1', responseHash: 'a'.repeat(64) }; },
    getOperationByReference: async (reference) => { calls.push({ name: 'getOperation', reference }); return { found: true, body: approvedBody(), responseHash: 'b'.repeat(64) }; },
    ...overrides,
  };
}
const createDeps = (ledger, operations, resolveConfig = config) => ({
  ledger, resolveConfig, operations: () => operations, supabaseUrl: 'https://abc.supabase.co', returnUrl: 'https://taba.example/pago/resultado', now: Date.now,
});
const request = (payload = {}) => ({ userId: USER, userEmail: 'cliente@example.com', payload: { business_id: BUSINESS, client_request_id: 'req-12345678', items: [{ product_id: '50000000-0000-4000-8000-000000000001', quantity: 2 }], fulfillment_type: 'pickup', contact: { name: 'Ana Cliente', phone: '5491100000000' }, ...payload } });

// ── checkout creation ───────────────────────────────────────────────────────────────────────────────────────

test('checkout: the amount sent to Mobbex is the database total; a total sent by the browser changes nothing', async () => {
  const ledger = fakeLedger();
  const operations = fakeOperations();
  const forged = request({ total: 1, amount: 1, subtotal: 1, items: [{ product_id: '50000000-0000-4000-8000-000000000001', quantity: 2, unit_price: 0.01 }] });
  const result = await createMobbexCheckout(createDeps(ledger, operations), forged);
  assert.equal(result.status, 200);
  assert.equal(result.body.redirect_url, 'https://mobbex.com/p/checkout/v2/CHK:1');
  const sent = operations.calls.find((c) => c.name === 'createCheckout').input;
  assert.equal(sent.totalCents, 250000, 'the 2500.00 the database stored, never the 1 the browser claimed');
  assert.equal(sent.reference, REFERENCE);
  assert.equal(sent.test, true);
  assert.ok(sent.timeoutMinutes >= 5 && sent.timeoutMinutes <= 15, 'the hosted checkout never outlives the stock reservation');
  assert.match(sent.webhookUrl, /^https:\/\/abc\.supabase\.co\/functions\/v1\/mobbex-webhook\?ref=taba2-mbx-/);
  assert.equal(ledger.calls.find((c) => c.name === 'createSession').args[1].payment_method, 'mobbex', 'the provider is decided by the server, whatever the browser says');
  assert.ok(ledger.calls.some((c) => c.name === 'recordCheckoutCreated'));
});

test('checkout: disabled deployment, disabled business or environment mismatch refuse BEFORE any stock is reserved', async () => {
  for (const [label, ledger, resolve] of [
    ['switched off', fakeLedger(), disabled],
    ['business disabled', fakeLedger({ availability: async () => ({ available: false }) }), config],
    ['environment mismatch', fakeLedger({ availability: async () => ({ available: true, environment: 'production' }) }), config],
    ['availability lookup throws', fakeLedger({ availability: async () => { throw new LedgerError('db down'); } }), config],
  ]) {
    const result = await createMobbexCheckout(createDeps(ledger, fakeOperations(), resolve), request());
    assert.equal(result.status, 409, label);
    assert.equal(result.body.code, 'PAYMENTS_NOT_ENABLED', label);
    assert.equal(ledger.calls.some((c) => c.name === 'createSession'), false, `${label}: no session, so no stock taken`);
  }
});

test('checkout: database refusals surface a safe code, never SQL text', async () => {
  const cases = [['BUSINESS_CLOSED', 'BUSINESS_CLOSED'], ['OUT_OF_DELIVERY_ZONE', 'OUT_OF_DELIVERY_ZONE'], ['stock insuficiente para producto: x', 'OUT_OF_STOCK'],
    ['MOBBEX_LIVE_NOT_AUTHORIZED', 'PAYMENTS_NOT_ENABLED'], ['relation "secret_table" does not exist', 'CHECKOUT_NOT_AVAILABLE']];
  for (const [sql, code] of cases) {
    const ledger = fakeLedger({ createSession: async () => { throw new LedgerError(sql); } });
    const result = await createMobbexCheckout(createDeps(ledger, fakeOperations()), request());
    assert.equal(result.body.code, code, sql);
    assert.equal(JSON.stringify(result.body).includes('secret_table'), false);
  }
});

test('checkout: a lost response is UNCERTAIN (202), a provable refusal is final (409), a retry is reusable', async () => {
  const network = fakeLedger();
  const lost = await createMobbexCheckout(createDeps(network, fakeOperations({ createCheckout: async () => { throw new MobbexApiError('network', 0, 'x'); } })), request());
  assert.equal(lost.status, 202);
  assert.equal(lost.body.status, 'reconciling');
  assert.ok(network.calls.some((c) => c.name === 'recordCheckoutUncertain'));
  assert.equal(network.calls.some((c) => c.name === 'recordCheckoutFailed'), false, 'never recorded as failed: it may exist');
  const refused = fakeLedger();
  const rejected = await createMobbexCheckout(createDeps(refused, fakeOperations({ createCheckout: async () => { throw new MobbexApiError('rejected', 400, 'x'); } })), request());
  assert.equal(rejected.status, 409);
  assert.ok(refused.calls.some((c) => c.name === 'recordCheckoutFailed'));
  const reuse = fakeLedger({ prepareCheckout: async () => ({ claimed: false, reuse: true, checkout_url: 'https://mobbex.com/p/checkout/v2/OLD', checkout_session_id: SESSION }) });
  const operations = fakeOperations();
  const again = await createMobbexCheckout(createDeps(reuse, operations), request({ checkout_session_id: SESSION }));
  assert.equal(again.body.redirect_url, 'https://mobbex.com/p/checkout/v2/OLD');
  assert.equal(operations.calls.length, 0, 'reopening a payment never creates a second hosted checkout');
  const inFlight = fakeLedger({ prepareCheckout: async () => ({ claimed: false, in_flight: true, checkout_session_id: SESSION }) });
  const wait = await createMobbexCheckout(createDeps(inFlight, fakeOperations()), request({ checkout_session_id: SESSION }));
  assert.equal(wait.status, 202, 'a concurrent request does not dispatch a second POST');
});

// ── webhook ─────────────────────────────────────────────────────────────────────────────────────────────────

const webhookInput = async ({ token, reference = REFERENCE, body, https = true } = {}) => ({
  url: new URL(`https://abc.supabase.co/functions/v1/mobbex-webhook?ref=${reference}&t=${token ?? await mobbexWebhookToken(SECRET, 'test', reference)}`),
  rawBody: body ?? JSON.stringify({ type: 'checkout', data: { payment: { id: 'OP-1', reference, status: { code: '200' } } } }), https,
});
const webhookDeps = (ledger, operations, inlineBudgetMs = 200) => ({ ledger, operations, resolveConfig: config, sha256Hex, inlineBudgetMs });

test('webhook: a request without the capability token writes NOTHING and answers 401', async () => {
  for (const input of [
    await webhookInput({ token: 'A'.repeat(43) }),
    await webhookInput({ token: 'short' }),
    await webhookInput({ body: 'not json' }),
    await webhookInput({ body: JSON.stringify({ data: { payment: { reference: 'taba2-mbx-other', status: { code: '200' } } } }) }),
    { ...(await webhookInput()), url: new URL('https://abc.supabase.co/functions/v1/mobbex-webhook') },
  ]) {
    const ledger = fakeLedger();
    const operations = fakeOperations();
    const result = await handleMobbexWebhook(webhookDeps(ledger, operations), input);
    assert.equal(result.status, 401);
    assert.equal(ledger.calls.length, 0, 'forged traffic never reaches the database');
    assert.equal(operations.calls.length, 0, 'nor the provider');
  }
  const insecure = await handleMobbexWebhook(webhookDeps(fakeLedger(), fakeOperations()), await webhookInput({ https: false }));
  assert.equal(insecure.status, 400);
  const huge = await handleMobbexWebhook(webhookDeps(fakeLedger(), fakeOperations()), await webhookInput({ body: JSON.stringify({ pad: 'x'.repeat(70_000) }) }));
  assert.equal(huge.status, 413);
});

test('webhook: the body is a hint; the state comes from the provider read, even when the body lies', async () => {
  const ledger = fakeLedger();
  // The forged body says "approved"; Mobbex says the operation is still pending.
  const operations = fakeOperations({ getOperationByReference: async () => ({ found: true, body: { result: true, data: { transaction: { payment: { id: 'OP-1', reference: REFERENCE, total: 2500, status: { code: '2' } } } } }, responseHash: 'c'.repeat(64) }) });
  const result = await handleMobbexWebhook(webhookDeps(ledger, operations), await webhookInput());
  assert.equal(result.status, 200);
  const snapshot = ledger.calls.find((c) => c.name === 'recordSnapshot').args[1];
  assert.equal(snapshot.status_class, 'pending', 'what the provider answered, not what the webhook claimed');
  assert.equal(snapshot.provider_payment_id, 'OP-1');
});

test('webhook: unknown reference and duplicate are acknowledged without work; provider down never loses the notice', async () => {
  const unknown = fakeLedger({ recordWebhookReceipt: async () => ({ unknown_reference: true }) });
  const operations = fakeOperations();
  assert.deepEqual((await handleMobbexWebhook(webhookDeps(unknown, operations), await webhookInput())).body, { ok: true, ignored: 'unknown_reference' });
  assert.equal(operations.calls.length, 0);
  const duplicate = fakeLedger({ recordWebhookReceipt: async () => ({ intent_id: INTENT, duplicate: true }) });
  const dup = await handleMobbexWebhook(webhookDeps(duplicate, fakeOperations()), await webhookInput());
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicate, true);
  const down = fakeLedger();
  const slow = fakeOperations({ getOperationByReference: async () => { throw new MobbexApiError('server', 503, 'x'); } });
  const survived = await handleMobbexWebhook(webhookDeps(down, slow), await webhookInput());
  assert.equal(survived.status, 200, 'the receipt and its job already exist: the worker will confirm later');
  assert.equal(survived.body.confirmed, false);
  assert.equal(down.calls.some((c) => c.name === 'recordSnapshot'), false, 'no confirmation, no state change');
  const hanging = fakeOperations({ getOperationByReference: () => new Promise(() => {}) });
  assert.equal((await handleMobbexWebhook(webhookDeps(fakeLedger(), hanging, 50), await webhookInput())).status, 200, 'a slow provider cannot hold the webhook past its budget');
  const off = await handleMobbexWebhook({ ...webhookDeps(fakeLedger(), fakeOperations()), resolveConfig: disabled }, await webhookInput());
  assert.deepEqual(off.body, { ok: true, ignored: 'disabled' });
});

// ── reconciliation ──────────────────────────────────────────────────────────────────────────────────────────

test('reconcile: "no operation" asks to look again; a closed intent is done; a bad shape or provider error is a failure to retry', async () => {
  const ledger = fakeLedger();
  const none = fakeOperations({ getOperationByReference: async () => ({ found: false, code: 'GENERIC:EFCS', responseHash: 'd'.repeat(64) }) });
  assert.deepEqual(await reconcileMobbexPayment({ ledger, operations: none }, { intentId: INTENT, reference: REFERENCE }, 'reconciliation'), { outcome: 'again', delaySeconds: 30 });
  const closed = fakeLedger({ recordNoOperation: async () => ({ closed: true, retry_after_seconds: 0 }) });
  assert.equal((await reconcileMobbexPayment({ ledger: closed, operations: none }, { intentId: INTENT, reference: REFERENCE }, 'reconciliation')).outcome, 'done');
  const weird = fakeOperations({ getOperationByReference: async () => ({ found: true, body: { result: true, data: { surprise: 1 } }, responseHash: 'e'.repeat(64) }) });
  const shape = await reconcileMobbexPayment({ ledger, operations: weird }, { intentId: INTENT, reference: REFERENCE }, 'reconciliation');
  assert.deepEqual(shape, { outcome: 'failed', error: 'shape_unrecognized' });
  assert.equal(ledger.calls.some((c) => c.name === 'recordSnapshot'), false, 'an unreadable answer records no financial fact');
  const auth = fakeOperations({ getOperationByReference: async () => { throw new MobbexApiError('auth', 401, 'x'); } });
  assert.deepEqual(await reconcileMobbexPayment({ ledger, operations: auth }, { intentId: INTENT, reference: REFERENCE }, 'reconciliation'), { outcome: 'failed', error: 'auth:401' });
});

test('reconcile: pending/rejected payments are looked at again; completed, refunded and reviews are done', async () => {
  const outcomeFor = async (result) => reconcileMobbexPayment({ ledger: fakeLedger({ recordSnapshot: async () => result }), operations: fakeOperations() }, { intentId: INTENT, reference: REFERENCE }, 'reconciliation');
  assert.equal((await outcomeFor({ ok: true, internal_status: 'completed' })).outcome, 'done');
  assert.equal((await outcomeFor({ ok: true, internal_status: 'refunded' })).outcome, 'done');
  assert.equal((await outcomeFor({ ok: true, manual_review_required: true, internal_status: 'security_review_required' })).outcome, 'done');
  assert.equal((await outcomeFor({ ok: true, internal_status: 'pending' })).outcome, 'again');
  assert.equal((await outcomeFor({ ok: true, internal_status: 'rejected' })).outcome, 'again');
  assert.deepEqual(await outcomeFor({ ok: true, internal_status: 'approved_order_pending' }), { outcome: 'again', delaySeconds: 20, internalStatus: 'approved_order_pending' });
});

test('reconcile: two reconciliations racing for the same payment hand the ledger the same facts (the ledger serializes them)', async () => {
  const seen = [];
  const ledger = fakeLedger({ recordSnapshot: async (intent, snapshot) => { seen.push(snapshot); return { ok: true, internal_status: 'completed' }; } });
  const deps = { ledger, operations: fakeOperations() };
  const [a, b] = await Promise.all([
    reconcileMobbexPayment(deps, { intentId: INTENT, reference: REFERENCE }, 'webhook'),
    reconcileMobbexPayment(deps, { intentId: INTENT, reference: REFERENCE }, 'reconciliation'),
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(seen[0], seen[1], 'identical provider reads produce identical snapshots, so the SQL idempotency applies');
});

// ── worker ──────────────────────────────────────────────────────────────────────────────────────────────────

test('worker: sweeps, claims, reconciles and finishes each job with the right outcome; failures never escape', async () => {
  const jobs = [
    { job_id: 'j1', payment_intent_id: INTENT, reference: REFERENCE, environment: 'test', reason: 'webhook', failures: 0 },
    { job_id: 'j2', payment_intent_id: INTENT, reference: REFERENCE, environment: 'test', reason: 'sweep', failures: 2 },
    { job_id: 'j3', payment_intent_id: INTENT, reference: REFERENCE, environment: 'test', reason: 'sweep', failures: 0 },
  ];
  let claimed = false;
  const ledger = fakeLedger({
    claimJobs: async () => { if (claimed) return []; claimed = true; return jobs; },
    recordSnapshot: async (intent) => { if (calls++ === 1) throw new LedgerError('deadlock detected'); return { ok: true, internal_status: 'completed' }; },
  });
  let calls = 0;
  const finished = [];
  ledger.finishJob = async (id, owner, outcome, delay, error) => { finished.push({ id, outcome, delay, error }); return outcome === 'done' ? 'completed' : 'retry_wait'; };
  const result = await runMobbexWorker({ ledger, operations: fakeOperations(), now: Date.now }, { owner: 'w1', budgetMs: 5000 });
  assert.equal(result.claimed, 3);
  assert.deepEqual(finished.map((f) => f.outcome), ['done', 'failed', 'done']);
  assert.equal(finished[1].error, 'ledger_error', 'a database error becomes a retry with backoff, not a crashed worker');
});

test('worker: stops at its time budget and reports lost leases and dead letters', async () => {
  let clock = 0;
  const ledger = fakeLedger({
    claimJobs: async () => [{ job_id: 'j', payment_intent_id: INTENT, reference: REFERENCE, environment: 'test', reason: 'sweep', failures: 11 }],
    finishJob: async () => 'dead_letter',
  });
  const operations = fakeOperations({ getOperationByReference: async () => { clock += 3000; throw new MobbexApiError('server', 500, 'x'); } });
  const result = await runMobbexWorker({ ledger, operations, now: () => clock }, { owner: 'w', budgetMs: 5000 });
  assert.equal(result.dead_letter >= 1, true);
  assert.ok(result.claimed <= 3, 'bounded by the time budget');
  const lost = fakeLedger({ claimJobs: async () => [{ job_id: 'j', payment_intent_id: INTENT, reference: REFERENCE, environment: 'test', reason: 'sweep', failures: 0 }], finishJob: async () => 'lost_lease' });
  let once = 0;
  lost.claimJobs = async () => (once++ ? [] : [{ job_id: 'j', payment_intent_id: INTENT, reference: REFERENCE, environment: 'test', reason: 'sweep', failures: 0 }]);
  assert.equal((await runMobbexWorker({ ledger: lost, operations: fakeOperations(), now: Date.now }, { owner: 'w', budgetMs: 5000 })).lost_lease, 1);
});

// ── return page, availability, refund ───────────────────────────────────────────────────────────────────────

test('return page: it requests a confirmation and READS; a disabled provider or an outage still returns the status', async () => {
  const ledger = fakeLedger();
  const statusDeps = (overrides = {}) => ({
    ledger, operations: fakeOperations(), resolveConfig: config, inlineBudgetMs: 200,
    requestReconcile: async () => ({ queued: true, intent_id: INTENT, reference: REFERENCE }),
    readStatus: async () => ({ status: 'completed', order_id: 'o1' }), ...overrides,
  });
  const ok = await mobbexCheckoutStatus(statusDeps(), SESSION);
  assert.deepEqual([ok.status, ok.body.checkout.status], [200, 'completed']);
  assert.ok(ledger.calls.some((c) => c.name === 'recordSnapshot' && c.args[2] === 'browser_return'), 'confirmation is a server-side read tagged as such');
  assert.equal((await mobbexCheckoutStatus(statusDeps({ resolveConfig: disabled }), SESSION)).status, 200);
  assert.equal((await mobbexCheckoutStatus(statusDeps({ readStatus: async () => null }), SESSION)).status, 404, 'someone else\'s checkout is not found');
  assert.equal((await mobbexCheckoutStatus(statusDeps(), 'not-a-uuid')).status, 400);
  const outage = await mobbexCheckoutStatus(statusDeps({ operations: fakeOperations({ getOperationByReference: async () => { throw new MobbexApiError('server', 500, 'x'); } }) }), SESSION);
  assert.equal(outage.status, 200);
});

test('availability: Mobbex is offered only when deployment, credentials, business and environment all agree', async () => {
  const deps = (overrides = {}) => ({ resolveConfig: config, databaseAvailability: async () => ({ available: true, environment: 'test' }), ...overrides });
  assert.equal((await mobbexAvailability(deps(), BUSINESS)).body.available, true);
  assert.equal((await mobbexAvailability(deps({ resolveConfig: disabled }), BUSINESS)).body.available, false);
  assert.equal((await mobbexAvailability(deps({ databaseAvailability: async () => ({ available: false }) }), BUSINESS)).body.available, false);
  assert.equal((await mobbexAvailability(deps({ databaseAvailability: async () => ({ available: true, environment: 'production' }) }), BUSINESS)).body.available, false);
  assert.equal((await mobbexAvailability(deps({ databaseAvailability: async () => { throw new Error('x'); } }), BUSINESS)).body.available, false);
  assert.equal((await mobbexAvailability(deps(), 'nope')).body.available, false);
});

const refundDeps = (overrides = {}) => {
  const events = [];
  return {
    events,
    resolveConfig: config,
    prepareRefund: async (input) => { events.push('prepare'); return { refund_id: 'r1', idempotent: false, reconciliation_required: false, full: input.amount === null, amount: input.amount, provider_payment_id: 'OP-1234' }; },
    markRefundSent: async () => { events.push('mark_sent'); },
    recordRefundResult: async (id, outcome) => { events.push(`result:${outcome}`); },
    refundOperation: async () => { events.push('provider'); return { approved: true, responseHash: 'f'.repeat(64) }; },
    ...overrides,
  };
};
const refundBody = (extra = {}) => ({ confirmation: MOBBEX_REFUND_CONFIRMATION, payment_intent_id: INTENT, idempotency_key: '60000000-0000-4000-8000-000000000001', ...extra });

test('refund: explicit confirmation, recorded BEFORE sending, never sent twice, uncertain results are reconciled', async () => {
  const none = refundDeps();
  assert.equal((await refundMobbexPayment(none, refundBody({ confirmation: 'yes' }))).status, 409);
  assert.deepEqual(none.events, []);
  const ok = refundDeps();
  assert.equal((await refundMobbexPayment(ok, refundBody({ amount: '500.00' }))).status, 200);
  assert.deepEqual(ok.events, ['prepare', 'mark_sent', 'provider', 'result:approved'], 'the intention is durable before the money request leaves');
  const replay = refundDeps({ prepareRefund: async () => ({ refund_id: 'r1', idempotent: true, reconciliation_required: true }) });
  assert.equal((await refundMobbexPayment(replay, refundBody())).status, 202);
  assert.equal(replay.events.includes('provider'), false, 'a repeated request never reaches Mobbex');
  const denied = refundDeps({ prepareRefund: async () => { throw new Error('reembolso no autorizado'); } });
  assert.equal((await refundMobbexPayment(denied, refundBody())).body.code, 'REFUND_NOT_AVAILABLE');
  assert.equal(denied.events.includes('provider'), false);
  const lost = refundDeps({ refundOperation: async () => { throw new MobbexApiError('network', 0, 'x'); } });
  assert.equal((await refundMobbexPayment(lost, refundBody())).status, 202);
  assert.ok(lost.events.includes('result:ambiguous'), 'an unknown result is ambiguous, never approved nor rejected');
  const refused = refundDeps({ refundOperation: async () => ({ approved: false, responseHash: 'f'.repeat(64) }) });
  assert.equal((await refundMobbexPayment(refused, refundBody())).body.code, 'REFUND_REJECTED');
  for (const bad of ['-5', '0', 'abc', '1.234', '1e3']) assert.equal((await refundMobbexPayment(refundDeps(), refundBody({ amount: bad }))).status, 400, bad);
  assert.equal((await refundMobbexPayment({ ...refundDeps(), resolveConfig: disabled }, refundBody())).body.code, 'PAYMENTS_NOT_ENABLED');
});

// ── provider seam ───────────────────────────────────────────────────────────────────────────────────────────

test('PaymentProvider: Mobbex is native, Mercado Pago stays delegated to its own functions and is never re-implemented', async () => {
  const registry = new PaymentProviderRegistry().register(mercadoPagoProviderDescriptor).register(new MobbexCheckoutProvider(config(), fakeOperations()));
  assert.deepEqual(registry.list().map((p) => [p.id, p.implementation]), [['mercadopago', 'delegated-edge-functions'], ['mobbex', 'native']]);
  assert.throws(() => registry.register(mercadoPagoProviderDescriptor), /already registered/);
  assert.throws(() => registry.get('stripe'), /unknown payment provider/);
  await assert.rejects(() => registry.get('mercadopago').createCheckout({}), UnsupportedProviderOperation);
  const description = JSON.stringify(registry.get('mobbex').describe());
  assert.equal(/KEY|TOKEN|webhook/i.test(description.replace('single_merchant', '')), false, 'a description exposes no credential');
  assert.equal(registry.get('mobbex').describe().split, false, 'no split, no OAuth: single merchant');
  const provider = new MobbexCheckoutProvider(config(), fakeOperations({ getOperationByReference: async () => ({ found: false, code: 'X', responseHash: 'a'.repeat(64) }) }));
  assert.deepEqual(await provider.fetchPaymentState(REFERENCE), { confirmed: false, snapshot: null, statusClass: null, reason: 'X' }, '"no confirmation" is not "unpaid"');
});
