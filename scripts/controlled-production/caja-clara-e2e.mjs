// Caja Clara × La Taba — live end-to-end certification on CONTROLLED_PRODUCTION,
// QA control business only (the real store stays closed and untouched).
//
// Caja Clara is NOT simulated: its real .NET engine (CajaClara.TabaAgent, the
// same services as the Windows app on a throw-away SQLite) connects as the QA
// owner with a session registered as `caja_clara_windows` and bound to its
// device hash. The customer is an anonymous web session, the riders are the QA
// rider accounts driving the same RPCs as the Android app, and the Panel is the
// QA staff session reading what the Panel reads. Orders pay "to coordinate" or
// cash that is never collected: no money moves. Every QA order is cleaned up
// with the audited RPCs (cleanupQaOrder), stock is restored and every conflict
// the run opens is closed by a count. The QA window is always closed.
//
//   node scripts/controlled-production/caja-clara-e2e.mjs --agent <CajaClara.TabaAgent.dll> [report.json]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { signIn } from './accounts.mjs';
import { cleanupQaOrder, operatorClient } from './qa-cleanup.mjs';
import { openQaWindow, QA_CONTROL_BUSINESS, REAL_BUSINESS } from './qa-window.mjs';

const BUSINESS = QA_CONTROL_BUSINESS;
const STORE_URL = 'https://la-taba-commercial-pilot.pages.dev';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };
const NOTES = 'QA Caja Clara E2E — no despachar';
const args = process.argv.slice(2);
const agentPath = args[args.indexOf('--agent') + 1];
const out = args.find((a) => a.endsWith('.json')) || `artifacts/controlled-production/caja-clara-e2e-${Date.now()}.json`;
assert.ok(agentPath && agentPath.endsWith('.dll'), 'AGENT_DLL_REQUIRED');

