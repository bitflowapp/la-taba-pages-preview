import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedBusinessOperationViews,
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import {
  MOBBEX_REFUND_PHRASE,
  MOBBEX_REFUND_SERVER_CONFIRMATION,
  classifyMobbexPayment,
  mobbexActionsFor,
  summarizeMobbexPayments,
  validateMobbexRefund,
} from '../js/business/business-mobbex-payments.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';
import { BUSINESS_VIEW_ORDER } from '../js/production-operations.js';

const ID = '3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c';
const ID2 = '4f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6d';

function payment(overrides = {}) {
  return {
    payment_intent_id: ID, order_public_code: 'TABA-0001', reference_short: 'abcd1234', environment: 'test', current_environment: 'test',
    amount: 2500, expected_amount: 2500, paid_amount: 2500, refunded_amount: 0, refundable_amount: 2500, currency: 'ARS',
    internal_status: 'completed', review_reason: null, attention_reason: null, created_at: '2026-11-05T13:00:00Z', approved_at: '2026-11-05T13:01:00Z',
    last_reconciled_at: '2026-11-05T13:02:00Z', payment_id_short: 'OLE-1', refund_in_flight: false, latest_refund_status: null, refunds: [], events: [],
    processing_state: 'normal', can_operate: true, can_refund: true, can_recover_order: false, can_reconcile: false,
    ...overrides,
  };
}

// Un clic falso con el mismo contrato que el DOM que usa el panel: closest() por selector y dataset.
function click(selector, dataset = {}, scope = {}) {
  const node = { dataset, closest(candidate) { return candidate === selector ? node : scope[candidate] ?? null; } };
  return node;
}
function form(values) {
  return { querySelector(selector) { const name = selector.match(/name="([^"]+)/)?.[1]; return name && Object.hasOwn(values, name) ? { value: values[name] } : null; } };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openPanel(overrides = {}, list = [payment()]) {
  const calls = { list: 0, refund: [], reconcile: [], recover: [] };
  configureBusinessOperations({
    role: 'owner',
    listMobbexPayments: async () => { calls.list += 1; return { ok: true, data: typeof list === 'function' ? list() : list }; },
    requestMobbexRefund: async (input) => { calls.refund.push(input); return { ok: true, status: 'approved', message: '' }; },
    requestMobbexReconcile: async (id) => { calls.reconcile.push(id); return { ok: true, message: 'Consulta pedida.' }; },
    recoverMobbexPaidOrder: async (id) => { calls.recover.push(id); return { ok: true, message: 'Pedido armado.' }; },
    onChange() {},
    ...overrides,
  });
  renderBusinessOperations('payments-mobbex');
  await settle();
  return calls;
}

test('Mobbex has its own destination, reachable from the navigation, apart from Mercado Pago', () => {
  assert.ok(BUSINESS_VIEW_ORDER.includes('payments-mobbex'));
  for (const role of ['owner', 'admin', 'staff']) assert.ok(allowedBusinessOperationViews(role).includes('payments-mobbex'), `${role} can open it`);
  assert.ok(!allowedBusinessOperationViews('rider').includes('payments-mobbex'), 'a rider does not');
  resetBusinessOperationsForTests();
  const html = renderBusinessOperations('payments-mobbex');
  assert.match(html, /data-mobbex-payments/);
  assert.doesNotMatch(html, /data-payment-card|data-payment-refund-form|Mercado Pago es|conectar Mercado/i, 'it does not reuse the Mercado Pago surface');
});

