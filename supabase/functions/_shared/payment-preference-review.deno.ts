// Independent review of PR #157: the real mercadopago-create-preference handler under hostile provider and process
// behavior. All HTTP is replaced; --deny-net enforces isolation. The provider keeps real state (a POST that "was lost"
// still created its preference), so the invariants are checked against what Mercado Pago would actually hold:
//   * no scenario sends a second POST for an attempt that may already have been sent;
//   * a preference that exists is recovered by search, never re-created;
//   * an attempt that is uncertain is never dispatched again by this handler.
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect, resetIntegratorIdentityCache } from './seller-oauth.ts';
import { sha256Hex } from './payment-runtime.ts';
import { integratorProviderResponse } from './integrator-identity-fixture.ts';
let handle: (r: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((fn: typeof handle) => { handle = fn; return {}; }) as typeof Deno.serve;
try { await import('../mercadopago-create-preference/index.ts'); } finally { Deno.serve = serve; }

type PostMode = 'ok' | 'lost-after' | 'lost-before' | 'http500' | 'http401' | 'http400';
type Options = { post?: PostMode; persistFails?: boolean; claimError?: boolean; startStatus?: string; hidePreference?: boolean };

const b = '95000000-0000-4000-8000-000000000001', u = '95000000-0000-4000-8000-000000000002';
const s = '95000000-0000-4000-8000-000000000003', i = '95000000-0000-4000-8000-000000000004';
const reference = 'taba2:checkout:' + s;

async function world(options: Options = {}) {
  resetIntegratorIdentityCache();
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', SUPABASE_ANON_KEY: 'fixture-anon',
    MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved', MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE',
    TABA_DEPLOYMENT_ENV: 'production', MERCADOPAGO_OAUTH_PROJECT_REF: 'wwcpogltfgzgkrlilbcd', MERCADOPAGO_OAUTH_PANEL_URL: 'https://la-taba.pages.dev/',
    TABA_CHECKOUT_BASE_URL: 'https://la-taba.pages.dev', TABA_ALLOWED_ORIGINS: 'https://la-taba.pages.dev', MERCADOPAGO_CLIENT_ID: '7677852968049976',
    MERCADOPAGO_CLIENT_SECRET: 'fixture-secret', PAYMENT_LOG_HASH_SALT: 'fixture-salt',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  })) Deno.env.set(name, value);
  const expiry = new Date(Date.now() + 600000).toISOString();
  const seller = { business_id: b, environment: 'production', status: 'connected', seller_id: '123456789', application_id: '7677852968049976',
    protected_tokens: await protect({ access_token: 'APP_USR-review-fixture' }, b), expires_at: new Date(Date.now() + 172800000).toISOString(),
    generation: 'fixture-generation', refresh_owner: null };
  const attempt = { id: i, payment_intent_id: i, attempt_type: 'preference', attempt_number: 1, idempotency_key: i, status: options.startStatus ?? 'prepared',
    preference_id: null as string | null, init_point: null as string | null, authority_revision: 1, seller_generation: seller.generation, seller_id: seller.seller_id };
  const intent = { id: i, business_id: b, checkout_session_id: s, current_payment_attempt_id: i, internal_status: 'preference_creating', preference_id: null as string | null };
  const preparation = () => ({ checkout_session_id: s, payment_intent_id: i, payment_attempt_id: i, attempt_number: 1, idempotency_key: i,
    preference_id: attempt.preference_id, init_point: attempt.init_point, sandbox_init_point: null, attempt_status: attempt.status,
    external_reference: reference, environment: 'production', currency: 'ARS', total: 100, expires_at: expiry,
    items: [{ id: 'product', title: 'Synthetic', quantity: 1, currency_id: 'ARS', unit_price: 100 }], allow_offline_payment_methods: false });
  const snapshot = async () => {
    const data = structuredClone({ seller, attempt, intent,
      business: { id: b, is_active: true, status: 'open', ordering_enabled: true, ordering_verified: true },
      settings: { business_id: b, provider: 'mercadopago', enabled: true, environment: 'production', checkout_mode: 'checkout_pro', currency: 'ARS', reserve_stock: true, production_review_status: 'approved', collector_id: seller.seller_id, application_id: seller.application_id },
      checkout: { id: s, customer_id: u, business_id: b, payment_intent_id: i, environment: 'production', status: 'ready_for_payment', expires_at: expiry, reservation_valid: true, business_open: true } });
    return { ...data, authority_version: await sha256Hex(JSON.stringify(data)) };
  };
  const provider = { posts: 0, searches: 0, preferences: [] as Array<{ id: string; init_point: string }>, claims: 0, claimRefusals: 0, uncertain: 0, failed: 0, created: 0 };
  const original = globalThis.fetch;
  let barrier: Promise<void> | null = null;
  globalThis.fetch = async (input, rawOptions) => {
    const init = rawOptions as RequestInit | undefined;
    const url = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') return Response.json({ id: u });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/prepare_mercadopago_preference_v2')) return Response.json(preparation());
    if (url.pathname.endsWith('/payment_intents')) return Response.json({ business_id: b, environment: 'production' });
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(seller);
    if (url.pathname.endsWith('/get_mercadopago_payment_authority_v2')) return Response.json(await snapshot());
    if (url.pathname.endsWith('/claim_mercadopago_preference_dispatch')) {
      // The database's contract: one winner while the attempt is `prepared`; everyone else gets null.
      if (options.claimError) return Response.json({ message: 'payment authority changed' }, { status: 409 });
      if (attempt.status !== 'prepared') { provider.claimRefusals++; return Response.json(null); }
      provider.claims++; attempt.status = 'request_sent'; attempt.authority_revision++;
      return Response.json(await snapshot());
    }
    if (url.pathname.endsWith('/record_mercadopago_preference_created_v2')) {
      if (options.persistFails) return Response.json({ message: 'temporary database failure' }, { status: 500 });
      attempt.status = 'created'; attempt.preference_id = body.p_preference_id; attempt.init_point = body.p_init_point;
      intent.preference_id = body.p_preference_id; attempt.authority_revision++; provider.created++;
      return Response.json(await snapshot());
    }
    if (url.pathname.endsWith('/record_mercadopago_preference_uncertain')) { attempt.status = 'ambiguous'; provider.uncertain++; return Response.json(true); }
    if (url.pathname.endsWith('/record_mercadopago_preference_failed')) { attempt.status = 'failed'; provider.failed++; return Response.json(true); }
    const integrator = integratorProviderResponse(input, init, false); if (integrator) return integrator;
    if (url.pathname === '/users/me') return Response.json({ id: 123456789, site_id: 'MLA', tags: ['normal'] });
    if (url.pathname === '/checkout/preferences/search') {
      provider.searches++;
      if (barrier) await barrier;
      const visible = options.hidePreference ? [] : provider.preferences;
      return Response.json({ elements: visible.map((p) => ({ id: p.id, external_reference: reference })), total: visible.length });
    }
    const detail = /^\/checkout\/preferences\/([^/]+)$/.exec(url.pathname);
    if (detail) {
      const found = provider.preferences.find((p) => p.id === decodeURIComponent(detail[1]));
      if (!found) return Response.json({ message: 'not found' }, { status: 404 });
      return Response.json({ id: found.id, init_point: found.init_point, sandbox_init_point: '', external_reference: reference,
        collector_id: 123456789, metadata: { payment_attempt_id: i, checkout_session_id: s } });
    }
    if (url.pathname === '/checkout/preferences' && init?.method === 'POST') {
      provider.posts++;
      const mode = options.post ?? 'ok';
      if (mode === 'lost-before') throw new TypeError('connection refused before the request left');
      if (mode === 'http500') return Response.json({ message: 'internal' }, { status: 500 });
      if (mode === 'http401') return Response.json({ message: 'invalid token' }, { status: 401 });
      if (mode === 'http400') return Response.json({ message: 'bad request' }, { status: 400 });
      const created = { id: `review-${provider.posts}`, init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=review-${provider.posts}` };
      provider.preferences.push(created);
      if (mode === 'lost-after') throw new TypeError('the response never arrived');
      return Response.json({ ...created, sandbox_init_point: '' });
    }
    throw Error('Unexpected isolated request ' + url.pathname);
  };
  const request = () => handle(new Request('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-create-preference', {
    method: 'POST', headers: { authorization: 'Bearer fixture-customer', 'content-type': 'application/json' }, body: JSON.stringify({ checkout_session_id: s }) }));
  return {
    attempt, provider, request,
    holdSearches() { let open!: () => void; barrier = new Promise<void>((resolve) => { open = resolve; }); return open; },
    cleanup() { globalThis.fetch = original; },
  };
}

const statuses = async (responses: Response[]) => Promise.all(responses.map(async (r) => ({ status: r.status, body: await r.clone().json().catch(() => ({})) })));

for (const callers of [2, 8, 24]) {
  Deno.test(`${callers} simultaneous requests: one POST, one dispatcher, every other caller is told to wait`, async () => {
    const w = await world();
    try {
      const open = w.holdSearches();
      const pending = Array.from({ length: callers }, () => w.request());
      // Every caller has searched (empty) before any of them can claim: the exact race the claim exists for.
      while (w.provider.searches < callers) await new Promise((resolve) => setTimeout(resolve, 1));
      open();
      const answers = await statuses(await Promise.all(pending));
      const ok = answers.filter((a) => a.status === 200 && a.body.init_point);
      const waiting = answers.filter((a) => a.status === 202 && a.body.code === 'PREFERENCE_RECONCILING');
      assertEquals(w.provider.posts, 1, 'a second POST would hand the buyer a second payable link');
      assertEquals(w.provider.claims, 1);
      assertEquals(ok.length, 1);
      assertEquals(waiting.length, callers - 1);
    } finally { w.cleanup(); }
  });
}

Deno.test('a POST whose response was lost leaves a preference at the provider: the buyer retry recovers it by search and never POSTs again', async () => {
  const w = await world({ post: 'lost-after' });
  try {
    const first = await w.request();
    assertEquals(first.status, 202);
    assertEquals(w.attempt.status, 'ambiguous');
    assertEquals(w.provider.preferences.length, 1, 'the provider really holds the preference');
    const retry = await w.request();
    assertEquals(retry.status, 200);
    assertEquals((await retry.json()).init_point, w.provider.preferences[0].init_point);
    assertEquals(w.provider.posts, 1, 'the retry must not send a second POST');
    assertEquals(w.attempt.status, 'created');
  } finally { w.cleanup(); }
});

for (const mode of ['lost-before', 'http500'] as PostMode[]) {
  Deno.test(`POST outcome unknown (${mode}) with nothing at the provider: the attempt is held uncertain and retries never dispatch again`, async () => {
    const w = await world({ post: mode });
    try {
      assertEquals((await w.request()).status, 202);
      assertEquals(w.attempt.status, 'ambiguous');
      for (let n = 0; n < 5; n++) assertEquals((await w.request()).status, 202);
      assertEquals(w.provider.posts, 1, 'an uncertain POST is never re-sent by a buyer retry');
      assertEquals(w.provider.claims, 1);
    } finally { w.cleanup(); }
  });
}

for (const mode of ['http401', 'http400'] as PostMode[]) {
  Deno.test(`a definitive provider refusal (${mode}) fails the attempt once and tells the buyer to retry from the cart`, async () => {
    const w = await world({ post: mode });
    try {
      const answer = await w.request();
      assertEquals(answer.status, 409);
      assertEquals((await answer.json()).code, 'PAYMENT_SETUP_REJECTED');
      assertEquals(w.attempt.status, 'failed');
      assertEquals(w.provider.posts, 1);
    } finally { w.cleanup(); }
  });
}

Deno.test('the POST succeeded but saving it failed: the dispatcher cannot hand out the link, and the next request recovers the same preference', async () => {
  const w = await world({ persistFails: true });
  try {
    const first = await w.request();
    assertEquals(first.status, 409);
    assertEquals(w.attempt.status, 'request_sent');
    assertEquals(w.provider.preferences.length, 1);
  } finally { w.cleanup(); }
  // The database recovers; the buyer asks again on the same checkout.
  const again = await world({ startStatus: 'request_sent' });
  try {
    again.provider.preferences.push({ id: 'review-1', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=review-1' });
    const answer = await again.request();
    assertEquals(answer.status, 200);
    assertEquals((await answer.json()).init_point, 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=review-1');
    assertEquals(again.provider.posts, 0, 'recovery is by search, not by a new POST');
  } finally { again.cleanup(); }
});

Deno.test('a dispatcher that died after the claim: the buyer sees "wait", the provider is never POSTed to, and a preference that did get created is still recovered', async () => {
  const dead = await world({ startStatus: 'request_sent' });
  try {
    const answer = await dead.request();
    assertEquals(answer.status, 202);
    assertEquals(dead.provider.posts, 0);
    assertEquals(dead.provider.claims, 0);
  } finally { dead.cleanup(); }
  const sent = await world({ startStatus: 'request_sent' });
  try {
    sent.provider.preferences.push({ id: 'review-1', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=review-1' });
    assertEquals((await sent.request()).status, 200);
    assertEquals(sent.provider.posts, 0);
  } finally { sent.cleanup(); }
});

Deno.test('a claim that the database refuses (authority changed) never reaches the provider', async () => {
  const w = await world({ claimError: true });
  try {
    assertEquals((await w.request()).status, 409);
    assertEquals(w.provider.posts, 0);
    assertEquals(w.attempt.status, 'prepared', 'a refused claim leaves the attempt claimable once the authority is settled');
  } finally { w.cleanup(); }
});
