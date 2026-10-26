// Marketplace verification in QA with a SECOND test seller (production topology: an integrator application owned by
// one account, a different seller that connects by OAuth, a buyer). Today's evidence cannot show it: the QA seller is
// also the owner of the integrator application TestApp-ae01fd1d, so Mercado Pago marks its preferences
// `marketplace: NONE` and a webhook `user_id` cannot be told apart between "seller" and "application owner".
//
//   node scripts/recovery/qa-mp-marketplace.mjs preflight [--seller <id>]   read-only readiness report
//   node scripts/recovery/qa-mp-marketplace.mjs snapshot --out <file>   read-only counts (orders, payment intents, stock) of both tenants; take it BEFORE the payment
//   node scripts/recovery/qa-mp-marketplace.mjs verify --session <id> --seller <id> [--baseline <file>]   read-only evidence after a payment; with a baseline it also proves orders, intents and stock moved in tenant B only
//   node scripts/recovery/qa-mp-marketplace.mjs prepare [--apply]   makes QA tenant B able to sell ONE synthetic product (dry run unless --apply)
//
// Nothing here creates Mercado Pago accounts, connects a seller, pays or refunds. The runbook
// (docs/audit/mercadopago-final-20261023/lanzamiento/VERIFICACION-MARKETPLACE.md) marks which steps need authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_QA } from './provision-qa-ids.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx', app = RECOVERY_TEST_APPLICATION_ID;
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const command = process.argv[2];
assert.ok(['preflight', 'verify', 'prepare', 'snapshot'].includes(command), 'preflight | verify | prepare | snapshot');
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario, ref);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
const has = (name) => { try { return Boolean(leerSecreto(name)?.secreto); } catch { return false; } };