test('a completed payment reads as approved; every doubtful money state blocks delivery', () => {
  assert.equal(classifyMobbexPayment(payment()).state, 'approved');
  assert.equal(classifyMobbexPayment(payment()).blocksDelivery, false);
  const cases = [
    [{ internal_status: 'pending', order_public_code: null }, 'checking'],
    [{ internal_status: 'checkout_created', order_public_code: null, paid_amount: null }, 'checking'],
    [{ internal_status: 'rejected', order_public_code: null, paid_amount: null }, 'rejected'],
    [{ internal_status: 'expired', order_public_code: null, paid_amount: null }, 'closed'],
    [{ internal_status: 'refunded', refunded_amount: 2500 }, 'refunded'],
    [{ internal_status: 'partially_refunded', refunded_amount: 500 }, 'partially-refunded'],
    [{ internal_status: 'security_review_required', review_reason: 'amount_mismatch', order_public_code: null, paid_amount: null }, 'in-review'],
    [{ internal_status: 'security_review_required', review_reason: 'approved_after_reservation_expired', order_public_code: null }, 'approved-without-order'],
    [{ internal_status: 'approved_order_pending', order_public_code: null }, 'approved-without-order'],
    [{ refund_in_flight: true, latest_refund_status: 'ambiguous' }, 'money-unresolved'],
    [{ refund_in_flight: true, latest_refund_status: 'processing' }, 'money-unresolved'],
    [{ attention_reason: 'duplicate_approved_payment' }, 'money-unresolved'],
  ];
  for (const [override, expected] of cases) assert.equal(classifyMobbexPayment(payment(override)).state, expected, JSON.stringify(override));
  for (const state of ['checking', 'in-review', 'approved-without-order', 'money-unresolved']) {
    const sample = cases.find(([, s]) => s === state)[0];
    assert.equal(classifyMobbexPayment(payment(sample)).blocksDelivery, true, `${state} blocks delivery`);
  }
  assert.equal(classifyMobbexPayment(payment({ internal_status: 'weird_new_status' })).state, 'checking', 'an unknown status is never shown as approved');
});

test('a sandbox payment is labelled as a test and a production one as real money', () => {
  assert.equal(classifyMobbexPayment(payment({ environment: 'test' })).environmentLabel, 'Prueba');
  assert.equal(classifyMobbexPayment(payment({ environment: 'production' })).environmentLabel, 'Dinero real');
  assert.equal(classifyMobbexPayment(payment({ environment: undefined })).isTest, true, 'missing environment is treated as test, never as real money');
});

test('the actions offered are exactly the server flags, and only to owner or admin', () => {
  assert.deepEqual(mobbexActionsFor(payment(), { elevated: true }).map((a) => a.id), ['refund']);
  assert.deepEqual(mobbexActionsFor(payment({ can_refund: false, can_reconcile: true }), { elevated: true }).map((a) => a.id), ['reconcile']);
  assert.deepEqual(mobbexActionsFor(payment({ can_refund: true, can_recover_order: true, can_reconcile: true }), { elevated: true }).map((a) => a.id), ['reconcile', 'recover-order', 'refund']);
  assert.deepEqual(mobbexActionsFor(payment(), { elevated: false }), [], 'staff gets no actions');
  assert.deepEqual(mobbexActionsFor(payment({ can_refund: false }), { elevated: true }), [], 'no flag, no button');
});

test('refund validation: reason, written confirmation, bounds, and an explicit amount always', () => {
  const base = { reason: 'el cliente devolvio el producto', confirmation: MOBBEX_REFUND_PHRASE, refundable: 2500 };
  assert.equal(validateMobbexRefund({ ...base, reason: 'x' }).ok, false);
  assert.match(validateMobbexRefund({ ...base, confirmation: 'si' }).message, /DEVOLVER/);
  assert.equal(validateMobbexRefund({ ...base, confirmation: 'devolver' }).ok, true, 'case-insensitive');
  const blank = validateMobbexRefund({ ...base, amount: '' });
  assert.deepEqual([blank.ok, blank.amount, blank.full], [true, 2500, true], 'blank = everything left, sent as an explicit amount');
  const partial = validateMobbexRefund({ ...base, amount: '1000,50' });
  assert.deepEqual([partial.ok, partial.amount, partial.full], [true, 1000.5, false]);
  for (const bad of ['0', '-5', 'abc', '1e3', '12.345', '2500.01', '9999999999']) assert.equal(validateMobbexRefund({ ...base, amount: bad }).ok, false, `rejects ${bad}`);
  assert.equal(validateMobbexRefund({ ...base, refundable: 0 }).ok, false, 'no balance, no refund');
  assert.equal(validateMobbexRefund({ ...base, refundable: NaN }).ok, false);
});

