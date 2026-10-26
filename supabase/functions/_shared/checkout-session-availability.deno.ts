import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { resetIntegratorIdentityCache } from './seller-oauth.ts';
import { integratorProviderResponse } from './integrator-identity-fixture.ts';

// The real handler, with Supabase answered by a fixture transport.
let handle: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((handler: unknown) => {
  handle = handler as typeof handle;
  return {};
}) as typeof Deno.serve;
try {
  await import('../mercadopago-create-checkout-session/index.ts');
} finally {
  Deno.serve = serve;
}

const business = '97000000-0000-4000-8000-000000000001';

// The environment is set completely for every run: other test files of the same process leave theirs behind.
const STAGING_OAUTH = {
  SUPABASE_URL: 'https://ucbtjcurawxjwjdvvcvj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  SUPABASE_ANON_KEY: 'fixture-anon', PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
  TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev', TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev',
  MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
  TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_OAUTH_PROJECT_REF: 'ucbtjcurawxjwjdvvcvj',
  MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', MERCADOPAGO_CLIENT_ID: '2691240967769590',
  MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
};

// The production binding of the code (La Taba Delivery), with the platform review approved.
const PRODUCTION_OAUTH = {
  ...STAGING_OAUTH, SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co', TABA_ALLOWED_ORIGINS: 'https://la-taba.pages.dev',
  TABA_CHECKOUT_BASE_URL: 'https://la-taba.pages.dev', MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production',
  TABA_DEPLOYMENT_ENV: 'production', MERCADOPAGO_OAUTH_PROJECT_REF: 'wwcpogltfgzgkrlilbcd', MERCADOPAGO_OAUTH_PANEL_URL: 'https://la-taba.pages.dev/',
  MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved',
};

type Options = { mode?: 'oauth' | 'direct' | 'padded'; integratorTestUser?: boolean; integratorStatus?: number;
  production?: boolean; finalKey?: boolean };

async function run(available: boolean | 'error', { mode = 'oauth', integratorTestUser = true, integratorStatus = 200,
  production = false, finalKey = false }: Options = {}) {
  for (const name of ['MERCADOPAGO_PRODUCTION_REVIEW_STATUS', 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION']) Deno.env.delete(name);
  for (const [name, value] of Object.entries(production ? PRODUCTION_OAUTH : STAGING_OAUTH)) Deno.env.set(name, value);
  if (finalKey) Deno.env.set('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE');
  if (mode === 'direct') Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE');
  if (mode === 'padded') Deno.env.set('MERCADOPAGO_CREDENTIAL_MODE', ' oauth ');
  resetIntegratorIdentityCache();
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const integrator = integratorProviderResponse(input, init, integratorTestUser);
    if (integrator) {
      calls.push(`integrator:${url.pathname}`);
      return integratorStatus === 200 ? integrator : Response.json({ message: 'fixture' }, { status: integratorStatus });
    }
    calls.push(url.pathname.split('/').pop() || '');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: '97000000-0000-4000-8000-000000000002', aud: 'authenticated' });
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/get_mercadopago_checkout_availability')) {
      if (available === 'error') return Response.json({ message: 'boom' }, { status: 500 });
      return Response.json({ available, environment: production ? 'production' : 'test', checkout_mode: 'checkout_pro' });
    }
    if (url.pathname.endsWith('/create_checkout_session')) {
      return Response.json({ checkout_session_id: '97000000-0000-4000-8000-000000000003' });
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  try {
    const response = await handle(new Request('https://ucbtjcurawxjwjdvvcvj.supabase.co/functions/v1/mercadopago-create-checkout-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-customer-jwt' },
      body: JSON.stringify({ business_id: business, client_request_id: 'fixture-request-0001', items: [], payment_method: 'mercadopago' }),
    }));
    return { status: response.status, body: await response.json(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('a seller that cannot charge never gets a checkout: no stock is reserved', async () => {
  const result = await run(false);
  assertEquals(result.status, 409);
  assertEquals(result.body.code, 'PAYMENTS_NOT_ENABLED');
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('an availability lookup failure fails closed before reserving stock', async () => {
  const result = await run('error');
  assertEquals(result.status, 409);
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('a connected seller keeps the normal checkout path', async () => {
  const result = await run(true);
  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
  assertEquals(result.calls.filter((call) => call === 'create_checkout_session').length, 1);
  assertEquals(result.calls.filter((call) => call.startsWith('integrator:')), ['integrator:/oauth/token', 'integrator:/users/me']);
});

// 2026-10-23: the QA integrator application belonged to a real account while seller and buyer were test users.
// Every checkout reserved stock and ended in «Oh, no, algo anduvo mal» (2034 Invalid users involved).
Deno.test('an integrator application of the other environment never reserves stock', async () => {
  const result = await run(true, { integratorTestUser: false });
  assertEquals(result.status, 409);
  assertEquals(result.body.code, 'PAYMENTS_NOT_ENABLED');
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('an unreadable integrator identity fails closed before reserving stock', async () => {
  for (const integratorStatus of [401, 503]) {
    const result = await run(true, { integratorStatus });
    assertEquals(result.status, 503);
    assertEquals(result.body.code, 'SELLER_VERIFICATION_UNAVAILABLE');
    assertEquals(result.calls.includes('create_checkout_session'), false);
  }
});

Deno.test('without seller OAuth there is no integrator to check', async () => {
  const result = await run(true, { mode: 'direct', integratorTestUser: false });
  assertEquals(result.status, 200);
  assertEquals(result.calls.some((call) => call.startsWith('integrator:')), false);
});

Deno.test('the integrator guard also runs when the credential mode carries stray whitespace', async () => {
  const result = await run(true, { mode: 'padded', integratorTestUser: false });
  assertEquals(result.status, 409);
  assertEquals(result.body.code, 'PAYMENTS_NOT_ENABLED');
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

// A business switched on in production before the final key is loaded would reserve stock for a checkout whose
// preference can never be created (requireRealPaymentSmokeAuthorization).
Deno.test('production without the final key refuses the checkout before reserving stock', async () => {
  const result = await run(true, { production: true, integratorTestUser: false });
  assertEquals(result.status, 409);
  assertEquals(result.body.code, 'PAYMENTS_NOT_ENABLED');
  assertEquals(result.calls.includes('create_checkout_session'), false);
});

Deno.test('production with the final key keeps the normal checkout path', async () => {
  const result = await run(true, { production: true, integratorTestUser: false, finalKey: true });
  assertEquals(result.status, 200);
  assertEquals(result.calls.filter((call) => call === 'create_checkout_session').length, 1);
});
