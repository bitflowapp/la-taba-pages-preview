// Order lifecycle certification on CONTROLLED_PRODUCTION, QA control business
// only: one synthetic order (payment to coordinate, no money) walks the real
// operator RPCs and every refusal the contract promises is exercised live —
// unknown status, skipped states, stale revision, customer and rider-only
// edges, going backwards, leaving a terminal state — plus the idempotency of
// order creation, transitions and cancellation (stock returns exactly once).
// A second order is picked up at the counter and paid in cash (confirmed
// once, then reversed by the cleanup). Orders are cancelled or reversed and
// classified as QA at the end; the QA window is always closed. Never writes
// order state by SQL.
//
//   node scripts/controlled-production/order-lifecycle-cert.mjs [report.json]
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { cleanupQaOrder, operatorClient } from './qa-cleanup.mjs';
import { foreignPublicTenants, openQaWindow, publicCatalogTenants, QA_CONTROL_BUSINESS, REAL_BUSINESS } from './qa-window.mjs';

const BUSINESS = QA_CONTROL_BUSINESS;
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };
const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const compact = (id) => id.replaceAll('-', '');

const report = { at: new Date().toISOString(), target: 'controlled-production', business: 'QA control', checks: {}, codes: {} };
const check = (name, ok, code) => {
  report.checks[name] = ok ? 'PASS' : 'FAIL';
  if (code !== undefined) report.codes[name] = code;
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${code ? ` (${code})` : ''}`);
};

const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const owner = await operatorClient(keys, 'CP QA OWNER', BUSINESS, 'owner');
const staff = await operatorClient(keys, 'CP QA STAFF', BUSINESS, 'staff');

const customer = createClient(keys.url, keys.publishable, OPTIONS);
assert.ok((await customer.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } })).data?.session);
assert.ifError((await customer.rpc('upsert_current_customer_profile', { p_name: 'QA Ciclo', p_phone: '2995550810' })).error);
const saved = await customer.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Ciclo', streetNumber: '810',
  city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat, longitude: ADDRESS.lng, geolocationAccuracy: 10,
  source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
assert.ifError(saved.error);

const product = (await staff.from('products').select('id,price,stock').eq('business_id', BUSINESS).eq('available', true)
  .gt('stock', 5).order('price', { ascending: false }).limit(1)).data[0];
assert.ok(product, 'QA_PRODUCT_REQUIRED');
const stockOf = async () => Number((await admin.from('products').select('stock').eq('id', product.id).single()).data.stock);
const stockBefore = await stockOf();
const quantity = Math.ceil(6001 / Number(product.price));
const requestId = randomUUID();
const payload = (qty) => ({ business_id: BUSINESS, client_request_id: requestId, tracking_token: randomBytes(32).toString('base64url'),
  items: [{ product_id: product.id, quantity: qty }], customer_name: 'QA Ciclo', customer_phone: '2995550810',
  delivery_mode: 'delivery', payment_method: 'coordinate', age_confirmed: true, customer_address_id: saved.data.address.id,
  customer_street_address: 'Calle Ciclo 810', customer_neighborhood: ADDRESS.neighborhood, customer_notes: 'QA ciclo de vida — no despachar' });
const first = payload(quantity);
const rowOf = (data) => (Array.isArray(data) ? data[0] : data);

let order;
const qaWindow = await openQaWindow(owner, BUSINESS, { log });
try {
  const created = await customer.rpc('create_order_with_items', { payload: first });
  assert.ifError(created.error);
  order = rowOf(created.data);
  check('CREATE_OK', Boolean(order?.id));
  const replay = await customer.rpc('create_order_with_items', { payload: first });
  check('CREATE_REPLAY_SAME_ORDER', !replay.error && rowOf(replay.data)?.id === order.id, replay.error?.code);
  const other = await customer.rpc('create_order_with_items', { payload: { ...first, items: [{ product_id: product.id, quantity: quantity + 1 }] } });
  check('CREATE_REUSED_ID_OTHER_PAYLOAD_DENIED', Boolean(other.error), other.error?.code);
} finally {
  await qaWindow.close();
}

try {
  check('STOCK_RESERVED_ONCE', (await stockOf()) === stockBefore - quantity);
  const revision = async () => Number((await staff.from('orders').select('revision').eq('id', order.id).single()).data.revision);
  const statusOf = async () => (await staff.from('orders').select('status').eq('id', order.id).single()).data.status;
  const move = (client, status, rev, key) => client.rpc('transition_order', { p_order_id: order.id, p_expected_revision: rev,
    p_new_status: status, p_idempotency_key: key || `life_${status}_${randomBytes(6).toString('hex')}` });
  const denied = async (name, client, status, rev, expectedCode) => {
    const before = await statusOf();
    const r = await move(client, status, rev);
    check(name, Boolean(r.error) && (!expectedCode || r.error.code === expectedCode) && (await statusOf()) === before, r.error?.code || 'ACCEPTED');
  };

  let rev = await revision();
  await denied('UNKNOWN_STATUS_DENIED', staff, 'shipped', rev, '22023');
  await denied('SKIP_TO_DELIVERED_DENIED', staff, 'delivered', rev, '23514');
  await denied('STALE_REVISION_DENIED', staff, 'accepted', rev + 7);
  await denied('CUSTOMER_OPERATOR_RPC_DENIED', customer, 'accepted', rev, '42501');

  const acceptKey = `life_accept_${compact(order.id)}`;
  const accepted = await move(staff, 'accepted', rev, acceptKey);
  check('ACCEPT_OK', !accepted.error && accepted.data?.idempotent_replay === false, accepted.error?.code);
  const revAfterAccept = await revision();
  const acceptReplay = await move(staff, 'accepted', rev, acceptKey);
  check('ACCEPT_REPLAY_IDEMPOTENT', !acceptReplay.error && acceptReplay.data?.idempotent_replay === true
    && (await revision()) === revAfterAccept, acceptReplay.error?.code);
  const reused = await move(staff, 'preparing', revAfterAccept, acceptKey);
  check('KEY_REUSED_OTHER_PAYLOAD_DENIED', Boolean(reused.error) && (await statusOf()) === 'accepted', reused.error?.code);
  const sameStatus = await move(staff, 'accepted', revAfterAccept);
  check('SAME_STATUS_NO_OP', !sameStatus.error && sameStatus.data?.idempotent_no_op === true
    && (await revision()) === revAfterAccept, sameStatus.error?.code);

  for (const next of ['preparing', 'ready']) {
    const r = await move(staff, next, await revision());
    check(`${next.toUpperCase()}_OK`, !r.error && (await statusOf()) === next, r.error?.code);
  }
  rev = await revision();
  await denied('BACKWARDS_DENIED', staff, 'preparing', rev, '23514');
  await denied('RIDER_ONLY_EDGE_DENIED_TO_STAFF', staff, 'assigned', rev, '23514');
  await denied('DELIVERY_CLOSE_WITHOUT_CODE_DENIED', staff, 'delivered', rev, '23514');

  const cancelKey = `life_cancel_${compact(order.id)}`;
  const cancel = () => staff.rpc('cancel_order', { p_order_id: order.id, p_expected_revision: rev,
    p_reason: 'QA ciclo de vida: sin despacho', p_idempotency_key: cancelKey });
  const cancelled = await cancel();
  check('CANCEL_OK', !cancelled.error && (await statusOf()) === 'cancelled', cancelled.error?.code);
  check('STOCK_RETURNED', (await stockOf()) === stockBefore);
  const cancelReplay = await cancel();
  check('CANCEL_REPLAY_IDEMPOTENT', !cancelReplay.error && cancelReplay.data?.idempotent_replay === true, cancelReplay.error?.code);
  check('STOCK_RETURNED_ONCE', (await stockOf()) === stockBefore);
  await denied('TERMINAL_STATE_LOCKED', staff, 'preparing', await revision(), '23514');
  report.order = order.public_code;
} finally {
  try { report.cleanup = await cleanupQaOrder({ admin, owner, staff, businessId: BUSINESS, orderId: order.id, reason: 'QA ciclo de vida' }); }
  catch (error) { report.cleanup = { error: error.message }; }
  report.stockRestored = (await stockOf()) === stockBefore;
}

// Pickup paid in cash at the counter: the simplest shape of a first canary.
// No rider edge applies, the counter confirms the cash, and the business
// closes the order itself once the customer took it.
let pickup;
const pickupWindow = await openQaWindow(owner, BUSINESS, { log });
try {
  const created = await customer.rpc('create_order_with_items', { payload: { business_id: BUSINESS, client_request_id: randomUUID(),
    tracking_token: randomBytes(32).toString('base64url'), items: [{ product_id: product.id, quantity: 1 }],
    customer_name: 'QA Ciclo', customer_phone: '2995550810', delivery_mode: 'pickup', payment_method: 'cash',
    age_confirmed: true, customer_notes: 'QA retiro — no entregar' } });
  pickup = rowOf(created.data);
  check('PICKUP_CREATE_OK', !created.error && Boolean(pickup?.id), created.error?.code);
} finally {
  await pickupWindow.close();
}
if (pickup?.id) {
  const read = async () => (await staff.from('orders').select('status,revision,manual_payment_status').eq('id', pickup.id).single()).data;
  const step = (status, rev) => staff.rpc('transition_order', { p_order_id: pickup.id, p_expected_revision: rev,
    p_new_status: status, p_idempotency_key: `pick_${status}_${randomBytes(6).toString('hex')}` });
  try {
    check('PICKUP_STOCK_RESERVED', (await stockOf()) === stockBefore - 1);
    for (const next of ['accepted', 'preparing', 'ready']) {
      const r = await step(next, (await read()).revision);
      check(`PICKUP_${next.toUpperCase()}_OK`, !r.error, r.error?.code);
    }
    const dispatch = await step('on_the_way', (await read()).revision);
    check('PICKUP_NOT_DISPATCHABLE', Boolean(dispatch.error) && (await read()).status === 'ready', dispatch.error?.code || 'ACCEPTED');
    const payKey = `pick_pay_${compact(pickup.id)}`;
    const payRevision = (await read()).revision;
    const pay = () => staff.rpc('confirm_manual_order_payment', { p_order_id: pickup.id,
      p_expected_revision: payRevision, p_actual_method: 'cash', p_idempotency_key: payKey });
    const paid = await pay();
    check('PICKUP_CASH_CONFIRMED', !paid.error && (await read()).manual_payment_status === 'confirmed', paid.error?.code);
    // A double tap on «Cobrado» may answer as a replay or be refused; either
    // way the cash is recorded exactly once.
    const paidAgain = await pay();
    const cashEvents = (await admin.from('order_events').select('id').eq('order_id', pickup.id)
      .eq('event_type', 'order.manual_payment_confirmed')).data || [];
    check('PICKUP_CASH_CONFIRMED_ONCE', cashEvents.length === 1, paidAgain.error?.code || paidAgain.data?.code || 'replay');
    const handed = await step('delivered', (await read()).revision);
    check('PICKUP_HANDED_OVER', !handed.error && (await read()).status === 'delivered', handed.error?.code);
    report.pickupOrder = pickup.public_code;
  } finally {
    try { report.pickupCleanup = await cleanupQaOrder({ admin, owner, staff, businessId: BUSINESS, orderId: pickup.id, reason: 'QA retiro' }); }
    catch (error) { report.pickupCleanup = { error: error.message }; }
    report.stockRestored = report.stockRestored && (await stockOf()) === stockBefore;
  }
}
const publicClient = createClient(keys.url, keys.publishable, OPTIONS);
// Every business is closed outside QA runs: nobody may read any catalog.
// Ningún tenant QA queda público. El comercio real puede estarlo: después de abrir, lo está.
report.publicCatalogTenantsAfter = foreignPublicTenants(await publicCatalogTenants(publicClient), REAL_BUSINESS).length;

const failed = Object.entries(report.checks).filter(([, v]) => v !== 'PASS').map(([k]) => k);
report.failed = failed;
report.verdict = failed.length === 0 && report.stockRestored && !report.cleanup?.error && !report.pickupCleanup?.error
  && report.publicCatalogTenantsAfter === 0 ? 'PASS' : 'FAIL';
const out = process.argv[2] || `artifacts/controlled-production/order-lifecycle-cp-${Date.now()}.json`;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));
process.exit(report.verdict === 'PASS' ? 0 : 1);