test('the list shows what needs a person first and never prints secrets or internal vocabulary', async () => {
  resetBusinessOperationsForTests();
  await openPanel({}, [
    payment({ payment_intent_id: ID2, internal_status: 'security_review_required', review_reason: 'amount_mismatch', order_public_code: null, paid_amount: null, can_refund: false, can_reconcile: true, processing_state: 'stuck' }),
    payment({ refunds: [{ refund_id: 'r1', status: 'ambiguous', amount: 500, full: false, requested_at: '2026-11-05T13:10:00Z', reason: 'devolucion parcial' }], refund_in_flight: true, latest_refund_status: 'ambiguous', can_refund: false, can_reconcile: true }),
  ]);
  const html = renderBusinessOperations('payments-mobbex');
  assert.match(html, /data-mobbex-state="in-review"/);
  assert.match(html, /data-mobbex-state="money-unresolved"/);
  assert.match(html, /1 para revisar|2 para revisar/);
  assert.match(html, /El importe que informó Mobbex no coincide/);
  assert.match(html, /La consulta automática se trabó/);
  assert.doesNotMatch(html, /Devolver el dinero<\/button>/, 'an unresolved refund offers no second refund');
  assert.doesNotMatch(html, /access.?token|api.?key|secret|checkout_url/i);
  assert.deepEqual(containsForbiddenVocabulary(html.replace(/<[^>]+>/g, ' ')), [], 'no plumbing words in what the counter reads');
});

test('staff can read the list but sees no action button; the handler refuses them anyway', async () => {
  resetBusinessOperationsForTests();
  const calls = await openPanel({ role: 'staff' }, [payment({ can_refund: true, can_reconcile: true, can_operate: false })]);
  const html = renderBusinessOperations('payments-mobbex');
  assert.match(html, /data-mobbex-card/);
  assert.doesNotMatch(html, /data-mobbex-refund-open|data-mobbex-reconcile=/);
  // El markup se puede falsificar: aun con el clic, el panel y el servidor lo rechazan.
  const result = await handleBusinessOperationsAction(click('[data-mobbex-refund-open]', { mobbexRefundOpen: ID }));
  assert.equal(result.ok, false);
  assert.equal(calls.refund.length, 0);
  const rec = await handleBusinessOperationsAction(click('[data-mobbex-reconcile]', { mobbexReconcile: ID }));
  assert.equal(rec.ok, false);
  assert.equal(calls.reconcile.length, 0);
});

test('a refund needs reason and DEVOLVER, goes out once with an explicit amount and the Mobbex confirmation', async () => {
  resetBusinessOperationsForTests();
  const calls = await openPanel();
  await handleBusinessOperationsAction(click('[data-mobbex-refund-open]', { mobbexRefundOpen: ID }));
  const html = renderBusinessOperations('payments-mobbex');
  assert.match(html, /data-mobbex-refund-form/);
  const scope = (values) => ({ '[data-mobbex-refund-form]': form(values) });
  const press = (values) => handleBusinessOperationsAction(click('[data-mobbex-refund-confirm]', { mobbexRefundConfirm: ID }, scope(values)));
  let result = await press({ mobbexRefundAmount: '', mobbexRefundReason: 'ok', mobbexRefundConfirmation: 'DEVOLVER' });
  assert.equal(result.ok, false, 'short reason');
  result = await press({ mobbexRefundAmount: '', mobbexRefundReason: 'producto defectuoso', mobbexRefundConfirmation: 'no' });
  assert.equal(result.ok, false, 'no written confirmation');
  assert.equal(calls.refund.length, 0, 'nothing was sent while the form was invalid');
  result = await press({ mobbexRefundAmount: '1000', mobbexRefundReason: 'producto defectuoso', mobbexRefundConfirmation: 'DEVOLVER' });
  assert.equal(result.ok, true);
  assert.equal(calls.refund.length, 1);
  assert.deepEqual({ ...calls.refund[0], idempotencyKey: typeof calls.refund[0].idempotencyKey }, {
    paymentIntentId: ID, amount: 1000, reason: 'producto defectuoso', confirmation: MOBBEX_REFUND_SERVER_CONFIRMATION, idempotencyKey: 'string',
  });
  assert.ok(calls.list >= 2, 'the list is re-read after the request');
});

