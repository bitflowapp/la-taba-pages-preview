// Marketplace verification in QA with a SECOND test seller (production topology: an integrator application owned by
// one account, a different seller that connects by OAuth, a buyer). Today's evidence cannot show it: the QA seller is
// also the owner of the integrator application TestApp-ae01fd1d, so Mercado Pago marks its preferences
// `marketplace: NONE` and a webhook `user_id` cannot be told apart between "seller" and "application owner".
//
//   node scripts/recovery/qa-mp-marketplace.mjs preflight [--seller <id>]   read-only readiness report
//   node scripts/recovery/qa-mp-marketplace.mjs identities --seller <idB> [--reserve <id>]   read-only: who owns the integrator application, who is seller A / the buyer, and whether B (and a standby) are valid distinct Argentine accounts
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
import { completeChecks, providerSearchEmpty, proveIsolation } from './marketplace-proof.mjs';

const ref = 'ixewllzzuzpqrkxzmfzx', app = RECOVERY_TEST_APPLICATION_ID;
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const command = process.argv[2];
assert.ok(['preflight', 'identities', 'verify', 'prepare', 'snapshot'].includes(command), 'preflight | identities | verify | prepare | snapshot');
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario, ref);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, { auth: { persistSession: false, autoRefreshToken: false } });
const has = (name) => { try { return Boolean(leerSecreto(name)?.secreto); } catch { return false; } };

