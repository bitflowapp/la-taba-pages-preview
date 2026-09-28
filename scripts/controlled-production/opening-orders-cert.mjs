// Pedidos de la apertura, EN VIVO sobre CONTROLLED_PRODUCTION (sólo el tenant QA):
//
//   1. Un comercio de SÓLO RETIRO (delivery apagado desde el Panel): el pedido
//      de retiro nace, se cobra en efectivo en el mostrador y se entrega sin
//      código de entrega.
//   2. Con el delivery apagado, un pedido de delivery se rechaza en la base.
//   3. «A coordinar» que el comercio confirma como TRANSFERENCIA; un pedido en
//      efectivo no se puede confirmar como transferencia.
//
// Sin dinero real: los cobros se revierten, los pedidos se cancelan o se
// devuelve la mercadería por movimiento auditado, y todo queda clasificado como
// QA. La entrega del tenant QA y su ventana vuelven a como estaban aunque algo
// falle. Nunca escribe estado de pedidos por SQL. No imprime secretos.
//
//   node scripts/controlled-production/opening-orders-cert.mjs --out docs/evidence/controlled-production/opening-orders-cp-AAAAMMDD.json
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { cleanupQaOrder, operatorClient } from './qa-cleanup.mjs';
import { foreignPublicTenants, openQaWindow, publicCatalogTenants, QA_CONTROL_BUSINESS, REAL_BUSINESS } from './qa-window.mjs';

const BUSINESS = QA_CONTROL_BUSINESS;
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };
const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const args = process.argv.slice(2);
const out = (() => { const i = args.indexOf('--out'); return i < 0 ? '' : args[i + 1]; })();