test('a lost answer keeps the SAME idempotency key, so the retry cannot create a second refund', async () => {
  resetBusinessOperationsForTests();
  const keys = [];
  let answer = { ok: false, code: '', message: '' }; // network failure: no code, no message
  await openPanel({ requestMobbexRefund: async (input) => { keys.push(input.idempotencyKey); return answer; } });
  const press = () => handleBusinessOperationsAction(click('[data-mobbex-refund-confirm]', { mobbexRefundConfirm: ID },
    { '[data-mobbex-refund-form]': form({ mobbexRefundAmount: '1000', mobbexRefundReason: 'producto defectuoso', mobbexRefundConfirmation: 'DEVOLVER' }) }));
  await handleBusinessOperationsAction(click('[data-mobbex-refund-open]', { mobbexRefundOpen: ID }));
  assert.equal((await press()).ok, false);
  assert.equal((await press()).ok, false);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], 'same cobro + same amount = same key until there is a definitive answer');
  answer = { ok: false, code: 'REFUND_RECONCILING', message: 'Estamos verificando' };
  assert.equal((await press()).ok, false);
  assert.equal(keys[2], keys[0], 'still the same key while Mobbex is being asked');
  assert.match(renderBusinessOperations('payments-mobbex'), /No la repitas|verificando/i);
  assert.doesNotMatch(renderBusinessOperations('payments-mobbex'), /data-mobbex-refund-form/, 'the form is closed so nobody repeats it');
});

test('a definitive rejection discards the key: a deliberate retry is a new request', async () => {
  resetBusinessOperationsForTests();
  const keys = [];
  await openPanel({ requestMobbexRefund: async (input) => { keys.push(input.idempotencyKey); return { ok: false, code: 'REFUND_REJECTED', message: 'Mobbex rechazó el reembolso.' }; } });
  const press = () => handleBusinessOperationsAction(click('[data-mobbex-refund-confirm]', { mobbexRefundConfirm: ID },
    { '[data-mobbex-refund-form]': form({ mobbexRefundAmount: '', mobbexRefundReason: 'producto defectuoso', mobbexRefundConfirmation: 'DEVOLVER' }) }));
  await handleBusinessOperationsAction(click('[data-mobbex-refund-open]', { mobbexRefundOpen: ID }));
  const first = await press();
  assert.equal(first.ok, false);
  assert.match(first.message, /rechazó/i);
  await press();
  assert.notEqual(keys[0], keys[1]);
});

test('a second click while a refund is in flight does not send twice', async () => {
  resetBusinessOperationsForTests();
  let release;
  let sent = 0;
  await openPanel({ requestMobbexRefund: () => { sent += 1; return new Promise((resolve) => { release = () => resolve({ ok: true, message: '' }); }); } });
  await handleBusinessOperationsAction(click('[data-mobbex-refund-open]', { mobbexRefundOpen: ID }));
  const press = () => handleBusinessOperationsAction(click('[data-mobbex-refund-confirm]', { mobbexRefundConfirm: ID },
    { '[data-mobbex-refund-form]': form({ mobbexRefundAmount: '', mobbexRefundReason: 'producto defectuoso', mobbexRefundConfirmation: 'DEVOLVER' }) }));
  const first = press();
  await settle();
  const second = await press();
  assert.equal(second.ok, false);
  assert.equal(sent, 1);
  release();
  await first;
});

test('a refund is not offered, and the click is refused, once the list says it cannot be returned', async () => {
  resetBusinessOperationsForTests();
  const calls = await openPanel({}, [payment({ can_refund: false, refund_in_flight: true, latest_refund_status: 'processing' })]);
  const result = await handleBusinessOperationsAction(click('[data-mobbex-refund-open]', { mobbexRefundOpen: ID }));
  assert.equal(result.ok, false);
  assert.equal(calls.refund.length, 0);
});

