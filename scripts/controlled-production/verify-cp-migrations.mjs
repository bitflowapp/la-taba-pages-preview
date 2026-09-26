// Live certification of 20260925085000 and 20260925090000 on CONTROLLED_PRODUCTION.
// Real sessions only: QA owner/staff/rider (password) and anonymous customers.
// No secret key and no SQL: every state change goes through the RPC the Panel,
// the Rider app or the storefront uses. Everything it creates is cancelled
// (stock returns once), classified as QA, and the QA window is left closed.
//
//   node scripts/controlled-production/verify-cp-migrations.mjs --target controlled-production [--out file]
//
// Sections: pause/close with online ordering enabled and PAUSE ALL SYSTEM (085000),
// public product columns and drafts (090000), QA window open/close, a runner
// killed with the window open (server-side expiry) and a QA tenant opened from
// the Panel without a window (fail closed + cron).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { signIn } from './accounts.mjs';
import { cleanupQaOrder } from './qa-cleanup.mjs';
import { QA_CONTROL_BUSINESS, REAL_BUSINESS, foreignPublicTenants, publicCatalogTenants } from './qa-window.mjs';

const CP_REF = 'tkanbadcglszlcyfjvpv';
const QA_ISOLATION_BUSINESS = 'dd515bdd-33bc-4a72-9e70-72d2ab8ae1f0';
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };
const NOTES = 'QA verificación migraciones — no despachar';
// The exact column list the storefront asks for (js/repositories/supabase_order_repository.js).
export const STOREFRONT_COLUMNS = ['id', 'business_id', 'external_id', 'sku', 'name', 'brand', 'description',
  'category', 'subcategory', 'variant', 'presentation', 'capacity_value', 'capacity_unit', 'capacity',
  'packaging_type', 'units_per_pack', 'sold_as_pack', 'price', 'price_status', 'stock', 'available', 'chilled',
  'is_alcoholic', 'minimum_age', 'image_url', 'image_sha256', 'image_thumbnail_url', 'image_thumbnail_sha256',
  'source_image_sha256', 'tags', 'sort_order', 'is_active', 'is_verified'];
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (msg) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}\n`);
const codeOf = (r) => r?.error?.code || (r?.data?.ok === false ? (r.data.code || 'refused') : 'ok');

// Child mode: a QA runner that opens a 1-minute window and is killed before its `finally`.
if (process.argv.includes('--crash-child')) {
  const keys = await loadTargetKeys('controlled-production', { requireSecret: false });
  const stored = readQaCredential('CP QA OWNER');
  const c = createClient(keys.url, keys.publishable, OPTIONS);
  await signIn(c, stored.usuario, stored.secreto);
  await c.rpc('identity_register_session', { p_business_id: QA_CONTROL_BUSINESS, p_client: 'panel_web',
    p_device_label: 'CP migration verify crash runner', p_device_key_hash: null, p_app_version: 'cp-migration-verify' });
  const r = await c.rpc('open_qa_window', { p_business_id: QA_CONTROL_BUSINESS, p_minutes: 1 });
  process.stdout.write(`${JSON.stringify({ opened: !r.error && r.data?.ok === true, until: r.data?.qa_window_until || null, code: r.error?.code || null })}\n`);
  setInterval(() => {}, 60_000); // stays alive until killed: no close, no finally
  await new Promise(() => {});
}

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
assert.equal(opt('--target'), 'controlled-production', 'EXPLICIT_TARGET_REQUIRED');
const OUT = opt('--out', `artifacts/controlled-production/verify-cp-migrations-${Date.now()}.json`);
const keys = await loadTargetKeys('controlled-production', { requireSecret: false });
assert.equal(keys.ref, CP_REF, 'NOT_CONTROLLED_PRODUCTION');
const client = () => createClient(keys.url, keys.publishable, OPTIONS);
const anon = client();
const report = { at: new Date().toISOString(), target: 'controlled-production', ref: keys.ref, business: QA_CONTROL_BUSINESS, checks: {}, codes: {}, timings: {} };
const pass = (name, ok, code) => { report.checks[name] = ok ? 'PASS' : 'FAIL'; if (code !== undefined) report.codes[name] = code; log(`${name}: ${report.checks[name]}${code !== undefined ? ` (${code})` : ''}`); };
const set = (name, value, code) => { report.checks[name] = value; if (code !== undefined) report.codes[name] = code; log(`${name}: ${value}${code !== undefined ? ` (${code})` : ''}`); };

async function operator(credential, label, clientKind = 'panel_web') {
  const stored = readQaCredential(credential);
  assert.ok(stored?.secreto, `QA_CREDENTIAL_REQUIRED:${credential}`);
  const c = client();
  const user = await signIn(c, stored.usuario, stored.secreto);
  const reg = await c.rpc('identity_register_session', { p_business_id: QA_CONTROL_BUSINESS, p_client: clientKind,
    p_device_label: `CP migration verify ${label}`, p_device_key_hash: null, p_app_version: 'cp-migration-verify' });
  assert.ok(reg.data?.ok, `SESSION_REFUSED:${label}:${codeOf(reg)}`);
  return { c, id: user.id, role: reg.data.role };
}
const publicRows = async (businessId) => {
  const { data, error } = await anon.from('products').select('id').eq('business_id', businessId);
  if (error) throw Error(`ANON_PRODUCTS:${error.code}`);
  return data.length;
};
const publicState = async () => {
  const { data, error } = await anon.from('businesses').select('status,qa_fixture,qa_window_until').eq('id', QA_CONTROL_BUSINESS).single();
  if (error) throw Error(`ANON_BUSINESS:${error.code}`);
  return data;
};

const owner = await operator('CP QA OWNER', 'owner');
const staff = await operator('CP QA STAFF', 'staff');
assert.ok(['owner', 'admin'].includes(owner.role), 'OWNER_ROLE_REQUIRED');
const createdOrders = [];
let rider = null;
let hiddenSku = null;
const stockOf = async (id) => Number((await staff.c.from('products').select('stock').eq('id', id).single()).data.stock);

async function newCustomer(k) {
  const c = client();
  const s = await c.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } });
  assert.ok(s.data?.session, `ANON_SIGNIN_FAILED:${s.error?.code}`);
  assert.ifError((await c.rpc('upsert_current_customer_profile', { p_name: `QA Migraciones ${k}`, p_phone: `29955503${String(k).padStart(2, '0')}` })).error);
  const saved = await c.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle QA',
    streetNumber: String(300 + k), city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat,
    longitude: ADDRESS.lng, geolocationAccuracy: 10, source: 'gps', locationSource: 'map_pin',
    locationConfirmedAt: new Date().toISOString(), isDefault: true } });
  const addressId = saved.data?.address?.id || saved.data?.id;
  assert.ok(!saved.error && addressId, `ADDRESS_FAILED:${saved.error?.code}`);
  return { c, addressId, k };
}
const orderPayload = (cust, productId, qty) => ({ business_id: QA_CONTROL_BUSINESS, client_request_id: randomUUID(),
  tracking_token: randomBytes(32).toString('base64url'), items: [{ product_id: productId, quantity: qty }],
  customer_name: `QA Migraciones ${cust.k}`, customer_phone: `29955503${String(cust.k).padStart(2, '0')}`,
  delivery_mode: 'delivery', payment_method: 'cash', age_confirmed: true, customer_address_id: cust.addressId,
  customer_street_address: `Calle QA ${300 + cust.k}`, customer_neighborhood: ADDRESS.neighborhood, customer_notes: NOTES });
async function attemptOrder(cust, productId, qty) {
  const payload = orderPayload(cust, productId, qty);
  const r = await cust.c.rpc('create_order_with_items', { payload });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (row?.id) createdOrders.push(row.id);
  const persisted = await owner.c.from('orders').select('id').eq('client_request_id', payload.client_request_id);
  return { id: row?.id || null, code: r.error?.code || 'accepted', rows: (persisted.data || []).length };
}

try {
  // ---------- 0. after the migration: QA tenant closed by default ----------
  const s0 = await publicState();
  const cfg = (await owner.c.from('businesses').select('status,ordering_enabled,ordering_verified,is_active').eq('id', QA_CONTROL_BUSINESS).single()).data;
  report.initial = { status: s0.status, qaFixture: s0.qa_fixture, window: s0.qa_window_until, orderingEnabled: cfg.ordering_enabled };
  pass('QA_TENANT_DEFAULT_CLOSED', s0.status === 'closed' && s0.qa_fixture === true && !s0.qa_window_until && await publicRows(QA_CONTROL_BUSINESS) === 0);
  pass('PRECONDITION_ORDERING_ENABLED', cfg.ordering_enabled === true && cfg.ordering_verified === true);
  pass('FOREIGN_PUBLIC_CATALOG_BEFORE', foreignPublicTenants(await publicCatalogTenants(anon), REAL_BUSINESS).length === 0);

  // ---------- 1. QA window open + product column privacy ----------
  const w = await owner.c.rpc('open_qa_window', { p_business_id: QA_CONTROL_BUSINESS, p_minutes: 15 });
  const s1 = await publicState();
  const visible = await publicRows(QA_CONTROL_BUSINESS);
  report.timings.windowUntil = w.data?.qa_window_until || null;
  pass('QA_WINDOW_OPEN', !w.error && w.data?.status === 'open' && s1.status === 'open' && Boolean(s1.qa_window_until) && visible > 0, `${codeOf(w)} visible=${visible}`);
  const storefront = await anon.from('products').select(STOREFRONT_COLUMNS.join(',')).eq('business_id', QA_CONTROL_BUSINESS)
    .eq('is_active', true).eq('is_verified', true);
  pass('PUBLIC_PRODUCT_COLUMNS', !storefront.error && storefront.data.length === visible
    && STOREFRONT_COLUMNS.every((col) => col in storefront.data[0]), storefront.error?.code || `rows=${storefront.data.length}`);
  const denied = async (c, columns) => { const r = await c.from('products').select(columns).eq('business_id', QA_CONTROL_BUSINESS).limit(1); return r.error?.code || `READABLE:${(r.data || []).length}`; };
  const uc = await denied(anon, 'id,unit_cost');
  set('UNIT_COST_PUBLIC', uc === '42501' ? 'DENIED' : 'EXPOSED', uc);
  const vb = await denied(anon, 'id,verified_by');
  set('VERIFIED_BY_PUBLIC', vb === '42501' ? 'DENIED' : 'EXPOSED', vb);
  const star = await denied(anon, '*');
  set('SELECT_STAR_PUBLIC', star === '42501' ? 'DENIED' : 'EXPOSED', star);
  const customer0 = await newCustomer(1);
  const ucAuth = await denied(customer0.c, 'id,unit_cost');
  set('UNIT_COST_CUSTOMER_SESSION', ucAuth === '42501' ? 'DENIED' : 'EXPOSED', ucAuth);
  const embed = await anon.from('businesses').select('id,products(id,unit_cost)').eq('id', QA_CONTROL_BUSINESS);
  set('UNIT_COST_VIA_EMBED', embed.error ? 'DENIED' : ((embed.data?.[0]?.products || []).some((p) => 'unit_cost' in p) ? 'EXPOSED' : 'DENIED'), embed.error?.code || 'no_rows');
  pass('ISOLATION_TENANT_NOT_PUBLIC', await publicRows(QA_ISOLATION_BUSINESS) === 0);

  // Draft: the owner unpublishes a product from the Panel; the public stops seeing it.
  const products = (await staff.c.from('products').select('id,sku,price,stock').eq('business_id', QA_CONTROL_BUSINESS)
    .eq('available', true).eq('is_active', true).eq('is_verified', true).eq('is_alcoholic', false).order('price', { ascending: true })).data;
  assert.ok(products.length >= 3, 'NEED_3_QA_PRODUCTS');
  const victim = products[products.length - 1];
  const off = await owner.c.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: victim.sku, p_publish: false });
  if (!off.error) hiddenSku = victim.sku;
  const draftVisible = (await anon.from('products').select('id').eq('id', victim.id)).data?.length ?? -1;
  set('DRAFT_PRODUCT_PUBLIC', !off.error && draftVisible === 0 ? 'DENIED' : 'EXPOSED', `${codeOf(off)} rows=${draftVisible}`);
  const on = await owner.c.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: victim.sku, p_publish: true });
  if (!on.error) hiddenSku = null;
  pass('DRAFT_REPUBLISHED', !on.error && (await anon.from('products').select('id').eq('id', victim.id)).data?.length === 1, codeOf(on));

  // ---------- 2. pause and close with ordering_enabled = true (085000) ----------
  const availability = (await customer0.c.rpc('commerce_availability', { p_business_id: QA_CONTROL_BUSINESS, p_channel: 'delivery', p_context: {} })).data;
  const area = availability?.areas?.find((a) => a.name === ADDRESS.neighborhood);
  assert.ok(availability?.is_open && availability.ordering_ready && area, 'QA_BUSINESS_NOT_ORDERABLE_IN_WINDOW');
  const product = products[0];
  const qty = Math.max(1, Math.ceil((Number(area.minimum_subtotal || 0) + 1) / Number(product.price)));
  const stockBefore = await stockOf(product.id);
  const control = await attemptOrder(customer0, product.id, qty);
  pass('ORDER_ACCEPTED_WHEN_OPEN_CONTROL', Boolean(control.id) && control.rows === 1, control.code);
  const stockHeld = await stockOf(product.id);

  const pause = await staff.c.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'paused' });
  const afterPause = (await owner.c.from('businesses').select('status,ordering_enabled').eq('id', QA_CONTROL_BUSINESS).single()).data;
  pass('BUSINESS_PAUSE_WITH_ORDERING_ENABLED', !pause.error && pause.data?.status === 'paused' && afterPause.status === 'paused' && afterPause.ordering_enabled === true, codeOf(pause));
  const pausedAvail = (await customer0.c.rpc('commerce_availability', { p_business_id: QA_CONTROL_BUSINESS, p_channel: 'delivery', p_context: {} })).data;
  pass('PAUSED_NOT_ORDERING_READY', pausedAvail?.ordering_ready === false && await publicRows(QA_CONTROL_BUSINESS) === 0);
  const customer1 = await newCustomer(2);
  const whilePaused = await attemptOrder(customer1, product.id, qty);
  pass('ORDER_REJECTED_WHEN_PAUSED', !whilePaused.id && whilePaused.rows === 0, whilePaused.code);

  const reopen = await staff.c.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'open' });
  pass('BUSINESS_REOPEN_AFTER_PAUSE', !reopen.error && reopen.data?.status === 'open', codeOf(reopen));
  const staffClose = await staff.c.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'closed' });
  pass('STAFF_CANNOT_CLOSE', staffClose.error?.code === '42501', codeOf(staffClose));
  const close = await owner.c.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'closed' });
  const afterClose = (await owner.c.from('businesses').select('status,ordering_enabled').eq('id', QA_CONTROL_BUSINESS).single()).data;
  pass('BUSINESS_CLOSE_WITH_ORDERING_ENABLED', !close.error && close.data?.status === 'closed' && afterClose.status === 'closed' && afterClose.ordering_enabled === true, codeOf(close));
  const whileClosed = await attemptOrder(customer1, product.id, qty);
  pass('ORDER_REJECTED_WHEN_CLOSED', !whileClosed.id && whileClosed.rows === 0, whileClosed.code);

  // ---------- 3. PAUSE ALL SYSTEM (runbook §8, steps 1, 2 and 4) ----------
  const reopen2 = await staff.c.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'open' });
  assert.ok(!reopen2.error, `REOPEN_FOR_DRILL:${codeOf(reopen2)}`);
  rider = await operator('CP QA RIDER 1', 'rider1', 'rider_android');
  assert.equal(rider.role, 'rider', 'RIDER_ROLE_REQUIRED');
  let board = (await rider.c.rpc('get_rider_delivery_board', {})).data;
  const riderOn = await rider.c.rpc('set_rider_availability', { p_business_id: QA_CONTROL_BUSINESS, p_available: true,
    p_expected_version: board?.availability_version || 0, p_idempotency_key: `verify-on-${randomUUID()}` });
  assert.ok(riderOn.data?.ok, `RIDER_ON:${codeOf(riderOn)}`);
  const step1 = await staff.c.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'paused' });
  board = (await rider.c.rpc('get_rider_delivery_board', {})).data;
  const step2 = await rider.c.rpc('set_rider_availability', { p_business_id: QA_CONTROL_BUSINESS, p_available: false,
    p_expected_version: board?.availability_version || 0, p_idempotency_key: `verify-off-${randomUUID()}` });
  const riderAfter = (await rider.c.rpc('get_rider_delivery_board', {})).data;
  const blocked = await attemptOrder(customer1, product.id, qty);
  const current = (await staff.c.from('orders').select('status,revision').eq('id', control.id).single()).data;
  const cancel = await staff.c.rpc('cancel_order', { p_order_id: control.id, p_expected_revision: current.revision,
    p_reason: 'QA PAUSE ALL SYSTEM: pedido activo cancelado', p_idempotency_key: `verify_cancel_${control.id.replaceAll('-', '')}` });
  const cancelAgain = await staff.c.rpc('cancel_order', { p_order_id: control.id, p_expected_revision: current.revision,
    p_reason: 'QA PAUSE ALL SYSTEM: pedido activo cancelado', p_idempotency_key: `verify_cancel_${control.id.replaceAll('-', '')}` });
  const stockAfterCancel = await stockOf(product.id);
  report.pauseAll = { pause: codeOf(step1), riderOff: codeOf(step2), riderAvailable: riderAfter?.available ?? null,
    newOrder: blocked.code, cancel: codeOf(cancel), cancelReplay: codeOf(cancelAgain),
    stock: { before: stockBefore, held: stockHeld, afterCancel: stockAfterCancel, qty } };
  pass('PAUSE_ALL_SYSTEM', !step1.error && step1.data?.status === 'paused' && step2.data?.ok && riderAfter?.available === false
    && !blocked.id && blocked.rows === 0 && !cancel.error && !cancelAgain.error
    && stockHeld === stockBefore - qty && stockAfterCancel === stockBefore);
  pass('CANCEL_STOCK_RETURNED_ONCE', stockAfterCancel === stockBefore, `${stockBefore}->${stockHeld}->${stockAfterCancel}`);

  // ---------- 4. close the window normally ----------
  const closed = await owner.c.rpc('close_qa_window', { p_business_id: QA_CONTROL_BUSINESS });
  const s4 = await publicState();
  pass('QA_WINDOW_CLOSE', !closed.error && s4.status === 'closed' && !s4.qa_window_until && await publicRows(QA_CONTROL_BUSINESS) === 0, codeOf(closed));

  // ---------- 5. guards ----------
  const g1 = await owner.c.from('businesses').update({ qa_window_until: '2099-01-01T00:00:00Z' }).eq('id', QA_CONTROL_BUSINESS).select('id');
  pass('QA_WINDOW_NOT_EDITABLE_BY_API', Boolean(g1.error) || (g1.data || []).length === 0, g1.error?.code || `rows=${(g1.data || []).length}`);
  const g2 = await owner.c.from('businesses').update({ qa_fixture: false }).eq('id', QA_CONTROL_BUSINESS).select('id');
  pass('QA_FIXTURE_NOT_EDITABLE_BY_API', Boolean(g2.error) || (g2.data || []).length === 0, g2.error?.code || `rows=${(g2.data || []).length}`);
  const g3 = await owner.c.rpc('open_qa_window', { p_business_id: REAL_BUSINESS, p_minutes: 5 });
  pass('QA_WINDOW_REFUSES_REAL_BUSINESS', g3.error?.code === '42501', codeOf(g3));
  const g4 = await owner.c.rpc('open_qa_window', { p_business_id: QA_CONTROL_BUSINESS, p_minutes: 61 });
  pass('QA_WINDOW_MAX_60_MIN', g4.error?.code === '22023', codeOf(g4));
  const g5 = await anon.rpc('open_qa_window', { p_business_id: QA_CONTROL_BUSINESS, p_minutes: 5 });
  pass('QA_WINDOW_NOT_FOR_ANON', Boolean(g5.error), codeOf(g5));
  const g6 = await staff.c.rpc('open_qa_window', { p_business_id: QA_CONTROL_BUSINESS, p_minutes: 5 });
  pass('QA_WINDOW_NOT_FOR_STAFF', g6.error?.code === '42501', codeOf(g6));
  const s5 = await publicState();
  assert.equal(s5.status, 'closed', 'GUARDS_LEFT_QA_OPEN');

  // ---------- 6. runner killed with the window open: the server expires it ----------
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--crash-child'], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const opened = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(Error('CRASH_CHILD_NO_WINDOW')), 60_000);
    child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(buf.split('\n')[0])); } });
  });
  const openedAt = Date.now();
  child.kill('SIGKILL');
  report.crash = { childOpened: opened.opened, childCode: opened.code, until: opened.until, killed: true };
  const exposedAtOpen = await publicRows(QA_CONTROL_BUSINESS);
  let hiddenAfterMs = null; let closedAfterMs = null;
  while (Date.now() - openedAt < 240_000 && closedAfterMs === null) {
    await sleep(5_000);
    const rows = await publicRows(QA_CONTROL_BUSINESS);
    if (hiddenAfterMs === null && rows === 0) hiddenAfterMs = Date.now() - openedAt;
    const st = await publicState();
    if (st.status === 'closed' && !st.qa_window_until) closedAfterMs = Date.now() - openedAt;
  }
  report.crash = { ...report.crash, exposedAtOpen, hiddenAfterSeconds: hiddenAfterMs && Math.round(hiddenAfterMs / 1000), closedByCronAfterSeconds: closedAfterMs && Math.round(closedAfterMs / 1000) };
  pass('QA_WINDOW_EXPIRES_SERVER_SIDE', opened.opened && exposedAtOpen > 0 && hiddenAfterMs !== null && hiddenAfterMs <= 90_000 && closedAfterMs !== null && closedAfterMs <= 180_000,
    `hidden=${report.crash.hiddenAfterSeconds}s closed=${report.crash.closedByCronAfterSeconds}s`);
  const s6 = await publicState();
  set('QA_TENANT_AFTER_EXPIRY', s6.status === 'closed' && !s6.qa_window_until ? 'CLOSED' : s6.status.toUpperCase());

  // ---------- 7. opened from the Panel without a window: not public, cron closes it ----------
  const panelOpen = await staff.c.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'open' });
  const panelOpenAt = Date.now();
  const rowsNoWindow = await publicRows(QA_CONTROL_BUSINESS);
  pass('QA_OPEN_WITHOUT_WINDOW_NOT_PUBLIC', !panelOpen.error && rowsNoWindow === 0, `${codeOf(panelOpen)} rows=${rowsNoWindow}`);
  let cronClosedMs = null;
  while (Date.now() - panelOpenAt < 150_000 && cronClosedMs === null) {
    await sleep(5_000);
    if ((await publicState()).status === 'closed') cronClosedMs = Date.now() - panelOpenAt;
  }
  pass('QA_OPEN_WITHOUT_WINDOW_CLOSED_BY_CRON', cronClosedMs !== null && cronClosedMs <= 120_000, `closed=${cronClosedMs && Math.round(cronClosedMs / 1000)}s`);
} catch (error) {
  report.error = error.message;
  log(`ERROR ${error.message}`);
} finally {
  const cleanup = { orders: [], failures: [] };
  if (hiddenSku) await owner.c.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: hiddenSku, p_publish: true });
  if (rider) {
    const board = (await rider.c.rpc('get_rider_delivery_board', {})).data;
    if (board) await rider.c.rpc('set_rider_availability', { p_business_id: QA_CONTROL_BUSINESS, p_available: false,
      p_expected_version: board.availability_version || 0, p_idempotency_key: `verify-final-off-${randomUUID()}` });
  }
  // Cancelling needs the tenant reachable by the Panel; close_qa_window below leaves it closed.
  for (const id of createdOrders) {
    try { cleanup.orders.push(await cleanupQaOrder({ admin: owner.c, owner: owner.c, staff: staff.c, businessId: QA_CONTROL_BUSINESS, orderId: id, reason: 'QA verificación migraciones' })); }
    catch (error) { cleanup.failures.push(error.message); }
  }
  const finalClose = await owner.c.rpc('close_qa_window', { p_business_id: QA_CONTROL_BUSINESS });
  const sEnd = await publicState();
  const foreign = foreignPublicTenants(await publicCatalogTenants(anon), REAL_BUSINESS);
  const residue = (await owner.c.from('orders').select('id,status,origin').eq('business_id', QA_CONTROL_BUSINESS).eq('customer_notes', NOTES)).data || [];
  const stock = (await staff.c.from('products').select('sku,stock,available').eq('business_id', QA_CONTROL_BUSINESS)).data || [];
  report.cleanup = { ...cleanup, finalClose: codeOf(finalClose), finalStatus: sEnd.status, finalWindow: sEnd.qa_window_until,
    ordersCreated: createdOrders.length, openResidue: residue.filter((o) => !['canceled', 'cancelled', 'delivered', 'rejected'].includes(o.status) || o.origin !== 'qa').length,
    productsPublished: stock.filter((p) => p.available).length, stockAll60: stock.every((p) => Number(p.stock) === 60) };
  report.checks.FOREIGN_PUBLIC_CATALOG = foreign.length;
  report.checks.QA_RESIDUE = report.cleanup.openResidue + cleanup.failures.length + (sEnd.status === 'closed' ? 0 : 1);
  const failed = Object.entries(report.checks).filter(([, v]) => v === 'FAIL' || v === 'EXPOSED');
  report.verdict = !report.error && !failed.length && foreign.length === 0 && report.checks.QA_RESIDUE === 0 ? 'PASS' : 'FAIL';
  report.failed = failed.map(([k]) => k);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, verdict: report.verdict, failed: report.failed, error: report.error || null }));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}