const checks = [];
const check = (id, ok, detail = '') => {
  checks.push({ id, ok: Boolean(ok), detail: String(detail ?? '').slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` · ${detail}` : ''}`);
};
const rowOf = (data) => (Array.isArray(data) ? data[0] : data);

const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const owner = await operatorClient(keys, 'CP QA OWNER', BUSINESS, 'owner');
const staff = await operatorClient(keys, 'CP QA STAFF', BUSINESS, 'staff');

const customer = createClient(keys.url, keys.publishable, OPTIONS);
assert.ok((await customer.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } })).data?.session, 'ANON_SESSION');
assert.ifError((await customer.rpc('upsert_current_customer_profile', { p_name: 'QA Apertura', p_phone: '2995550820' })).error);
const saved = await customer.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Apertura', streetNumber: '820',
  city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat, longitude: ADDRESS.lng, geolocationAccuracy: 10,
  source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
assert.ifError(saved.error);

const product = (await staff.from('products').select('id,price,stock').eq('business_id', BUSINESS).eq('available', true)
  .gt('stock', 5).order('price', { ascending: false }).limit(1)).data?.[0];
assert.ok(product, 'QA_PRODUCT_REQUIRED');
const stockOf = async () => Number((await admin.from('products').select('stock').eq('id', product.id).single()).data.stock);
const stockBefore = await stockOf();
const before = (await admin.from('businesses').select('delivery_enabled,pickup_enabled,status').eq('id', BUSINESS).single()).data;

const base = () => ({ business_id: BUSINESS, client_request_id: randomUUID(), tracking_token: randomBytes(32).toString('base64url'),
  customer_name: 'QA Apertura', customer_phone: '2995550820', age_confirmed: true });
const pickupPayload = () => ({ ...base(), items: [{ product_id: product.id, quantity: 1 }], delivery_mode: 'pickup',
  payment_method: 'cash', customer_notes: 'QA apertura: retiro — no entregar' });
const deliveryPayload = (payment) => ({ ...base(), items: [{ product_id: product.id, quantity: Math.ceil(6001 / Number(product.price)) }],
  delivery_mode: 'delivery', payment_method: payment, customer_address_id: saved.data.address.id,
  customer_street_address: 'Calle Apertura 820', customer_neighborhood: ADDRESS.neighborhood,
  customer_notes: 'QA apertura: delivery — no despachar' });

const orders = [];
const reports = {};
// Se lee con la clave de servicio: el método real del cobro no es una columna del equipo.
const readOrder = async (id) => (await admin.from('orders')
  .select('status,revision,manual_payment_status,manual_payment_method,delivery_mode').eq('id', id).single()).data;
const step = (id, status, revision) => staff.rpc('transition_order', { p_order_id: id, p_expected_revision: revision,
  p_new_status: status, p_idempotency_key: `open_${status}_${randomBytes(6).toString('hex')}` });
const confirmPayment = (id, revision, method) => staff.rpc('confirm_manual_order_payment', { p_order_id: id,
  p_expected_revision: revision, p_actual_method: method, p_idempotency_key: `open_pay_${method}_${randomBytes(6).toString('hex')}` });

try {
  // ── 1 y 2 · Sólo retiro ────────────────────────────────────────────────────
  const off = await owner.rpc('set_business_fulfillment', { p_business_id: BUSINESS, p_delivery_enabled: false, p_pickup_enabled: true });
  check('PANEL_DELIVERY_OFF', !off.error && off.data?.delivery_enabled === false && off.data?.pickup_enabled === true, off.error?.code);

  let pickup;
  let transfer;
  let deliveryCash;
  const qaWindow = await openQaWindow(owner, BUSINESS, { log });
  try {
    const created = await customer.rpc('create_order_with_items', { payload: pickupPayload() });
    pickup = rowOf(created.data);
    if (pickup?.id) orders.push(pickup.id);
    check('PICKUP_WITH_DELIVERY_OFF', !created.error && Boolean(pickup?.id), created.error?.message);

    const refused = await customer.rpc('create_order_with_items', { payload: deliveryPayload('cash') });
    if (rowOf(refused.data)?.id) orders.push(rowOf(refused.data).id);
    check('DELIVERY_REFUSED_WHEN_OFF', /delivery no habilitado/.test(refused.error?.message || ''), refused.error?.message || 'ACEPTADO');

    // ── 3 · A coordinar, con el delivery de vuelta ───────────────────────────
    const on = await owner.rpc('set_business_fulfillment', { p_business_id: BUSINESS,
      p_delivery_enabled: before.delivery_enabled, p_pickup_enabled: before.pickup_enabled });
    check('PANEL_DELIVERY_BACK', !on.error && on.data?.delivery_enabled === before.delivery_enabled, on.error?.code);
    const coordinated = await customer.rpc('create_order_with_items', { payload: deliveryPayload('coordinate') });
    transfer = rowOf(coordinated.data);
    if (transfer?.id) orders.push(transfer.id);
    check('COORDINATE_ORDER_CREATED', !coordinated.error && Boolean(transfer?.id), coordinated.error?.message);
    const cashAtDoor = await customer.rpc('create_order_with_items', { payload: deliveryPayload('cash') });
    deliveryCash = rowOf(cashAtDoor.data);
    if (deliveryCash?.id) orders.push(deliveryCash.id);
    check('DELIVERY_CASH_ORDER_CREATED', !cashAtDoor.error && Boolean(deliveryCash?.id), cashAtDoor.error?.message);
  } finally {
    await qaWindow.close();
  }

  if (pickup?.id) {
    for (const next of ['accepted', 'preparing', 'ready']) {
      const r = await step(pickup.id, next, (await readOrder(pickup.id)).revision);
      check(`PICKUP_${next.toUpperCase()}`, !r.error, r.error?.code);
    }
    const asTransfer = await confirmPayment(pickup.id, (await readOrder(pickup.id)).revision, 'transfer');
    check('CASH_ORDER_NOT_CONFIRMABLE_AS_TRANSFER', Boolean(asTransfer.error) && (await readOrder(pickup.id)).manual_payment_status !== 'confirmed',
      asTransfer.error?.code);
    const cash = await confirmPayment(pickup.id, (await readOrder(pickup.id)).revision, 'cash');
    const afterCash = await readOrder(pickup.id);
    check('PICKUP_CASH_AT_COUNTER', !cash.error && afterCash.manual_payment_status === 'confirmed' && afterCash.manual_payment_method === 'cash',
      cash.error?.code);
    const handed = await step(pickup.id, 'delivered', (await readOrder(pickup.id)).revision);
    check('PICKUP_HANDED_OVER_WITHOUT_CODE', !handed.error && (await readOrder(pickup.id)).status === 'delivered', handed.error?.code);
    reports.pickup = pickup.public_code;
  }

  if (transfer?.id) {
    const accepted = await step(transfer.id, 'accepted', (await readOrder(transfer.id)).revision);
    check('COORDINATE_ACCEPTED', !accepted.error, accepted.error?.code);
    const paid = await confirmPayment(transfer.id, (await readOrder(transfer.id)).revision, 'transfer');
    const afterPaid = await readOrder(transfer.id);
    check('COORDINATE_CONFIRMED_AS_TRANSFER', !paid.error && afterPaid.manual_payment_status === 'confirmed'
      && afterPaid.manual_payment_method === 'transfer', paid.error?.code);
    reports.transfer = transfer.public_code;
  }

  if (deliveryCash?.id) {
    const accepted = await step(deliveryCash.id, 'accepted', (await readOrder(deliveryCash.id)).revision);
    check('DELIVERY_CASH_ACCEPTED', !accepted.error, accepted.error?.code);
    const asTransfer = await confirmPayment(deliveryCash.id, (await readOrder(deliveryCash.id)).revision, 'transfer');
    check('DELIVERY_CASH_NOT_CONFIRMABLE_AS_TRANSFER', Boolean(asTransfer.error), asTransfer.error?.code);
    const cash = await confirmPayment(deliveryCash.id, (await readOrder(deliveryCash.id)).revision, 'cash');
    const afterCash = await readOrder(deliveryCash.id);
    check('DELIVERY_CASH_CONFIRMED', !cash.error && afterCash.manual_payment_status === 'confirmed'
      && afterCash.manual_payment_method === 'cash' && afterCash.delivery_mode === 'delivery', cash.error?.code);
    reports.deliveryCash = deliveryCash.public_code;
  }
} finally {
  const cleanup = [];
  for (const id of orders) {
    try { cleanup.push(await cleanupQaOrder({ admin, owner, staff, businessId: BUSINESS, orderId: id, reason: 'QA apertura' })); }
    catch (error) { cleanup.push({ error: error.message }); }
  }
  reports.cleanup = cleanup;
  const restored = await owner.rpc('set_business_fulfillment', { p_business_id: BUSINESS,
    p_delivery_enabled: before.delivery_enabled, p_pickup_enabled: before.pickup_enabled });
  const after = (await admin.from('businesses').select('delivery_enabled,pickup_enabled,status').eq('id', BUSINESS).single()).data;
  check('QA_CLEANUP', cleanup.every((c) => !c.error && c.classified), cleanup.map((c) => c.error || (c.reversed ? 'revertido' : 'ok')).join(','));
  check('QA_STOCK_RESTORED', (await stockOf()) === stockBefore, `${stockBefore}`);
  check('QA_FULFILLMENT_RESTORED', !restored.error && after.delivery_enabled === before.delivery_enabled
    && after.pickup_enabled === before.pickup_enabled && after.status === before.status, after.status);
  const publicClient = createClient(keys.url, keys.publishable, OPTIONS);
  // Ningún tenant QA queda a la vista; el comercio real puede estarlo (después de abrir, lo está).
  check('QA_WINDOW_CLOSED', foreignPublicTenants(await publicCatalogTenants(publicClient), REAL_BUSINESS).length === 0,
    'ningún tenant QA público');
  for (const client of [owner, staff]) {
    try { await client.rpc('identity_close_own_session', { p_business_id: BUSINESS }); } catch { /* ya cerrada */ }
    try { await client.auth.signOut({ scope: 'local' }); } catch { /* sin sesión */ }
  }
  try { await customer.auth.signOut({ scope: 'local' }); } catch { /* sin sesión */ }
}

const failed = checks.filter((c) => !c.ok);
const report = { at: new Date().toISOString(), target: 'controlled-production', business: 'qa-control-cp', money: 'ninguno',
  verdict: failed.length ? 'FAIL' : 'PASS', passed: checks.length - failed.length, total: checks.length, orders: reports, checks };
if (out) { mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`); }
console.log(`\nOPENING_ORDERS_CERT: ${report.verdict} (${report.passed}/${report.total})`);
if (failed.length) process.exitCode = 1;
