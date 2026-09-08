import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';
import { sha256Hex } from './payment-runtime.ts';

let handle: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((fn: typeof handle) => { handle = fn; return {}; }) as typeof Deno.serve;
try { await import('../mercadopago-create-preference/index.ts'); }
finally { Deno.serve = serve; }
const bid = '94000000-0000-4000-8000-000000000001';
const uid = '94000000-0000-4000-8000-000000000002';
const sid = '94000000-0000-4000-8000-000000000003';
const iid = '94000000-0000-4000-8000-000000000004';
const providerUrl = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=fixture';

function configure() {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', SUPABASE_ANON_KEY: 'fixture-anon',
    MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production',
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth', MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved',
    MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE',
    TABA_DEPLOYMENT_ENV: 'production', MERCADOPAGO_OAUTH_PROJECT_REF: 'wwcpogltfgzgkrlilbcd',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://la-taba.pages.dev/',
    TABA_CHECKOUT_BASE_URL: 'https://la-taba.pages.dev', TABA_ALLOWED_ORIGINS: 'https://la-taba.pages.dev',
    MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
  })) Deno.env.set(name, value);
}

async function run(route: string, mutation: string, initiallyInvalid = '') {
  configure();
  const encrypted = await protect({ access_token: 'fixture-verified-token' }, bid);
  const rotated = await protect({ access_token: 'fixture-rotated-token' }, bid);
  const business = { id: bid, is_active: true, status: 'open', ordering_enabled: true, ordering_verified: true };
  const settings = { business_id: bid, provider: 'mercadopago', enabled: true, environment: 'production',
    checkout_mode: 'checkout_pro', currency: 'ARS', reserve_stock: true, production_review_status: 'approved',
    collector_id: '123456789', application_id: '7677852968049976', updated_at: '2026-09-08T00:00:00Z' };
  const seller = { business_id: bid, environment: 'production', status: 'connected', seller_id: '123456789',
    application_id: '7677852968049976', protected_tokens: encrypted as string | null,
    expires_at: new Date(Date.now() + 172800000).toISOString(), generation: 'fixture-generation', refresh_owner: null };
  const checkout = { id: sid, customer_id: uid, business_id: bid, payment_intent_id: iid, environment: 'production',
    status: 'ready_for_payment', expires_at: new Date(Date.now() + 600000).toISOString(),
    reservation_valid: true, business_open: true };
  if (['disconnected', 'requires_reauthorization'].includes(initiallyInvalid)) seller.status = initiallyInvalid;
  if (initiallyInvalid === 'cleared_tokens') seller.protected_tokens = null;
  if (initiallyInvalid === 'wrong_business') seller.business_id = uid;
  if (initiallyInvalid === 'wrong_environment') seller.environment = 'test';
  if (initiallyInvalid === 'payments_disabled') settings.enabled = false;
  if (initiallyInvalid === 'missing_smoke') Deno.env.delete('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
  const preparation = { checkout_session_id: sid, payment_intent_id: iid, payment_attempt_id: iid,
    attempt_number: 1, preference_id: route.startsWith('stored') ? 'fixture' : null,
    attempt_status: route.startsWith('stored') ? 'created' : 'prepared', init_point: route.startsWith('stored') ? providerUrl : null,
    sandbox_init_point: 'https://sandbox.mercadopago.com/forbidden', environment: 'production', currency: 'ARS',
    total: 100, external_reference: 'fixture-reference', idempotency_key: iid, expires_at: checkout.expires_at,
    items: [{ id: 'fixture-product', title: 'Fixture', quantity: 1, unit_price: 100, currency_id: 'ARS' }],
    allow_offline_payment_methods: false };
  const attempt = { id: iid, payment_intent_id: iid, attempt_type: 'preference', attempt_number: 1,
    idempotency_key: iid, status: preparation.attempt_status, preference_id: preparation.preference_id,
    init_point: preparation.init_point, authority_revision: 1, seller_generation: seller.generation, seller_id: seller.seller_id };
  const intent = { id: iid, business_id: bid, checkout_session_id: sid, current_payment_attempt_id: iid, internal_status: 'preference_created', preference_id: preparation.preference_id };
  if (route === 'stored_legacy') { Object.assign(attempt, { seller_generation: null, seller_id: null }); Object.assign(intent, { current_payment_attempt_id: null }); }
  const snapshot = async () => {
    const data = structuredClone({ business, settings, seller: initiallyInvalid === 'no_seller' ? null : seller, checkout, attempt, intent });
    return { ...data, authority_version: await sha256Hex(JSON.stringify(data)) };
  };
  let reachProvider!: () => void, releaseProvider!: () => void;
  const reached = new Promise<void>(resolve => { reachProvider = resolve; });
  const release = new Promise<void>(resolve => { releaseProvider = resolve; });
  let providerChecks = 0, snapshotReads = 0;
  const records: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') return Response.json({ id: uid });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/prepare_mercadopago_preference_v2')) {
      assertEquals(body.p_customer_id, uid); return Response.json(preparation);
    }
    if (url.pathname.endsWith('/get_mercadopago_payment_authority_v2')) {
      snapshotReads++;
      assertEquals(body, { p_business_id: bid, p_environment: 'production', p_checkout_session_id: sid, p_customer_id: uid, p_payment_attempt_id: iid });
      return Response.json(await snapshot());
    }
    // Former transport shape is intentional: the audit races run against the
    // old handler first. Every response captures its own immutable read view.
    if (url.pathname.endsWith('/businesses')) return Response.json(business);
    if (url.pathname.endsWith('/business_payment_settings')) return Response.json(settings);
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(initiallyInvalid === 'no_seller' ? null : seller);
    if (url.pathname.endsWith('/payment_intents')) return Response.json({ business_id: bid, environment: 'production' });
    if (url.pathname.endsWith('/record_mercadopago_preference_created_v2')) {
      assertEquals(body.p_expected_authority, (await snapshot()).authority_version);
      attempt.status = 'created'; attempt.preference_id = body.p_preference_id; attempt.init_point = body.p_init_point;
      attempt.authority_revision++; intent.preference_id = body.p_preference_id;
      attempt.seller_generation = seller.generation; attempt.seller_id = seller.seller_id; intent.current_payment_attempt_id = iid;
      return Response.json(await snapshot());
    }
    if (url.pathname.includes('/rpc/record_mercadopago_preference')) { records.push(url.pathname); return Response.json(true); }
    if (url.origin !== 'https://api.mercadopago.com') throw new Error('Unexpected test request: ' + url.pathname);
    if (url.pathname === '/users/me') {
      providerChecks++;
      assertEquals(new Headers(init?.headers).get('authorization'), 'Bearer fixture-verified-token');
      reachProvider(); await release;
      return Response.json({ id: 123456789, site_id: 'MLA', tags: ['normal'] });
    }
    if (url.pathname === '/checkout/preferences/search') return Response.json({ elements:
      route === 'recovered' ? [{ id: 'fixture', external_reference: 'fixture-reference' }] : [] });
    if (url.pathname === '/checkout/preferences/fixture' || url.pathname === '/checkout/preferences') {
      return Response.json({ id: 'fixture', external_reference: 'fixture-reference', collector_id: seller.seller_id, metadata: { payment_attempt_id: iid, checkout_session_id: sid }, init_point: providerUrl, sandbox_init_point: preparation.sandbox_init_point });
    }
    throw new Error('Unexpected provider request: ' + url.pathname);
  };
  try {
    const response = handle(new Request('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-create-preference', {
      method: 'POST', headers: { authorization: 'Bearer fixture-customer', 'content-type': 'application/json' },
      body: JSON.stringify({ checkout_session_id: sid }),
    }));
    if (!initiallyInvalid) {
      assertEquals(await Promise.race([reached.then(() => 'provider'), response.then(() => 'response')]), 'provider');
      if (mutation === 'cancelled') attempt.status = 'cancelled';
      if (mutation === 'superseded' || mutation === 'attempt_id' || mutation === 'same_seller_other_attempt') attempt.id = uid;
      if (mutation === 'preference') attempt.preference_id = 'other';
      if (mutation === 'url') attempt.init_point = providerUrl + '-other';
      if (mutation === 'aba') attempt.authority_revision += 2;
      if (mutation === 'intent_cancelled') intent.internal_status = 'cancelled';
      if (mutation === 'payments_disabled') settings.enabled = false;
      if (mutation === 'business_closed') { business.status = 'closed'; business.ordering_enabled = false; }
      if (mutation === 'generation') seller.generation = 'rotated-generation';
      if (mutation === 'credential') seller.protected_tokens = rotated;
      if (mutation === 'disconnected') { seller.status = 'disconnected'; seller.protected_tokens = null; }
      if (mutation === 'settings_version') settings.updated_at = '2026-09-08T00:01:00Z';
      if (mutation === 'review') settings.production_review_status = 'pending';
      if (mutation === 'smoke') Deno.env.delete('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
      if (mutation === 'reservation') checkout.reservation_valid = false;
      if (mutation === 'expired') checkout.expires_at = new Date(Date.now() - 1000).toISOString();
    }
    releaseProvider();
    const result = await response, body = await result.json();
    const allowed = mutation === 'none' && !initiallyInvalid;
    assertEquals(Boolean(body.init_point), allowed, route + '/' + mutation + '/' + initiallyInvalid + ': ' + JSON.stringify(body));
    if (allowed) { assertEquals(result.status, 200); assertEquals(body.init_point, providerUrl); }
    else {
      assertEquals(result.status >= 400, true, 'authority rejection must not be disguised as provider ambiguity');
      assertEquals(records.some(name => name.endsWith('_uncertain')), false);
    }
    if (!initiallyInvalid) { assertEquals(providerChecks, 1); if (allowed && snapshotReads > 0) assertEquals(snapshotReads, 2); }
  } finally { releaseProvider(); globalThis.fetch = original; }
}

for (const route of ['stored', 'stored_legacy', 'recovered', 'new']) {
  for (const mutation of ['payments_disabled', 'business_closed', 'generation', 'credential', 'disconnected',
    'settings_version', 'review', 'smoke', 'reservation', 'expired', 'none',
    'cancelled', 'superseded', 'attempt_id', 'same_seller_other_attempt', 'preference', 'url', 'aba', 'intent_cancelled']) {
    Deno.test('A1 real handler ' + route + ': ' + mutation + ' during /users/me', () => run(route, mutation));
  }
}
for (const state of ['no_seller', 'disconnected', 'requires_reauthorization', 'cleared_tokens',
  'wrong_business', 'wrong_environment', 'payments_disabled', 'missing_smoke']) {
  Deno.test('A1 stored URL initially rejects ' + state, () => run('stored', 'none', state));
}