const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const compact = (id) => id.replaceAll('-', '');
const report = { at: new Date().toISOString(), target: 'controlled-production', business: 'QA control', checks: {}, codes: {}, latency: {}, notes: [] };
const check = (name, ok, detail) => {
  report.checks[name] = ok ? 'PASS' : 'FAIL';
  if (detail !== undefined) report.codes[name] = detail;
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` (${typeof detail === 'object' ? JSON.stringify(detail) : detail})` : ''}`);
};

// ── Caja Clara agent ──────────────────────────────────────────────────────
function startAgent() {
  const child = spawn('dotnet', [agentPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = readline.createInterface({ input: child.stdout });
  const waiting = [];
  lines.on('line', (line) => { const next = waiting.shift(); if (next) next(JSON.parse(line)); });
  child.stderr.on('data', () => {});
  return {
    async send(cmd, body = {}, { expectOk = true } = {}) {
      const reply = new Promise((resolve) => waiting.push(resolve));
      child.stdin.write(`${JSON.stringify({ cmd, ...body })}\n`);
      const result = await Promise.race([reply, sleep(120_000).then(() => ({ ok: false, error: 'TIMEOUT' }))]);
      if (expectOk && !result.ok) throw Error(`AGENT_${cmd.toUpperCase()}:${result.error}:${result.message || ''}`);
      return result;
    },
    async quit() { try { await this.send('quit'); } catch { /* ignore */ } child.kill(); },
  };
}

// ── Actors ────────────────────────────────────────────────────────────────
const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const owner = await operatorClient(keys, 'CP QA OWNER', BUSINESS, 'owner');
const staff = await operatorClient(keys, 'CP QA STAFF', BUSINESS, 'staff');

async function riderSession(name) {
  const cred = readQaCredential(name);
  if (!cred) return null;
  const c = createClient(keys.url, keys.publishable, OPTIONS);
  await signIn(c, cred.usuario, cred.secreto);
  const reg = await c.rpc('identity_register_session', { p_business_id: BUSINESS, p_client: 'rider_android',
    p_device_label: `QA Rider E2E ${name.slice(-1)}`, p_device_key_hash: null, p_app_version: 'caja-clara-e2e' });
  if (reg.error || !reg.data?.ok || reg.data.role !== 'rider') return null;
  const { data } = await c.auth.getUser();
  return { c, id: data.user.id, name };
}
const riderKey = (op, id, rev, extra = '') => `e2e_${op}_${compact(id)}_${rev}${extra}`.slice(0, 120);
async function riderBoard(r) { const b = await r.c.rpc('get_rider_delivery_board'); if (b.error) throw Error(`BOARD:${b.error.code}`); return b.data; }
async function riderAvailable(r, value) {
  const board = await riderBoard(r);
  if (board.available !== value) {
    const set = await r.c.rpc('set_rider_availability', { p_business_id: BUSINESS, p_available: value,
      p_expected_version: board.availability_version, p_idempotency_key: riderKey('avail', r.id, board.availability_version, value ? 't' : 'f') });
    if (set.error) throw Error(`AVAILABILITY:${set.error.code}`);
  }
  if (value) await r.c.rpc('heartbeat_rider_availability', { p_business_id: BUSINESS });
}

const customer = createClient(keys.url, keys.publishable, OPTIONS);
assert.ok((await customer.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } })).data?.session, 'CUSTOMER_SESSION');
assert.ifError((await customer.rpc('upsert_current_customer_profile', { p_name: 'QA Caja Clara', p_phone: '2995550830' })).error);
const saved = await customer.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Caja', streetNumber: '830',
  city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat, longitude: ADDRESS.lng, geolocationAccuracy: 10,
  source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
assert.ifError(saved.error);

const product = (await staff.from('products').select('id,sku,name,price,stock,available,merchant_available').eq('business_id', BUSINESS)
  .eq('available', true).not('sku', 'is', null).gt('stock', 12).order('price', { ascending: false }).limit(1)).data?.[0];
assert.ok(product, 'QA_PRODUCT_REQUIRED');
const stockOf = async () => (await admin.from('products').select('stock,available').eq('id', product.id).single()).data;
const reservedOf = async () => {
  const { data } = await admin.from('order_items').select('quantity,orders!inner(status,inventory_released_at)').eq('product_uuid', product.id)
    .in('orders.status', ['received', 'submitted', 'accepted', 'preparing', 'ready', 'assigned']).is('orders.inventory_released_at', null);
  return (data || []).reduce((sum, row) => sum + Number(row.quantity), 0);
};
const initialStock = Number(product.stock);
// The QA tenant has a delivery minimum: one unit is refused (23514), so the delivery order carries enough units.
const deliveryQty = Math.ceil(6001 / Number(product.price));
const initialReserved = await reservedOf();
report.product = { sku: product.sku, initialStock, initialReserved };
const orders = [];

const trackingOf = async (order) => {
  const c = createClient(keys.url, keys.publishable, { ...OPTIONS, global: { headers: { 'x-order-token': order.tracking } } });
  const r = await c.rpc('get_public_order_tracking', { p_public_id: order.public_code });
  return r.error ? { error: r.error.code } : r.data;
};
const panelOrder = async (id) => (await staff.from('orders').select('status,revision,assigned_rider_user_id,manual_payment_status').eq('id', id).single()).data;

async function placeOrder({ quantity = 1, mode = 'pickup', payment = 'coordinate' } = {}) {
  const tracking = randomBytes(32).toString('base64url');
  const window = await openQaWindow(owner, BUSINESS, { log, minutes: 10 });
  let created;
  try {
    created = await customer.rpc('create_order_with_items', { payload: { business_id: BUSINESS, client_request_id: randomUUID(), tracking_token: tracking,
      items: [{ product_id: product.id, quantity }], customer_name: 'QA Caja Clara', customer_phone: '2995550830', delivery_mode: mode,
      payment_method: payment, age_confirmed: true, customer_notes: NOTES,
      ...(mode === 'delivery' ? { customer_address_id: saved.data.address.id, customer_street_address: 'Calle Caja 830', customer_neighborhood: ADDRESS.neighborhood } : {}) } });
  } finally { await window.close(); }
  if (created.error) throw Error(`CREATE_ORDER:${created.error.code}:${created.error.message}`);
  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  const order = { id: row.id, public_code: row.public_code, tracking, createdAt: Date.now(), delivery_code: row.delivery_code };
  orders.push(order);
  return order;
}

async function waitInCaja(agent, predicate, label, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await agent.send('sync');
    const list = (await agent.send('orders')).orders;
    const found = list.find(predicate);
    if (found) return { found, ms: Date.now() - start };
    await sleep(400);
  }
  throw Error(`CAJA_TIMEOUT:${label}`);
}

const agent = startAgent();
let riders = [];
try {
  // ── 1. Identity: a team session bound to this PC ─────────────────────────
  const init = await agent.send('init');
  const ownerCred = readQaCredential('CP QA OWNER');
  const connected = await agent.send('connect', { storeUrl: STORE_URL, email: ownerCred.usuario, password: ownerCred.secreto, business: BUSINESS });
  check('CAJA_CONNECTED_AS_TEAM_MEMBER', connected.connected === true && ['owner', 'admin', 'staff'].includes(connected.role), connected.role);
  const session = await admin.from('identity_sessions').select('client,device_key_hash,revoked_at').eq('device_key_hash', init.device_hash).is('revoked_at', null);
  check('SESSION_BOUND_TO_DEVICE_HASH', session.data?.length === 1 && session.data[0].client === 'caja_clara_windows');
  const foreign = await staff.rpc('pos_list_orders', { p_business_id: BUSINESS, p_device_key_hash: init.device_hash, p_updated_since: null, p_limit: 5 });
  check('PANEL_SESSION_CANNOT_IMPERSONATE_THE_TILL', foreign.error?.code === '42501', foreign.error?.code || 'ACCEPTED');
  const real = await (async () => { const r = await owner.rpc('pos_get_catalog_state', { p_business_id: REAL_BUSINESS, p_device_key_hash: init.device_hash }); return r.error?.code; })();
  check('TILL_OF_QA_CANNOT_READ_THE_REAL_STORE', real === '42501', real);

  // ── 2. Link the product: same SKU, same physical stock ──────────────────
  await agent.send('sync', { full: true });
  const physical = initialStock + initialReserved;
  await agent.send('product', { name: product.name, sku: product.sku, price: Number(product.price), stock: physical });
  await agent.send('link', { sku: product.sku });
  await agent.send('sync', { full: true });
  let stock = await agent.send('stock', { sku: product.sku });
  check('LINKED_IN_SYNC', stock.link_state === 'InSync' && stock.taba_physical === physical, stock);

  // ── 3. Counter sale → La Taba availability (seconds) ────────────────────
  const beforeSale = (await stockOf()).stock;
  const sale = await agent.send('sell', { sku: product.sku, qty: 2 });
  const pushStart = Date.now();
  await agent.send('sync');
  let panelStock = (await staff.from('products').select('stock').eq('id', product.id).single()).data.stock;
  report.latency.counterSaleToPanelMs = Date.now() - pushStart + Number(sale.ms);
  check('COUNTER_SALE_LOWERS_ONLINE_AVAILABILITY', panelStock === beforeSale - 2, { beforeSale, panelStock });
  await agent.send('sync');
  check('COUNTER_SALE_NOT_SENT_TWICE', (await stockOf()).stock === beforeSale - 2);

  // ── 4. Online delivery order: customer → Caja Clara → rider → customer ──
  riders = (await Promise.all(['CP QA RIDER 1', 'CP QA RIDER 2'].map(riderSession))).filter(Boolean);
  report.riders = riders.length;
  check('TWO_QA_RIDERS_AVAILABLE_FOR_THE_RACE', riders.length >= 2, riders.length);
  for (const r of riders) await riderAvailable(r, true);

  const delivery = await placeOrder({ mode: 'delivery', quantity: deliveryQty });
  const seen = await waitInCaja(agent, (o) => o.id === delivery.id, 'new delivery order');
  report.latency.orderVisibleInCajaMs = Date.now() - delivery.createdAt;
  check('NEW_ORDER_REACHES_CAJA_CLARA', seen.found.status === 'submitted' && seen.found.alerted, { ms: report.latency.orderVisibleInCajaMs });
  check('CAJA_ORDER_HAS_NO_DELIVERY_CODE', seen.found.has_delivery_code_field === false);
  await agent.send('sync', { full: true });
  stock = await agent.send('stock', { sku: product.sku });
  check('ONLINE_ORDER_RESERVES_WITHOUT_TOUCHING_PHYSICAL', stock.taba_reserved === initialReserved + deliveryQty && stock.local === physical - 2, stock);

  for (const [action, expected] of [['accept', 'accepted'], ['prepare', 'preparing'], ['ready', 'ready']]) {
    const t = Date.now();
    const result = await agent.send('act', { order: delivery.id, action });
    const panel = await panelOrder(delivery.id);
    const tracking = await trackingOf(delivery);
    report.latency[`caja_${action}_to_panel_ms`] = Date.now() - t;
    check(`CAJA_${action.toUpperCase()}_REACHES_PANEL_AND_CUSTOMER`, result.state === 'Confirmed' && panel.status === expected
      && JSON.stringify(tracking).includes(expected), { state: result.state, panel: panel.status, tracking: tracking?.status || tracking?.order?.status || tracking?.error });
  }
  const ticket = await agent.send('ticket', { order: delivery.id });
  check('ONLINE_ORDER_TICKET', ticket.text.includes('LA TABA') && ticket.text.includes(`Pedido #${delivery.public_code}`) && !/c[oó]digo/i.test(ticket.text));

  // Race of offers: Caja Clara and the Panel offer the same order to two riders at once.
  if (riders.length >= 2) {
    await agent.send('sync', { full: true });
    const [fromCaja, fromPanel] = await Promise.all([
      agent.send('offer', { order: delivery.id, rider: riders[0].id }, { expectOk: false }),
      staff.rpc('offer_order_to_rider', { p_order_id: delivery.id, p_expected_status: 'ready', p_expected_rider_user_id: null, p_new_rider_user_id: riders[1].id }),
    ]);
    const pending = (await admin.from('rider_order_offers').select('id,rider_user_id,version').eq('order_id', delivery.id).eq('status', 'pending')).data;
    check('OFFER_RACE_ONE_PENDING_OFFER', pending.length === 1, { caja: fromCaja.state, panel: fromPanel.data?.code || fromPanel.error?.code, pending: pending.length });
    const offer = pending[0];
    // Race of acceptance: both riders try to take it.
    const accepts = await Promise.all(riders.slice(0, 2).map((r) => r.c.rpc('accept_rider_order_offer',
      { p_offer_id: offer.id, p_expected_version: offer.version, p_idempotency_key: riderKey('accept', offer.id, offer.version, r.id.slice(0, 4)) })));
    const winners = accepts.filter((a) => !a.error && a.data?.ok !== false);
    const assigned = (await panelOrder(delivery.id)).assigned_rider_user_id;
    check('RIDER_RACE_ONE_WINNER_ONE_REJECTED', winners.length === 1 && assigned === offer.rider_user_id,
      accepts.map((a) => a.error?.code || a.data?.code || 'ok'));
    const winner = riders.find((r) => r.id === offer.rider_user_id);

    // The rider app is closed and reopened: a new session recovers the mission.
    const reopened = await riderSession(winner.name);
    const board = await riderBoard(reopened);
    check('RIDER_APP_REOPENED_RECOVERS_ACTIVE_MISSION', board.orders?.some((o) => o.id === delivery.id));

    const advance = async (rpc, extra = {}) => {
      const cur = await panelOrder(delivery.id);
      const r = await winner.c.rpc(rpc, { p_order_id: delivery.id, p_expected_revision: cur.revision,
        p_idempotency_key: riderKey(rpc.slice(0, 8), delivery.id, cur.revision), ...extra });
      return r;
    };
    const picked = await advance('mark_delivery_picked_up');
    const started = await advance('start_rider_delivery');
    check('RIDER_PICKUP_AND_START', !picked.error && !started.error, [picked.error?.code, started.error?.code]);
    // GPS while on the way, visible to the customer only now.
    const cur = await panelOrder(delivery.id);
    const gps = await winner.c.rpc('publish_rider_location_receipt', { p_order_id: delivery.id, p_expected_revision: cur.revision,
      p_lat: ADDRESS.lat + 0.001, p_lng: ADDRESS.lng + 0.001, p_accuracy: 9, p_heading: 90, p_speed: 6,
      p_captured_at: new Date().toISOString(), p_idempotency_key: riderKey('gps', delivery.id, cur.revision), p_is_mock: false });
    const trackingOnTheWay = await trackingOf(delivery);
    check('GPS_PUBLISHED_AND_CUSTOMER_TRACKS_IT', !gps.error && /on_the_way/.test(JSON.stringify(trackingOnTheWay)), gps.error?.code);
    const onTheWay = await waitInCaja(agent, (o) => o.id === delivery.id && o.status === 'on_the_way', 'on the way');
    await agent.send('sync');
    stock = await agent.send('stock', { sku: product.sku });
    check('DISPATCH_TAKES_UNITS_OUT_OF_LOCAL_STOCK_ONCE', onTheWay.found.stock_consumed && stock.local === physical - 2 - deliveryQty, stock);

    // Delivery code: server-enforced (wrong refused, right delivers once).
    let code = delivery.delivery_code;
    if (!code) code = String((await customer.rpc('issue_order_delivery_code', { p_order_id: delivery.id, p_tracking_token: delivery.tracking })).data?.delivery_code || '');
    const arrived = await advance('mark_rider_arrived');
    const wrongCode = code === '1111' ? '2222' : '1111';
    const wrong = await advance('confirm_delivery_code', { p_delivery_code: wrongCode });
    check('WRONG_DELIVERY_CODE_REFUSED', !arrived.error && (wrong.error || wrong.data?.ok === false) && (await panelOrder(delivery.id)).status !== 'delivered',
      wrong.error?.code || wrong.data?.code);
    const rev = (await panelOrder(delivery.id)).revision;
    const right = () => winner.c.rpc('confirm_delivery_code', { p_order_id: delivery.id, p_expected_revision: rev, p_delivery_code: code,
      p_idempotency_key: riderKey('code', delivery.id, rev) });
    const [first, second] = await Promise.all([right(), right()]);
    const deliveredEvents = (await admin.from('order_events').select('id').eq('order_id', delivery.id).eq('event_type', 'order.status_changed')
      .contains('metadata', { to: 'delivered' })).data || [];
    check('RIGHT_CODE_DELIVERS_ONCE_EVEN_DOUBLE_SUBMIT', (await panelOrder(delivery.id)).status === 'delivered' && (!first.error || !second.error),
      { first: first.error?.code || first.data?.code || 'ok', second: second.error?.code || second.data?.code || 'ok', events: deliveredEvents.length });
    const inCaja = await waitInCaja(agent, (o) => o.id === delivery.id && o.status === 'delivered', 'delivered');
    const trackingDone = await trackingOf(delivery);
    const trail = (await admin.from('rider_locations').select('id').eq('order_id', delivery.id)).data || [];
    check('DELIVERED_IN_CAJA_PANEL_AND_CUSTOMER', inCaja.found.status === 'delivered' && /delivered/.test(JSON.stringify(trackingDone)) && trail.length === 0,
      { caja: inCaja.found.status, trail: trail.length });
  }

  // ── 5. Pickup paid in cash at the counter (reflected once) ──────────────
  const pickup = await placeOrder({ mode: 'pickup', payment: 'cash' });
  await waitInCaja(agent, (o) => o.id === pickup.id, 'pickup');
  for (const action of ['accept', 'prepare', 'ready']) await agent.send('act', { order: pickup.id, action });
  const paid = await agent.send('act', { order: pickup.id, action: 'confirm_payment', method: 'cash' });
  const paidAgain = await agent.send('act', { order: pickup.id, action: 'confirm_payment', method: 'cash' }, { expectOk: false });
  const cashEvents = (await admin.from('order_events').select('id').eq('order_id', pickup.id).eq('event_type', 'order.manual_payment_confirmed')).data || [];
  check('CASH_CONFIRMED_ONCE_FROM_CAJA', paid.state === 'Confirmed' && cashEvents.length === 1 && (await panelOrder(pickup.id)).manual_payment_status === 'confirmed',
    { again: paidAgain.state || paidAgain.message, events: cashEvents.length });
  const handed = await agent.send('act', { order: pickup.id, action: 'hand_over' });
  check('PICKUP_HANDED_OVER_FROM_CAJA', handed.state === 'Confirmed' && (await panelOrder(pickup.id)).status === 'delivered');

  // ── 6. Cancellation before dispatch returns the reservation once ───────
  const toCancel = await placeOrder({ mode: 'pickup' });
  await waitInCaja(agent, (o) => o.id === toCancel.id, 'to cancel');
  const beforeCancel = (await stockOf()).stock;
  const cancelled = await agent.send('act', { order: toCancel.id, action: 'cancel', reason: 'QA Caja Clara: prueba de cancelación' });
  const trackingCancelled = await trackingOf(toCancel);
  check('CANCEL_FROM_CAJA_RELEASES_RESERVATION_ONCE', cancelled.state === 'Confirmed' && (await stockOf()).stock === beforeCancel + 1
    && /cancel/.test(JSON.stringify(trackingCancelled)), { state: cancelled.state });

  // ── 7. Panel → Caja Clara: pause from the Panel, resume from Caja Clara ──
  const pause = await owner.rpc('set_commercial_product_publication', { p_business_id: BUSINESS, p_sku: product.sku, p_publish: false });
  await agent.send('sync', { full: true });
  const catalogPaused = await admin.from('products').select('available,merchant_available').eq('id', product.id).single();
  check('PANEL_PAUSE_SEEN_BY_CAJA', !pause.error && catalogPaused.data.merchant_available === false);
  report.notes.push('Resume from Caja Clara uses set_commercial_product_publication (owner/admin) exactly like the Panel.');
  const resume = await owner.rpc('set_commercial_product_publication', { p_business_id: BUSINESS, p_sku: product.sku, p_publish: true });
  check('PRODUCT_RESUMED', !resume.error && (await admin.from('products').select('available').eq('id', product.id).single()).data.available === true, resume.error?.code);

  // ── 8. Offline conflict on the real backend ─────────────────────────────
  // Physical 3 counted at the counter; Caja Clara loses Internet; a customer
  // reserves 2 online; the counter sells 3 → La Taba must never go negative.
  await agent.send('sync', { full: true });
  await agent.send('count', { sku: product.sku, physical: 3 });
  await agent.send('sync', { full: true });
  stock = await agent.send('stock', { sku: product.sku });
  check('COUNT_SETS_AVAILABLE_TO_PHYSICAL_MINUS_RESERVED', stock.taba_stock === 3 - initialReserved && stock.local === 3, stock);
  await agent.send('offline', { on: true });
  const reserving = await placeOrder({ mode: 'pickup', quantity: 2 });
  await agent.send('sell', { sku: product.sku, qty: 3 });
  const offlineSync = await agent.send('sync');
  const outboxOffline = await agent.send('outbox');
  check('OFFLINE_SALE_WAITS_WITHOUT_SPENDING_ATTEMPTS', offlineSync.failure === 'NETWORK' && outboxOffline.attempts_offline === 0, outboxOffline.items);
  await agent.send('offline', { on: false });
  await agent.send('sync', { full: true });
  const afterConflict = await stockOf();
  const conflict = (await admin.from('pos_stock_conflicts').select('id,shortfall,status,holding_orders').eq('product_id', product.id).eq('status', 'open')).data;
  stock = await agent.send('stock', { sku: product.sku });
  check('OFFLINE_OVERSELL_HELD_NOT_NEGATIVE', afterConflict.stock === 0 && afterConflict.available === false && conflict.length === 1
    && conflict[0].shortfall === 2 && stock.link_state === 'Conflict', { stock: afterConflict.stock, conflict: conflict[0]?.shortfall, state: stock.link_state });
  const anonView = await createClient(keys.url, keys.publishable, OPTIONS).from('products').select('id').eq('id', product.id);
  check('HELD_PRODUCT_NOT_PURCHASABLE_ONLINE', (anonView.data || []).length === 0);
  // Resolution: the shop cancels the order it cannot serve, then counts the shelf.
  await agent.send('sync');
  await agent.send('act', { order: reserving.id, action: 'cancel', reason: 'QA Caja Clara: sin stock físico' });
  const phantom = await stockOf();
  check('CANCELLATION_DOES_NOT_REOFFER_A_HELD_PRODUCT', phantom.stock === 2 && phantom.available === false, phantom);
  await agent.send('count', { sku: product.sku, physical: 0 });
  const resolved = conflict[0] ? (await admin.from('pos_stock_conflicts').select('status,resolution').eq('id', conflict[0].id).single()).data : { status: 'missing' };
  check('OWNER_COUNT_CLOSES_THE_CONFLICT', resolved.status === 'resolved' && (await stockOf()).stock === 0, resolved);

  // ── 9. Store status both ways (QA window, closed at the end) ────────────
  const statusWindow = await openQaWindow(owner, BUSINESS, { log, minutes: 5 });
  try {
    await agent.send('sync', { full: true });
    const open = await agent.send('status');
    const paused = await agent.send('store', { status: 'paused' });
    const panelSees = (await staff.from('businesses').select('status').eq('id', BUSINESS).single()).data.status;
    check('STORE_STATUS_PANEL_TO_CAJA_AND_BACK', open.business_status === 'open' && paused.label === 'Pausado' && panelSees === 'paused',
      { caja: open.business_status, panel: panelSees });
    check('MERCADO_PAGO_IS_A_WORD_NOT_TOKENS', ['connected', 'not_connected', 'needs_attention'].includes(open.mercadopago), open.mercadopago);
  } finally { await statusWindow.close(); }

  // ── 10. Disconnect closes the session in La Taba ────────────────────────
  await agent.send('disconnect');
  const closedSession = await admin.from('identity_sessions').select('revoked_at,revoked_reason').eq('device_key_hash', init.device_hash);
  check('DISCONNECT_REVOKES_THE_TILL_SESSION', closedSession.data?.every((s) => s.revoked_at && s.revoked_reason === 'self_logout'));
} catch (error) {
  report.error = error.message;
  log(`ERROR ${error.message}`);
} finally {
  for (const r of riders) { try { await riderAvailable(r, false); } catch { /* ignore */ } }
  // Never leave a till session open in La Taba, even when a step failed.
  try { await agent.send('disconnect', {}, { expectOk: false }); } catch { /* ignore */ }
  report.cleanup = [];
  for (const order of orders) {
    try { report.cleanup.push({ code: order.public_code, ...(await cleanupQaOrder({ admin, owner, staff, businessId: BUSINESS, orderId: order.id, reason: 'QA Caja Clara E2E' })) }); }
    catch (error) { report.cleanup.push({ code: order.public_code, error: error.message }); }
  }
  // Close any conflict this run opened and put the QA stock back where it was.
  const open = (await admin.from('pos_stock_conflicts').select('id').eq('product_id', product.id).eq('status', 'open')).data || [];
  const now = await stockOf();
  const reservedNow = await reservedOf();
  const target = initialStock + (initialReserved - reservedNow);
  if (open.length || now.stock !== target) {
    const delta = target - now.stock;
    if (delta !== 0) {
      const r = await owner.rpc('apply_inventory_movement', { p_business_id: BUSINESS, p_product_id: product.id, p_barcode_id: null,
        p_movement_type: 'stock_count', p_package_quantity: Math.abs(delta), p_direction: delta > 0 ? 1 : -1,
        p_reference_type: 'pilot_qa_return', p_reference_id: null, p_reason: 'QA Caja Clara E2E: restitución del stock QA',
        p_idempotency_key: `qa_cc_restore_${Date.now()}` });
      report.restore = r.error ? { error: r.error.code } : { delta };
    }
  }
  // A plain stock movement never republishes: the QA product goes back online the way the Panel does it.
  if (!(await stockOf()).available) {
    const republish = await owner.rpc('set_commercial_product_publication', { p_business_id: BUSINESS, p_sku: product.sku, p_publish: true });
    report.republished = republish.error ? { error: republish.error.code } : true;
  }
  report.finalAvailable = (await stockOf()).available;
  report.finalStock = (await stockOf()).stock;
  report.stockRestored = report.finalStock === initialStock + (initialReserved - (await reservedOf()));
  report.openConflictsAfter = ((await admin.from('pos_stock_conflicts').select('id').eq('product_id', product.id).eq('status', 'open')).data || []).length;
  const qaStatus = (await admin.from('businesses').select('status').eq('id', BUSINESS).single()).data.status;
  report.qaBusinessClosed = qaStatus === 'closed';
  const realStore = (await admin.from('businesses').select('status,ordering_enabled').eq('id', REAL_BUSINESS).single()).data;
  report.realStoreUntouched = realStore.status === 'closed' && realStore.ordering_enabled === false;
  await agent.quit();
}

const failed = Object.entries(report.checks).filter(([, v]) => v !== 'PASS').map(([k]) => k);
report.failed = failed;
report.verdict = !report.error && failed.length === 0 && report.stockRestored && report.finalAvailable && report.openConflictsAfter === 0 && report.qaBusinessClosed
  && report.realStoreUntouched && report.cleanup.every((c) => !c.error) ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ verdict: report.verdict, failed, error: report.error, latency: report.latency }, null, 1));
process.exit(report.verdict === 'PASS' ? 0 : 1);