async function mp(token, path) {
  const r = await fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  let body = null; try { body = await r.json(); } catch { /* not JSON */ }
  return { http: r.status, requestId: r.headers.get('x-request-id'), body };
}
async function integratorOwner() {
  const secret = leerSecreto('RECOVERY MP TESTAPP CLIENT SECRET')?.secreto;
  assert.ok(secret, 'TestApp client secret unavailable');
  const grant = await (await fetch('https://api.mercadopago.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: app, client_secret: secret }), signal: AbortSignal.timeout(15000) })).json();
  const me = (await mp(grant.access_token, '/users/me')).body;
  return { id: String(me.id), test_user: Array.isArray(me.tags) && me.tags.includes('test_user') };
}
async function sellerToken(businessId) {
  const { data: c } = await db.from('mp_seller_connections').select('application_id,seller_id,protected_tokens,status').eq('business_id', businessId).eq('environment', 'test').maybeSingle();
  if (!c || c.status !== 'connected') return null;
  assert.equal(c.application_id, app);
  const [, iv, ciphertext] = c.protected_tokens.split('.');
  const key = await crypto.subtle.importKey('raw', Buffer.from(leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY').secreto, 'base64url'), 'AES-GCM', false, ['decrypt']);
  const token = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64url'), additionalData: Buffer.from(`${ref}:test:${app}:${businessId}:tokens`) }, key, Buffer.from(ciphertext, 'base64url')))).access_token;
  return { seller_id: String(c.seller_id), token };
}

// Counts per tenant: the baseline that lets `verify` prove that a payment of tenant B moved nothing in tenant A.
async function tenantCounts() {
  const out = {};
  for (const [name, id] of Object.entries(RECOVERY_QA)) {
    const { count: orders } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('business_id', id);
    const { count: intents } = await db.from('payment_intents').select('*', { count: 'exact', head: true }).eq('business_id', id);
    const { data: products } = await db.from('products').select('sku,stock').eq('business_id', id).order('sku');
    out[name] = { orders, payment_intents: intents, stock: Object.fromEntries((products || []).map((p) => [p.sku, p.stock])) };
  }
  return out;
}

if (command === 'snapshot') {
  const file = arg('--out');
  assert.ok(file, '--out <file> is required');
  const counts = { at: new Date().toISOString(), tenants: await tenantCounts() };
  fs.writeFileSync(file, JSON.stringify(counts, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(counts, null, 2));
}

if (command === 'preflight') {
  const owner = await integratorOwner();
  const tenants = {};
  for (const [name, id] of Object.entries(RECOVERY_QA)) {
    const { data: b } = await db.from('businesses').select('*').eq('id', id).maybeSingle();
    const { count: products } = await db.from('products').select('*', { count: 'exact', head: true }).eq('business_id', id);
    const { data: conn } = await db.from('mp_seller_connections').select('status,seller_id,application_id').eq('business_id', id).eq('environment', 'test').maybeSingle();
    tenants[name] = { exists: Boolean(b), status: b?.status ?? null, is_active: b?.is_active ?? null, ordering_enabled: b?.ordering_enabled ?? null,
      ordering_verified: b?.ordering_verified ?? null, products, connection: conn ? pick(conn, ['status', 'seller_id', 'application_id']) : null };
  }
  const sellerA = tenants.a.connection?.seller_id ?? null;
  const wanted = arg('--seller');
  const report = {
    integrator_application: app, integrator_owner: owner,
    tenants,
    credentials_available: { buyer: has('RECOVERY MP TEST BUYER'), owner_b: has('RECOVERY QA OWNER B'), seller_b: has('RECOVERY MP TEST SELLER B') },
    seller_b_candidate: wanted ? { id: wanted, differs_from_integrator_owner: wanted !== owner.id, differs_from_seller_a: wanted !== sellerA } : null,
    blockers: [],
  };
  if (!owner.test_user) report.blockers.push('integrator owner is not a test user: QA payments would fail (2034)');
  if (!tenants.b.exists) report.blockers.push('QA tenant B does not exist');
  if (!(tenants.b.products > 0)) report.blockers.push('tenant B has no product to sell (create QA-MKT-001 in the authorized step)');
  if (tenants.b.connection?.status === 'connected') report.blockers.push('tenant B already has a connected seller: reconnecting changes it; confirm intent');
  report.needs_authorization = [
    'create ONE test account of type Vendedor in TestApp > Cuentas de prueba (limit 15, not deletable)',
    'store its login in Credential Manager as «RECOVERY MP TEST SELLER B»',
    'seller B consents to TestApp (OAuth) for tenant B',
    'one APRO purchase of ARS 100 by the QA buyer in tenant B',
  ];
  if (wanted && wanted === owner.id) report.blockers.push('the second seller must NOT be the owner of the integrator application');
  console.log(JSON.stringify(report, null, 2));
}

if (command === 'verify') {
  const session = arg('--session'), sellerB = arg('--seller');
  assert.match(session || '', /^[0-9a-f-]{36}$/); assert.match(sellerB || '', /^\d+$/);
  const owner = await integratorOwner();
  assert.notEqual(sellerB, owner.id, 'the second seller must differ from the integrator application owner');
  const { data: intent } = await db.from('payment_intents').select('id,business_id,environment,preference_id,internal_status,provider_status,provider_payment_id,order_id').eq('checkout_session_id', session).single();
  assert.equal(intent.business_id, RECOVERY_QA.b, 'the session must belong to tenant B');
  const b = await sellerToken(RECOVERY_QA.b), a = await sellerToken(RECOVERY_QA.a);
  assert.ok(b, 'tenant B has no connected seller');
  assert.equal(b.seller_id, sellerB);
  const pref = (await mp(b.token, `/checkout/preferences/${intent.preference_id}`)).body;
  const reference = `taba2:checkout:${session}`;
  const bView = (await mp(b.token, `/v1/payments/search?${new URLSearchParams({ external_reference: reference })}`)).body;
  const aView = a ? (await mp(a.token, `/v1/payments/search?${new URLSearchParams({ external_reference: reference })}`)).body : null;
  const payment = intent.provider_payment_id ? (await mp(b.token, `/v1/payments/${intent.provider_payment_id}`)).body : null;
  const aDirect = a && intent.provider_payment_id ? await mp(a.token, `/v1/payments/${intent.provider_payment_id}`) : null;
  const { data: receipts } = await db.from('payment_webhook_receipts').select('event_type,resource_id,signature_valid,processing_status,seller_business_id').eq('resource_id', String(intent.provider_payment_id ?? ''));
  const { count: ordersB } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('business_id', RECOVERY_QA.b);
  const { count: ordersAForRef } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('business_id', RECOVERY_QA.a).eq('id', intent.order_id ?? '00000000-0000-0000-0000-000000000000');
  // With a baseline (taken before the payment): the purchase moved orders, intents and stock in tenant B ONLY.
  const baselineFile = arg('--baseline');
  let isolation = null;
  if (baselineFile) {
    const before = JSON.parse(fs.readFileSync(baselineFile, 'utf8')).tenants, after = await tenantCounts();
    isolation = {
      tenant_a_unchanged: JSON.stringify(before.a) === JSON.stringify(after.a),
      tenant_b_one_order: after.b.orders === before.b.orders + 1,
      tenant_b_one_intent: after.b.payment_intents === before.b.payment_intents + 1,
      tenant_b_stock_down_by_purchase: Object.entries(before.b.stock).some(([sku, stock]) => after.b.stock[sku] < stock)
        && Object.entries(before.b.stock).every(([sku, stock]) => after.b.stock[sku] <= stock),
    };
  }
  const checks = {
    ...(isolation ?? {}),
    preference_collector_is_seller_b: String(pref.collector_id) === sellerB,
    preference_client_is_testapp: String(pref.client_id) === app,
    preference_is_marketplace: String(pref.marketplace) === `MP-MKT-${app}`,
    payment_collector_is_seller_b: payment ? String(payment.collector_id) === sellerB : null,
    payment_approved: payment ? payment.status === 'approved' : null,
    seller_a_cannot_search_it: aView ? (aView.paging?.total ?? aView.results?.length ?? 0) === 0 : null,
    seller_a_cannot_read_it: aDirect ? [403, 404].includes(aDirect.http) : null,
    webhook_valid_and_routed_to_b: (receipts || []).some((r) => r.signature_valid && r.seller_business_id === RECOVERY_QA.b),
    order_in_b_only: Boolean(intent.order_id) && ordersAForRef === 0,
  };
  console.log(JSON.stringify({ at: new Date().toISOString(), session, integrator_owner: owner.id, seller_b: sellerB,
    intent: pick(intent, ['internal_status', 'provider_status', 'provider_payment_id', 'order_id']),
    preference: pick(pref, ['collector_id', 'client_id', 'marketplace', 'marketplace_fee', 'site_id']),
    payment: payment && pick(payment, ['status', 'status_detail', 'collector_id', 'live_mode', 'marketplace_owner', 'application_id']),
    seller_a_read_http: aDirect?.http ?? null, webhook_receipts: (receipts || []).map((r) => pick(r, ['event_type', 'signature_valid', 'processing_status'])),
    orders_in_tenant_b: ordersB, checks, all_pass: Object.values(checks).every((v) => v === true || v === null) }, null, 2));
}

if (command === 'prepare') {
  // QA tenant B is the closed isolation tenant: not enabled for ordering and without products. Selling through it needs
  // the same fixture state tenant A has. Only QA tenant B is touched; it stays `closed` outside a QA window.
  const apply = process.argv.includes('--apply');
  const { data: member } = await db.from('business_members').select('user_id,role').eq('business_id', RECOVERY_QA.b).in('role', ['owner']).limit(1).maybeSingle();
  assert.ok(member?.user_id, 'tenant B has no owner');
  const { data: business } = await db.from('businesses').select('qa_fixture,status,ordering_enabled,ordering_verified').eq('id', RECOVERY_QA.b).single();
  assert.equal(business.qa_fixture, true, 'only a QA fixture tenant may be prepared');
  const { data: existing } = await db.from('products').select('id').eq('business_id', RECOVERY_QA.b).eq('sku', 'QA-MKT-001').maybeSingle();
  const plan = { tenant: 'b', before: business, set: { ordering_enabled: true, ordering_verified: true, ordering_verified_by: 'owner of tenant B' },
    product: existing ? 'QA-MKT-001 already exists' : 'insert QA-MKT-001, ARS 100, stock 5', apply };
  if (apply) {
    const { error: e1 } = await db.from('businesses').update({ ordering_enabled: true, ordering_verified: true, ordering_verified_at: new Date().toISOString(), ordering_verified_by: member.user_id }).eq('id', RECOVERY_QA.b).eq('qa_fixture', true);
    assert.ifError(e1);
    if (!existing) {
      const { error: e2 } = await db.from('products').insert({ business_id: RECOVERY_QA.b, sku: 'QA-MKT-001', name: 'QA Producto marketplace', price: 100, stock: 5,
        external_id: 'QA-MKT-001', brand: 'QA', category: 'Almacén', subcategory: 'QA', is_alcoholic: false, minimum_age: null, variant: 'unidad', presentation: 'unidad',
        capacity_value: 1, capacity_unit: 'unidad', capacity: '1 unidad', packaging_type: 'unidad', units_per_pack: 1, sort_order: 1,
        description: 'Producto sintético de QA, no es un producto real', is_active: true, available: true, merchant_available: true, is_verified: true,
        verified_at: new Date().toISOString(), verified_by: member.user_id, catalog_origin: 'commercial', price_status: 'confirmed' });
      assert.ifError(e2);
    }
  }
  console.log(JSON.stringify(plan, null, 2));
}

function pick(o, keys) { return Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]])); }
