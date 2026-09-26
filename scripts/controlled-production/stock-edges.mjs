// Stock edge cases with a real anonymous customer: asking for more than the
// stock (e.g. a cart that outlived a stock change) and ordering a product that
// is not published must be refused without touching stock or creating orders.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { openQaWindow } from './qa-window.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const TARGET = opt('--target');
const business = opt('--business-id', TARGET === 'staging' ? 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0' : '');
const address = TARGET === 'staging'
  ? { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 }
  : { neighborhood: opt('--neighborhood'), city: opt('--city', 'Neuquén Capital'), lat: Number(opt('--lat')), lng: Number(opt('--lng')) };
const OUT = opt('--out', `artifacts/controlled-production/stock-edges-${TARGET}-${Date.now()}.json`);
const keys = await loadTargetKeys(TARGET);
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(keys.url, keys.secret, OPTIONS);
const customer = createClient(keys.url, keys.publishable, OPTIONS);
assert.ok((await customer.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } })).data?.session, 'ANON_SIGNIN_FAILED');
assert.ifError((await customer.rpc('upsert_current_customer_profile', { p_name: 'QA Stock', p_phone: '2995550401' })).error);
const saved = await customer.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Stock', streetNumber: '401',
  city: address.city, neighborhood: address.neighborhood, latitude: address.lat, longitude: address.lng, geolocationAccuracy: 10,
  source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
assert.ifError(saved.error);
const all = (await admin.from('products').select('id,sku,price,stock,available,is_active,is_verified,is_alcoholic').eq('business_id', business)).data;
const published = all.filter((p) => p.available && p.is_active && p.is_verified && !p.is_alcoholic && p.stock > 0 && p.price > 0);
let hidden = all.find((p) => !p.available && p.price > 0);
const order = (items) => customer.rpc('create_order_with_items', { payload: { business_id: business, client_request_id: randomUUID(),
  tracking_token: randomBytes(32).toString('base64url'), items, customer_name: 'QA Stock', customer_phone: '2995550401',
  delivery_mode: 'delivery', payment_method: 'cash', age_confirmed: true, customer_address_id: saved.data.address.id,
  customer_street_address: 'Calle Stock 401', customer_neighborhood: address.neighborhood, customer_notes: 'QA stock edges — no despachar' } });
// Owner session (optional on Staging, required on CP to open the QA window).
async function ownerSession() {
  const { readQaCredential } = await import('./qa-credentials.mjs');
  const stored = readQaCredential(opt('--owner-credential'));
  const c = createClient(keys.url, keys.publishable, OPTIONS);
  assert.ok(!(await c.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto })).error, 'OWNER_LOGIN');
  await c.rpc('identity_register_session', { p_business_id: business, p_client: 'panel_web', p_device_label: 'QA stock edges',
    p_device_key_hash: null, p_app_version: 'cp-qa' });
  return c;
}
assert.ok(TARGET !== 'controlled-production' || opt('--owner-credential'), 'OWNER_CREDENTIAL_REQUIRED_FOR_QA_WINDOW');
const owner = opt('--owner-credential') ? await ownerSession() : null;
// CP: the QA tenant is closed outside QA runs; open it for this run only.
const qaWindow = TARGET === 'controlled-production' ? await openQaWindow(owner, business) : null;
const stockOf = async (id) => Number((await admin.from('products').select('stock').eq('id', id).single()).data.stock);
const report = { timestamp: new Date().toISOString(), target: TARGET, project: keys.ref, checks: {} };
try {
  const target = published[0];
  const before = await stockOf(target.id);
  const over = await order([{ product_id: target.id, quantity: before + 1 }]);
  report.checks.MORE_THAN_STOCK_REFUSED = Boolean(over.error) && await stockOf(target.id) === before ? 'PASS' : 'FAIL';
  report.checks.MORE_THAN_STOCK_CODE = over.error?.code || 'accepted';
  // No hidden product: hide one temporarily with the owner's RPC and restore it.
  let restoreHidden = null;
  if (!hidden && owner) {
    const victim = published[published.length - 1];
    const off = await owner.rpc('set_commercial_product_publication', { p_business_id: business, p_sku: victim.sku, p_publish: false });
    assert.ifError(off.error);
    hidden = { ...victim, available: false };
    restoreHidden = async () => {
      const on = await owner.rpc('set_commercial_product_publication', { p_business_id: business, p_sku: victim.sku, p_publish: true });
      report.checks.HIDDEN_PRODUCT_RESTORED = !on.error && (await admin.from('products').select('available').eq('id', victim.id).single()).data.available ? 'PASS' : 'FAIL';
    };
  }
  if (hidden) {
    const hiddenBefore = await stockOf(hidden.id);
    const r = await order([{ product_id: hidden.id, quantity: 1 }]);
    report.checks.UNPUBLISHED_PRODUCT_REFUSED = Boolean(r.error) && await stockOf(hidden.id) === hiddenBefore ? 'PASS' : 'FAIL';
    report.checks.UNPUBLISHED_PRODUCT_CODE = r.error?.code || 'accepted';
  } else report.checks.UNPUBLISHED_PRODUCT_REFUSED = 'NOT_RUN_NO_HIDDEN_PRODUCT';
  if (restoreHidden) await restoreHidden();
  const mixed = await order([{ product_id: target.id, quantity: 1 }, { product_id: published[1].id, quantity: Number(published[1].stock) + 1 }]);
  report.checks.PARTIAL_CART_ALL_OR_NOTHING = Boolean(mixed.error) && await stockOf(target.id) === before ? 'PASS' : 'FAIL';
  const leaked = await admin.from('orders').select('id').eq('business_id', business).eq('customer_notes', 'QA stock edges — no despachar');
  report.checks.NO_ORDER_CREATED = (leaked.data || []).length === 0 ? 'PASS' : 'FAIL';
} finally {
  if (qaWindow) await qaWindow.close();
}
report.verdict = Object.entries(report.checks).filter(([k]) => !k.endsWith('_CODE')).every(([, v]) => v === 'PASS' || v.startsWith('NOT_RUN')) ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exit(report.verdict === 'PASS' ? 0 : 1);
