// The literal last unit, on CONTROLLED_PRODUCTION's QA tenant: the owner leaves
// one unit of a product with the Panel's audited stock adjustment, two anonymous
// customers order it at the same instant (pickup, one unit each), a third tries
// afterwards, the winner is cancelled twice with the same key and once with
// another, and the owner puts the stock back. Real sessions, no secret key, no
// SQL. Everything is audited, cancelled, classified QA and the window closed.
//
//   node scripts/controlled-production/last-unit-race.mjs --target controlled-production [--out file]
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { readQaCredential } from './qa-credentials.mjs';
import { signIn } from './accounts.mjs';
import { cleanupQaOrder } from './qa-cleanup.mjs';
import { QA_CONTROL_BUSINESS, openQaWindow } from './qa-window.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
assert.equal(opt('--target'), 'controlled-production', 'EXPLICIT_TARGET_REQUIRED');
const OUT = opt('--out', `artifacts/controlled-production/last-unit-race-${Date.now()}.json`);
const NOTES = 'QA última unidad — no despachar';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const keys = await loadTargetKeys('controlled-production', { requireSecret: false });
const client = () => createClient(keys.url, keys.publishable, OPTIONS);
const compact = (id) => id.replaceAll('-', '');
const codeOf = (r) => r?.error?.code || (r?.data?.ok === false ? (r.data.code || 'refused') : 'ok');

async function operator(credential, label) {
  const stored = readQaCredential(credential);
  assert.ok(stored?.secreto, `QA_CREDENTIAL_REQUIRED:${credential}`);
  const c = client();
  await signIn(c, stored.usuario, stored.secreto);
  const reg = await c.rpc('identity_register_session', { p_business_id: QA_CONTROL_BUSINESS, p_client: 'panel_web',
    p_device_label: `CP last unit ${label}`, p_device_key_hash: null, p_app_version: 'cp-last-unit' });
  assert.ok(reg.data?.ok, `SESSION_REFUSED:${label}:${codeOf(reg)}`);
  return c;
}
async function customer(k) {
  const c = client();
  assert.ok((await c.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } })).data?.session, 'ANON_SIGNIN_FAILED');
  assert.ifError((await c.rpc('upsert_current_customer_profile', { p_name: `QA Ultima ${k}`, p_phone: `29955504${String(k).padStart(2, '0')}` })).error);
  return { c, k };
}
const pickup = (cust, productId) => ({ business_id: QA_CONTROL_BUSINESS, client_request_id: randomUUID(),
  tracking_token: randomBytes(32).toString('base64url'), items: [{ product_id: productId, quantity: 1 }],
  customer_name: `QA Ultima ${cust.k}`, customer_phone: `29955504${String(cust.k).padStart(2, '0')}`,
  delivery_mode: 'pickup', payment_method: 'cash', age_confirmed: true, customer_notes: NOTES });

const owner = await operator('CP QA OWNER', 'owner');
const staff = await operator('CP QA STAFF', 'staff');
const report = { at: new Date().toISOString(), ref: keys.ref, business: QA_CONTROL_BUSINESS, checks: {}, observed: {} };
const stockOf = async (id) => Number((await staff.from('products').select('stock').eq('id', id).single()).data.stock);
const move = (productId, quantity, direction, tag) => owner.rpc('apply_inventory_movement', { p_business_id: QA_CONTROL_BUSINESS,
  p_product_id: productId, p_barcode_id: null, p_movement_type: 'manual_adjustment', p_package_quantity: quantity,
  p_direction: direction, p_reference_type: 'pilot_qa_last_unit', p_reference_id: null,
  p_reason: `QA última unidad: ${tag}`, p_idempotency_key: `qa_last_unit_${tag}_${Date.now()}` });