test('"Consultar a Mobbex" and "Armar el pedido" go through their own functions and refresh the list', async () => {
  resetBusinessOperationsForTests();
  const calls = await openPanel({}, [payment({ can_refund: false, can_reconcile: true, can_recover_order: true, internal_status: 'security_review_required', review_reason: 'approved_after_reservation_expired', order_public_code: null })]);
  const before = calls.list;
  const r1 = await handleBusinessOperationsAction(click('[data-mobbex-reconcile]', { mobbexReconcile: ID }));
  assert.equal(r1.ok, true);
  assert.deepEqual(calls.reconcile, [ID]);
  const r2 = await handleBusinessOperationsAction(click('[data-mobbex-recover]', { mobbexRecover: ID }));
  assert.equal(r2.ok, true);
  assert.deepEqual(calls.recover, [ID]);
  assert.ok(calls.list >= before + 2);
});

test('a failed list never invents payments and shows a plain error', async () => {
  resetBusinessOperationsForTests();
  configureBusinessOperations({ role: 'owner', listMobbexPayments: async () => ({ ok: false, message: 'permission denied for table mobbex_payment_intents' }), onChange() {} });
  renderBusinessOperations('payments-mobbex');
  await settle();
  const html = renderBusinessOperations('payments-mobbex');
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /permission denied|mobbex_payment_intents/);
  assert.doesNotMatch(html, /data-mobbex-card/);
});

test('summary counts what needs attention, what is being verified and open refunds', () => {
  const s = summarizeMobbexPayments([
    payment(),
    payment({ internal_status: 'pending', order_public_code: null }),
    payment({ internal_status: 'security_review_required', review_reason: 'amount_mismatch', order_public_code: null, paid_amount: null }),
    payment({ refund_in_flight: true, latest_refund_status: 'processing' }),
  ]);
  assert.deepEqual({ ...s }, { total: 4, attention: 2, awaiting: 1, refundsOpen: 1, approvedToday: 0 });
});

// Contrato navegador ↔ SQL: las llamadas del repositorio usan exactamente los nombres y parámetros de la migración, y la
// migración no le da nada a anon ni a PUBLIC. Una diferencia de un nombre de parámetro sólo se vería en producción.
test('the repository calls the console RPCs with the migration\'s own parameter names', async () => {
  const { readFileSync } = await import('node:fs');
  const repo = readFileSync(new URL('../js/repositories/supabase_order_repository.js', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../supabase/migrations/20261105010000_mobbex_merchant_console.sql', import.meta.url), 'utf8');
  const expectations = {
    mobbex_list_business_payments: ['p_business_id', 'p_limit'],
    mobbex_request_business_reconcile: ['p_payment_intent_id'],
    mobbex_recover_paid_checkout: ['p_payment_intent_id'],
  };
  const foundation = readFileSync(new URL('../supabase/migrations/20261103010000_mobbex_checkout_foundation.sql', import.meta.url), 'utf8');
  for (const [name, params] of Object.entries(expectations)) {
    const call = new RegExp(String.raw`client\.rpc\('${name}',\s*\{([^}]*)\}`).exec(repo);
    assert.ok(call, `${name} is called from the repository`);
    const used = [...call[1].matchAll(/(p_[a-z_]+)\s*:/g)].map((m) => m[1]);
    assert.deepEqual(used, params, `${name} call parameters`);
    const declared = new RegExp(String.raw`function public\.${name}\(([^)]*)\)`).exec(sql + foundation);
    assert.ok(declared, `${name} is declared`);
    for (const param of params) assert.ok(declared[1].includes(param), `${name} declares ${param}`);
  }
  assert.match(sql, /revoke all on function public\.mobbex_list_business_payments\(uuid, integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.mobbex_request_business_reconcile\(uuid\) to authenticated, service_role;/);
  assert.doesNotMatch(sql, /to (anon|public)\b/i, 'nothing is granted to anon or PUBLIC');
  assert.match(repo, /invokePaymentFunction\('mobbex-refund'/, 'refunds go through the Mobbex Edge function, never the Mercado Pago one');
  const mobbexBlock = repo.slice(repo.indexOf('async function listMobbexBusinessPayments'), repo.indexOf('async function invokePaymentFunction'));
  assert.doesNotMatch(mobbexBlock, /mercadopago|'list_business_payments'|payment_refunds/, 'the Mobbex repository code touches nothing of Mercado Pago');
});