async function mp(token, path) {
  const r = await fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  let body = null; try { body = await r.json(); } catch { /* not JSON */ }
  return { http: r.status, requestId: r.headers.get('x-request-id'), body };
}
async function appToken() {
  const secret = leerSecreto('RECOVERY MP TESTAPP CLIENT SECRET')?.secreto;
  assert.ok(secret, 'TestApp client secret unavailable');
  const grant = await (await fetch('https://api.mercadopago.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: app, client_secret: secret }), signal: AbortSignal.timeout(15000) })).json();
  assert.ok(grant.access_token, 'Mercado Pago did not grant the application token');
  return grant.access_token;
}
async function integratorOwner() {
  const me = (await mp(await appToken(), '/users/me')).body;
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
    const orders = await db.from('orders').select('*', { count: 'exact', head: true }).eq('business_id', id);
    const intents = await db.from('payment_intents').select('*', { count: 'exact', head: true }).eq('business_id', id);
    const products = await db.from('products').select('id,stock', { count: 'exact' }).eq('business_id', id).order('id');
    for (const response of [orders, intents, products]) assert.ifError(response.error);
    assert.ok(Number.isInteger(orders.count) && Number.isInteger(intents.count), 'tenant counts unavailable');
    assert.equal(products.data?.length, products.count, 'stock snapshot truncated');
    out[name] = { orders: orders.count, payment_intents: intents.count, stock: Object.fromEntries(products.data.map((p) => [p.id, p.stock])) };
  }
  return out;
}

if (command === 'snapshot') {
  const file = arg('--out');
  assert.ok(file, '--out <file> is required');
  const counts = { schemaVersion: 2, at: new Date().toISOString(), tenants: await tenantCounts() };
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
  if (tenants.b.connection?.status === 'connected' && tenants.b.connection.seller_id !== wanted) report.blockers.push('tenant B has another connected seller: do not reconnect or pay');
  report.needs_authorization = [
    'the existing test seller B consents to TestApp (OAuth) for tenant B in their own browser; no password sharing',
    'one APRO purchase of ARS 100 by the QA buyer in tenant B',
  ];
  if (wanted && wanted === owner.id) report.blockers.push('the second seller must NOT be the owner of the integrator application');
  console.log(JSON.stringify(report, null, 2));
}

if (command === 'identities') {
  // Read-only. Who is who before anything is paid: the owner of the integrator application, seller A (QA tenant A), the
  // buyer, and the candidate sellers B. Public account reads use the application's own token; no id is printed that
  // is not already in the repository documentation, and no token or password is ever printed.
  const sellerB = arg('--seller'), reserve = arg('--reserve');
  assert.match(sellerB || '', /^\d+$/, '--seller <id> is required');
  assert.ok(!reserve || /^\d+$/.test(reserve), '--reserve must be numeric');
  const token = await appToken();
  const owner = (await mp(token, '/users/me')).body;
  const direct = leerSecreto('RECOVERY MP TEST ACCESS TOKEN')?.secreto;
  const directMe = direct ? (await mp(direct, '/users/me')).body : null;
  const application = direct ? (await mp(direct, `/applications/${app}`)).body : null;
  const buyerStored = (() => { try { return JSON.parse(leerSecreto('RECOVERY MP TEST BUYER')?.secreto || '{}'); } catch { return {}; } })();
  const a = await sellerToken(RECOVERY_QA.a);
  const aMe = a ? (await mp(a.token, '/users/me')).body : null;
  const b = await sellerToken(RECOVERY_QA.b);
  const publicRead = async (id) => {
    const r = await mp(token, `/users/${id}`);
    return { http: r.http, exists: r.http === 200 && String(r.body?.id) === id, site_id: r.body?.site_id ?? null, country_id: r.body?.country_id ?? null, status: r.body?.status?.site_status ?? null };
  };
  const candidates = { seller_b: { id: sellerB, ...(await publicRead(sellerB)) } };
  if (reserve) candidates.standby = { id: reserve, ...(await publicRead(reserve)) };
  const ownerId = String(owner.id), buyerId = String(buyerStored.id ?? '');
  const checks = {
    integrator_owner_is_test_user: Array.isArray(owner.tags) && owner.tags.includes('test_user'),
    integrator_application_is_testapp: String(application?.id) === app,
    direct_test_token_belongs_to_owner: directMe ? String(directMe.id) === ownerId : null,
    tenant_a_oauth_seller_is_owner: aMe ? String(aMe.id) === ownerId && a.seller_id === ownerId : null,
    buyer_is_a_different_account: Boolean(buyerId) && buyerId !== ownerId,
    seller_b_exists_ar: candidates.seller_b.exists && candidates.seller_b.site_id === 'MLA' && candidates.seller_b.country_id === 'AR',
    seller_b_differs_from_owner: sellerB !== ownerId,
    seller_b_differs_from_seller_a: sellerB !== (a?.seller_id ?? ownerId),
    seller_b_differs_from_buyer: sellerB !== buyerId,
    ...(reserve ? {
      standby_exists_ar: candidates.standby.exists && candidates.standby.site_id === 'MLA' && candidates.standby.country_id === 'AR',
      standby_differs_from_everyone: ![ownerId, buyerId, sellerB].includes(reserve),
    } : {}),
  };
  console.log(JSON.stringify({
    at: new Date().toISOString(), integrator_application: { id: app, name: application?.name ?? null, owner_user_id: ownerId },
    seller_a: { tenant_a_seller_id: a?.seller_id ?? null, is_integrator_owner: a ? a.seller_id === ownerId : null,
      note: 'seller A is the owner of the integrator application: Mercado Pago marks its preferences marketplace=NONE and its webhook user_id cannot tell seller from owner (R-MKT-1)' },
    buyer: { id: buyerId || null }, candidates,
    tenant_b_connection: b ? { connected: true, seller_id: b.seller_id, is_candidate: b.seller_id === sellerB } : { connected: false },
    checks, all_pass: completeChecks(checks),
    cannot_prove_by_api: 'tags (test_user) of accounts other than the application owner are not exposed; the OAuth consent and the APRO card only work with test accounts',
  }, null, 2));
}

if (command === 'verify') {
  const session = arg('--session'), sellerB = arg('--seller');
  const baselineFile = arg('--baseline');
  assert.ok(baselineFile, '--baseline <snapshot taken BEFORE checkout> is required for certification');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
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
  const bView = await mp(b.token, `/v1/payments/search?${new URLSearchParams({ external_reference: reference })}`);
  const aView = a ? await mp(a.token, `/v1/payments/search?${new URLSearchParams({ external_reference: reference })}`) : null;
  const payment = intent.provider_payment_id ? (await mp(b.token, `/v1/payments/${intent.provider_payment_id}`)).body : null;
  const aDirect = a && intent.provider_payment_id ? await mp(a.token, `/v1/payments/${intent.provider_payment_id}`) : null;
  const { data: receipts, error: receiptsError } = await db.from('payment_webhook_receipts').select('event_type,resource_id,signature_valid,processing_status,seller_business_id').eq('environment', 'test').eq('resource_id', String(intent.provider_payment_id ?? ''));
  assert.ifError(receiptsError);
  const { count: ordersB } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('business_id', RECOVERY_QA.b);
  // With a baseline (taken before the payment): the purchase moved orders, intents and stock in tenant B ONLY.
  const read = async (query) => { const r = await query; assert.ifError(r.error); return r.data; };
  const checkout = await read(db.from('checkout_sessions').select('id,business_id,created_at,completed_order_id').eq('id', session).single());
  const items = await read(db.from('checkout_session_items').select('product_id,quantity').eq('checkout_session_id', session));
  const reservations = await read(db.from('inventory_reservations').select('checkout_session_id,product_id,quantity,status').eq('checkout_session_id', session));
  const order = intent.order_id ? await read(db.from('orders').select('id,business_id').eq('id', intent.order_id).maybeSingle()) : null;
  const isolation = proveIsolation({ baseline, after: await tenantCounts(), items, reservations, session: checkout,
    tenantA: RECOVERY_QA.a, tenantB: RECOVERY_QA.b, intent, order });
  const checks = {
    ...(isolation ?? {}),
    preference_collector_is_seller_b: String(pref.collector_id) === sellerB,
    preference_client_is_testapp: String(pref.client_id) === app,
    preference_is_marketplace: String(pref.marketplace) === `MP-MKT-${app}`,
    payment_collector_is_seller_b: payment ? String(payment.collector_id) === sellerB : null,
    payment_approved: payment ? payment.status === 'approved' : null,
    seller_a_cannot_search_it: providerSearchEmpty(aView),
    seller_b_can_search_it: bView.http === 200 && Array.isArray(bView.body?.results)
      && bView.body.results.some((p) => String(p.id) === String(intent.provider_payment_id)),
    seller_a_cannot_read_it: Boolean(aDirect && [403, 404].includes(aDirect.http)),
    webhook_valid_and_routed_to_b: receipts.length > 0 && receipts.some((r) => r.signature_valid === true
      && r.seller_business_id === RECOVERY_QA.b && r.processing_status === 'completed')
      && receipts.filter((r) => r.signature_valid === true).every((r) => r.seller_business_id === RECOVERY_QA.b),
  };
  console.log(JSON.stringify({ at: new Date().toISOString(), session, integrator_owner: owner.id, seller_b: sellerB,
    intent: pick(intent, ['internal_status', 'provider_status', 'provider_payment_id', 'order_id']),
    preference: pick(pref, ['collector_id', 'client_id', 'marketplace', 'marketplace_fee', 'site_id']),
    payment: payment && pick(payment, ['status', 'status_detail', 'collector_id', 'live_mode', 'marketplace_owner', 'application_id']),
    seller_a_read_http: aDirect?.http ?? null, webhook_receipts: (receipts || []).map((r) => pick(r, ['event_type', 'signature_valid', 'processing_status'])),
    orders_in_tenant_b: ordersB, checks, all_pass: completeChecks(checks) }, null, 2));
  if (!completeChecks(checks)) process.exitCode = 1;
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