const window = await openQaWindow(owner, QA_CONTROL_BUSINESS);
const created = [];
let product = null;
let initial = null;
try {
  product = (await staff.from('products').select('id,sku,price,stock').eq('business_id', QA_CONTROL_BUSINESS)
    .eq('available', true).eq('is_active', true).eq('is_verified', true).eq('is_alcoholic', false)
    .order('price', { ascending: false }).limit(1).single()).data;
  initial = Number(product.stock);
  assert.ok(initial >= 2, 'NEED_STOCK_TO_LEAVE_ONE');
  const down = await move(product.id, initial - 1, -1, 'dejar_una');
  report.observed.adjustDown = codeOf(down);
  report.checks.LAST_UNIT_SET = !down.error && await stockOf(product.id) === 1 ? 'PASS' : 'FAIL';

  const [a, b] = [await customer(1), await customer(2)];
  const [pa, pb] = [pickup(a, product.id), pickup(b, product.id)];
  const [ra, rb] = await Promise.all([a.c.rpc('create_order_with_items', { payload: pa }), b.c.rpc('create_order_with_items', { payload: pb })]);
  const winners = [ra, rb].filter((r) => (Array.isArray(r.data) ? r.data[0] : r.data)?.id);
  for (const r of winners) created.push((Array.isArray(r.data) ? r.data[0] : r.data).id);
  const stockAfterRace = await stockOf(product.id);
  report.observed.race = { codes: [ra.error?.code || 'accepted', rb.error?.code || 'accepted'], winners: winners.length, stockAfterRace };
  report.checks.EXACTLY_ONE_WINNER = winners.length === 1 ? 'PASS' : 'FAIL';
  report.checks.NEGATIVE_STOCK = stockAfterRace < 0 ? 'FAIL' : 'PASS';
  report.checks.STOCK_ZERO_AFTER_RACE = stockAfterRace === 0 ? 'PASS' : 'FAIL';
  const c3 = await customer(3);
  const late = await c3.c.rpc('create_order_with_items', { payload: pickup(c3, product.id) });
  const lateRow = Array.isArray(late.data) ? late.data[0] : late.data;
  if (lateRow?.id) created.push(lateRow.id);
  report.observed.lateOrder = late.error?.code || 'accepted';
  report.checks.SOLD_OUT_REFUSED = !lateRow?.id && await stockOf(product.id) === 0 ? 'PASS' : 'FAIL';
  const rows = (await owner.from('orders').select('id,client_request_id').in('client_request_id', [pa.client_request_id, pb.client_request_id])).data || [];
  report.checks.DUPLICATE_ORDER = rows.length === 1 ? 'PASS' : 'FAIL';

  // Double cancellation of the winner: same key twice at once, then another key.
  const winner = created[0];
  const cur = (await staff.from('orders').select('status,revision').eq('id', winner).single()).data;
  const cancelArgs = { p_order_id: winner, p_expected_revision: cur.revision, p_reason: 'QA última unidad: cancelación doble',
    p_idempotency_key: `qa_last_cancel_${compact(winner)}` };
  const [x, y] = await Promise.all([staff.rpc('cancel_order', cancelArgs), staff.rpc('cancel_order', cancelArgs)]);
  const z = await owner.rpc('cancel_order', { ...cancelArgs, p_idempotency_key: `qa_last_cancel2_${compact(winner)}` });
  const stockAfterCancel = await stockOf(product.id);
  report.observed.cancel = { codes: [codeOf(x), codeOf(y), codeOf(z)], stockAfterCancel };
  report.checks.DOUBLE_STOCK_RETURN = stockAfterCancel === 1 ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = error.message;
} finally {
  const cleanup = { orders: [], failures: [] };
  for (const id of created) {
    try { cleanup.orders.push(await cleanupQaOrder({ admin: owner, owner, staff, businessId: QA_CONTROL_BUSINESS, orderId: id, reason: 'QA ultima unidad' })); }
    catch (error) { cleanup.failures.push(error.message); }
  }
  if (product && initial !== null) {
    const now = await stockOf(product.id);
    if (now < initial) { const up = await move(product.id, initial - now, 1, 'restaurar'); cleanup.restore = codeOf(up); }
    cleanup.stockRestored = await stockOf(product.id) === initial;
    // Selling the last unit unpublishes the product and restoring stock does not
    // publish it again: the owner does it, as in the Panel.
    const published = (await staff.from('products').select('available').eq('id', product.id).single()).data?.available;
    if (!published) {
      const on = await owner.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: product.sku, p_publish: true });
      cleanup.republished = codeOf(on);
    }
    cleanup.publicationRestored = (await staff.from('products').select('available').eq('id', product.id).single()).data?.available === true;
  }
  try { await window.close(); cleanup.window = 'closed'; } catch (error) { cleanup.failures.push(`window:${error.message}`); }
  report.cleanup = cleanup;
  report.checks.CLEANUP = cleanup.failures.length === 0 && cleanup.stockRestored && cleanup.publicationRestored ? 'PASS' : 'FAIL';
  report.verdict = !report.error && Object.values(report.checks).every((v) => v === 'PASS') ? 'PASS' : 'FAIL';
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, verdict: report.verdict, checks: report.checks, observed: report.observed, error: report.error || null }));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}
