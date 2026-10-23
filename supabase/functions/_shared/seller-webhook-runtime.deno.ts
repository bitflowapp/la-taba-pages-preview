import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect } from './seller-oauth.ts';
import { randomSecret } from './seller-oauth-crypto.ts';

let handle: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((handler: unknown) => {
  handle = handler as typeof handle;
  return {};
}) as typeof Deno.serve;
try {
  await import('../mercadopago-webhook/index.ts');
} finally {
  Deno.serve = serve;
}

const business = '92000000-0000-4000-8000-000000000001';
const secret = 'fixture-webhook-signing-key';
type Shape = 'webhook' | 'unsigned_webhook' | 'legacy_ipn' | 'ipn_query_webhook_body';
async function run(valid: boolean, wrongReference = false, shape: Shape = 'webhook') {
  for (const [name, value] of Object.entries({
    SUPABASE_URL: 'https://ukxqbgswjlibmnjemrzd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key',
    MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd',
    MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/', MERCADOPAGO_CLIENT_ID: '2691240967769590',
    TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev', TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: secret,
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt',
  })) Deno.env.set(name, value);
  const row = {
    business_id: business, seller_id: '123', application_id: '2691240967769590', environment: 'test', status: 'connected',
    protected_tokens: await protect({access_token: 'APP_USR-seller-fixture'}, business),
    expires_at: new Date(Date.now() + 3 * 86400000).toISOString(), refresh_owner: null,
  };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`id:987;request-id:fixture-request;ts:${timestamp};`)));
  const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
  const original = globalThis.fetch;
  const receipts: Record<string, unknown>[] = [];
  let providerCalls = 0, connectionCalls = 0;
  globalThis.fetch = async (request, options) => {
    const url = new URL(String(request));
    const init = options as {headers?: Record<string, string>; body?: unknown} | undefined;
    if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({allowed: true});
    if (url.pathname.endsWith('/mp_seller_connections')) {
      connectionCalls++;
      if (url.searchParams.has('seller_id')) {
        assertEquals(url.searchParams.get('application_id'), 'eq.2691240967769590');
        assertEquals(url.searchParams.get('environment'), 'eq.test');
      }
      return Response.json(row);
    }
    if (url.origin === 'https://api.mercadopago.com') {
      providerCalls++;
      assertEquals(url.pathname, '/v1/payments/987');
      assertEquals(new Headers(init?.headers).get('authorization'), 'Bearer APP_USR-seller-fixture');
      return Response.json({id: 987, collector_id: 123, live_mode: false, external_reference: 'server-reference'});
    }
    if (url.pathname.endsWith('/payment_intents')) {
      assertEquals(url.searchParams.get('external_reference'), 'eq.server-reference');
      return Response.json({business_id: wrongReference ? 'different-business' : business, environment: 'test'});
    }
    if (url.pathname.endsWith('/mp_record_seller_webhook') || url.pathname.endsWith('/record_mercadopago_webhook_receipt')) {
      receipts.push(JSON.parse(String(init?.body)));
      return Response.json({receipt_id: 'fixture-receipt', duplicate: false, queued: valid});
    }
    throw new Error('Unexpected test request');
  };
  try {
    const base = 'https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook';
    const ipnQuery = shape === 'legacy_ipn' || shape === 'ipn_query_webhook_body';
    const headers: Record<string, string> = {'content-type': 'application/json', 'x-request-id': 'fixture-request'};
    // A legacy IPN carries an x-Signature that cannot be validated with the secret key.
    if (shape !== 'unsigned_webhook') headers['x-signature'] = `ts=${timestamp},v1=${valid ? hex : '0'.repeat(64)}`;
    const response = await handle(new Request(ipnQuery ? `${base}?topic=payment&id=987` : `${base}?data.id=987&business_id=ignored-attacker-value`, {
      method: 'POST', headers,
      body: JSON.stringify(shape === 'legacy_ipn' ? {resource: '987', topic: 'payment'} : {id: 'fixture-event', type: 'payment', data: {id: '987'}, user_id: 123}),
    }));
    const text = await response.text();
    return {status: response.status, body: text, receipts, providerCalls, connectionCalls};
  } finally {
    globalThis.fetch = original;
    Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE');
  }
}
Deno.test('OAuth webhook validates HMAC and routes a provider-verified payment without trusting business_id', async () => {
  const result = await run(true);
  assertEquals(result.status, 201);
  assertEquals(result.providerCalls, 1);
  assertEquals(result.receipts[0].p_business_id, business);
  assertEquals(result.receipts[0].p_signature_valid, true);
});
Deno.test('OAuth webhook rejects invalid HMAC before seller lookup or provider access', async () => {
  const result = await run(false);
  assertEquals(result.status, 401);
  assertEquals(result.providerCalls, 0);
  assertEquals(result.connectionCalls, 0);
  assertEquals(result.receipts[0].p_signature_valid, false);
});
Deno.test('OAuth webhook cannot queue a verified payment against another business reference', async () => {
  const result = await run(true, true);
  assertEquals(result.status, 503);
  assertEquals(result.receipts.length, 0);
});

// 2026-10-23, first approved QA payment (184722117633): next to the signed webhook, the legacy IPN feed (payment and
// merchant_order) arrived at notification_url and was stored as six rejected signatures, raising a false «webhook
// secret» alert and the owner warning on a sale that was fine.
Deno.test('a legacy IPN is acknowledged without a receipt, a seller lookup or a provider read', async () => {
  const result = await run(false, false, 'legacy_ipn');
  assertEquals(result.status, 200);
  assertEquals(JSON.parse(result.body).ignored, 'legacy_ipn');
  assertEquals(result.receipts.length, 0);
  assertEquals(result.providerCalls, 0);
  assertEquals(result.connectionCalls, 0);
});
Deno.test('an unsigned modern webhook is still rejected and recorded', async () => {
  const result = await run(true, false, 'unsigned_webhook');
  assertEquals(result.status, 401);
  assertEquals(result.receipts.length, 1);
  assertEquals(result.receipts[0].p_signature_valid, false);
  assertEquals(result.providerCalls, 0);
});
Deno.test('an IPN query with a webhook body is a webhook: its signature decides', async () => {
  const invalid = await run(false, false, 'ipn_query_webhook_body');
  assertEquals(invalid.status, 401);
  assertEquals(invalid.receipts[0].p_signature_valid, false);
  assertEquals(invalid.providerCalls, 0);
});
