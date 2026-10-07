import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';
import { randomSecret } from './seller-oauth-crypto.ts';
import { verifySellerConnection } from './seller-connection-verification.ts';

const business = '96000000-0000-4000-8000-000000000001';
async function fixture({ enabled = true, execution = true, wrongSeller = false, providerStatus = 200, scopes = 'read write offline_access', backendError = false } = {}) {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key',
    MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    TABA_DEPLOYMENT_ENV: 'production', MERCADOPAGO_OAUTH_PROJECT_REF: 'wwcpogltfgzgkrlilbcd',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://la-taba.pages.dev/', MERCADOPAGO_CLIENT_ID: '7677852968049976',
    TABA_CHECKOUT_BASE_URL: 'https://la-taba.pages.dev', TABA_ALLOWED_ORIGINS: 'https://la-taba.pages.dev',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: randomSecret(),
    PAYMENT_WORKER_SECRET: 'fixture-worker-secret', MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved',
  })) Deno.env.set(name, value);
  Deno.env.delete('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
  if (execution) Deno.env.set('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE');
  const row = { business_id: business, status: 'connected', seller_id: '123', application_id: '7677852968049976', scopes,
    generation: 'fixture-generation', expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), refresh_owner: null,
    protected_tokens: await protect({ access_token: 'fixture-seller-token', refresh_token: 'fixture-refresh-token' }, business) };
  const mutations: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    const options = init as { method?: string; headers?: HeadersInit; body?: unknown } | undefined;
    if (url.origin === 'https://api.mercadopago.com') {
      assertEquals(url.pathname, '/users/me');
      assertEquals(options?.method || 'GET', 'GET');
      assertEquals(new Headers(options?.headers).get('authorization'), 'Bearer fixture-seller-token');
      return Promise.resolve(Response.json({ id: 123, site_id: 'MLA', tags: ['normal'] }, { status: providerStatus }));
    }
    if (url.pathname.endsWith('/mp_seller_connections')) {
      if (options?.method === 'PATCH') mutations.push(JSON.parse(String(options.body)));
      return Promise.resolve(Response.json(row));
    }
    if (url.pathname.endsWith('/business_payment_settings')) return Promise.resolve(Response.json({ enabled, environment: 'production', collector_id: wrongSeller ? '456' : '123', application_id: row.application_id, production_review_status: 'approved' }));
    if (url.pathname.endsWith('/get_mercadopago_checkout_availability')) return Promise.resolve(Response.json(backendError ? { message: 'fixture' } : { available: enabled }, {status: backendError ? 503 : 200}));
    throw Error('Unexpected fixture request');
  };
  return { mutations, cleanup: () => { globalThis.fetch = original; } };
}

Deno.test('real verification checks OAuth identity, scopes, current binding, execution and backend without a purchase', async () => {
  const f = await fixture();
  try {
    const result = await verifySellerConnection(business);
    assertEquals(result.online_payments_enabled, true);
    assertEquals(result.binding_matches, true);
    assertEquals(result.blocking_reason, null);
    assertEquals(f.mutations.length, 0);
    assertEquals(/token|secret|collector_id|"seller_id"/.test(JSON.stringify(result)), false);
  } finally { f.cleanup(); }
});
for (const [options, reason] of [
  [{enabled:false}, 'payments_not_enabled'],
  [{execution:false}, 'production_execution_not_enabled'],
  [{wrongSeller:true}, 'seller_binding_mismatch'],
] as const) Deno.test(`verification reports ${reason} without enabling or reconnecting`, async () => {
  const f = await fixture(options);
  try {
    const result = await verifySellerConnection(business);
    assertEquals(result.online_payments_enabled, false);
    assertEquals(result.blocking_reason, reason);
    assertEquals(f.mutations.length, 0);
  } finally { f.cleanup(); }
});
for (const options of [{providerStatus:503}, {scopes:'read write'}, {backendError:true}]) Deno.test(`verification fails safely: ${JSON.stringify(options)}`, async () => {
  const f = await fixture(options);
  try { await assertRejects(() => verifySellerConnection(business)); assertEquals(f.mutations.length, 0); }
  finally { f.cleanup(); }
});
