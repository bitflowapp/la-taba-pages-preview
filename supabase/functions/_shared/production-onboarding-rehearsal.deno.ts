// Production onboarding, rehearsed on the code that bind-production.mjs WILL produce: a copy of the functions with
// the binding of a fictitious production ref (scripts/production/rehearse-mp-onboarding.mjs). Without that copy
// (TABA_REHEARSAL_PRODUCTION_REF unset) every test is ignored: the real repository has no production project yet.
//
// What it proves for Walter's link: with the new project bound, MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved and
// WITHOUT the final key, the owner links a real business account; La Taba's own account is refused; verification
// confirms the account and says real-money charges are not enabled; nothing enables payments.
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { randomSecret } from './seller-oauth-crypto.ts';
import { INTEGRATOR_FIXTURE_OWNER, integratorProviderResponse } from './integrator-identity-fixture.ts';
import { resetIntegratorIdentityCache } from './seller-oauth.ts';

const ref = Deno.env.get('TABA_REHEARSAL_PRODUCTION_REF') || '';
const origin = Deno.env.get('TABA_REHEARSAL_PRODUCTION_ORIGIN') || 'https://la-taba.pages.dev';
const ignore = !/^[a-z]{20}$/.test(ref);
const base = `https://${ref}.supabase.co`;
const business = '00000000-0000-4000-8000-000000000001';
const owner = '97000000-0000-4000-8000-000000000002';

const handlers: Array<(r: Request) => Promise<Response>> = [];
if (!ignore) {
  const serve = Deno.serve;
  Deno.serve = ((handler: unknown) => { handlers.push(handler as typeof handlers[number]); return {}; }) as typeof Deno.serve;
  try {
    await import('../mercadopago-connect/index.ts');
    await import('../mercadopago-oauth-callback/index.ts');
  } finally { Deno.serve = serve; }
}
const [connect, callback] = handlers;

function configure() {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key', SUPABASE_ANON_KEY: 'fixture-anon-key',
    MERCADOPAGO_ENVIRONMENT: 'production', MERCADOPAGO_OAUTH_ENVIRONMENT: 'production', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    TABA_DEPLOYMENT_ENV: 'production', MERCADOPAGO_OAUTH_PROJECT_REF: ref, MERCADOPAGO_OAUTH_PANEL_URL: `${origin}/`,
    MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: 'fixture-webhook-key',
    PAYMENT_WORKER_SECRET: 'fixture-worker-secret', PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
    TABA_CHECKOUT_BASE_URL: origin, TABA_ALLOWED_ORIGINS: origin, MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved',
  })) Deno.env.set(name, value);
  Deno.env.delete('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
  Deno.env.delete('TABA_RECOVERY_PROJECT_REF');
  resetIntegratorIdentityCache();
}

function harness(sellerId: number) {
  configure();
  let state: Record<string, unknown> | null = null;
  let row: Record<string, unknown> | null = null;
  const writes: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit;
    const integrator = integratorProviderResponse(input, init, false);
    if (integrator) return integrator;
    if (url.origin !== base && url.origin !== 'https://api.mercadopago.com') throw Error('Unexpected host ' + url.origin);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, aud: 'authenticated' });
    if (url.pathname.endsWith('/mp_connection_authorized')) return Response.json(true);
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
    if (url.pathname.endsWith('/mp_begin_oauth')) {
      assertEquals(body.p_environment, 'production');
      state = { business_id: body.p_business_id, user_id: body.p_user_id, generation: 'generation', protected_verifier: body.p_protected_verifier };
      return Response.json('generation');
    }
    if (url.pathname.endsWith('/mp_consume_oauth')) { const consumed = state; state = null; return Response.json(consumed ? [consumed] : []); }
    if (url.pathname.endsWith('/mp_finish_oauth')) {
      writes.push('finish');
      row = { business_id: business, environment: 'production', status: 'connected', seller_id: body.p_seller_id,
        application_id: body.p_application_id, scopes: body.p_scopes, protected_tokens: body.p_protected_tokens,
        expires_at: body.p_expires_at, generation: 'generation', refresh_owner: null, account_label: 'COMERCIO · w•••@example.com',
        connected_at: new Date().toISOString() };
      return Response.json(true);
    }
    if (url.pathname.endsWith('/mp_seller_connections')) {
      if (init?.method === 'PATCH') writes.push('label');
      return Response.json(row);
    }
    if (url.pathname.endsWith('/business_payment_settings')) {
      return Response.json(row ? { enabled: false, environment: 'production', collector_id: row.seller_id, application_id: '7677852968049976', production_review_status: 'not_requested' } : null);
    }
    if (url.pathname.endsWith('/get_mercadopago_checkout_availability')) return Response.json({ available: false });
    if (url.pathname === '/oauth/token') {
      assertEquals(body.client_secret, 'fixture-client-secret');
      assertEquals(body.redirect_uri, `${base}/functions/v1/mercadopago-oauth-callback`);
      return Response.json({ access_token: 'APP_USR-walter-fixture', refresh_token: 'fixture-refresh', user_id: sellerId,
        expires_in: 15552000, scope: 'read write offline_access', live_mode: true });
    }
    if (url.pathname === '/users/me') return Response.json({ id: sellerId, site_id: 'MLA', nickname: 'COMERCIO', email: 'walter@example.com', tags: ['normal'] });
    throw Error('Unexpected request ' + url.pathname);
  };
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
  const headers = { authorization: `Bearer fixture.${payload}.fixture`, 'content-type': 'application/json', origin };
  const call = (action: string) => connect(new Request(`${base}/functions/v1/mercadopago-connect`, { method: 'POST', headers, body: JSON.stringify({ business_id: business, action }) }));
  const link = async () => {
    const started = await call('connect');
    assertEquals(started.status, 200);
    const auth = new URL((await started.json()).authorization_url);
    assertEquals(auth.searchParams.get('client_id'), '7677852968049976');
    assertEquals(auth.searchParams.get('redirect_uri'), `${base}/functions/v1/mercadopago-oauth-callback`);
    assertEquals(auth.searchParams.get('code_challenge_method'), 'S256');
    const done = await callback(new Request(`${base}/functions/v1/mercadopago-oauth-callback?state=${auth.searchParams.get('state')}&code=fixture-code`));
    const location = new URL(done.headers.get('location')!);
    assertEquals(location.origin + location.pathname, `${origin}/`);
    return location.searchParams.get('mp_connection');
  };
  return { writes, link, call, restore: () => { globalThis.fetch = original; } };
}

Deno.test({ name: 'rehearsal: Walter links his business account in the newly bound production project, without the final key', ignore, fn: async () => {
  const h = harness(888000111);
  try {
    assertEquals(await h.link(), 'connected');
    assertEquals(h.writes, ['finish', 'label']);
    const verified = await (await h.call('verify')).json();
    assertEquals(verified.verification.seller_identity_verified, true);
    assertEquals(verified.verification.seller_is_integrator, false);
    assertEquals(verified.verification.online_payments_enabled, false);
    assertEquals(verified.verification.blocking_reason, 'production_execution_not_enabled');
    assertEquals(verified.connection.environment, 'production');
    assertEquals(/APP_USR|refresh|secret/i.test(JSON.stringify(verified)), false);
  } finally { h.restore(); }
} });

Deno.test({ name: 'rehearsal: La Taba’s own account is refused in the newly bound production project', ignore, fn: async () => {
  const h = harness(INTEGRATOR_FIXTURE_OWNER);
  try {
    assertEquals(await h.link(), 'integrator_account');
    assertEquals(h.writes, []);
  } finally { h.restore(); }
} });
