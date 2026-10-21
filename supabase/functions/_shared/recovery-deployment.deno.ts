import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.19';
import { recoveryDeploymentBinding, RECOVERY_FORBIDDEN_REFS, paymentWorkerLimits } from './recovery-deployment.ts';
import { oauthConfig } from './seller-oauth.ts';
import { signPaymentWorkerRequest } from './payment-worker-signature.ts';

const ref = 'abcdefghijklmnopqrst';
const origin = 'https://recovery-20261020.taba2-staging.pages.dev';
const valid: Record<string, string> = {
  TABA_RECOVERY_PROJECT_REF: ref, TABA_RECOVERY_CHECKOUT_ORIGIN: origin,
  SUPABASE_URL: `https://${ref}.supabase.co`, MERCADOPAGO_OAUTH_PROJECT_REF: ref,
  MERCADOPAGO_CLIENT_ID: '2691240967769590', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
  TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
  MERCADOPAGO_OAUTH_PANEL_URL: origin + '/', TABA_CHECKOUT_BASE_URL: origin, TABA_ALLOWED_ORIGINS: origin,
};
const read = (values: Record<string, string>) => (key: string) => values[key];

Deno.test('recovery requires explicit opt-in; legacy deployments keep their current binding', () => {
  assertEquals(recoveryDeploymentBinding(read({})), null);
});
Deno.test('recovery binding accepts only staging, its own ref, test OAuth and controlled preview origin', () => {
  const result = recoveryDeploymentBinding(read(valid));
  assertEquals(result?.binding.paymentEnvironment, 'test');
  assertEquals(result?.binding.supabaseUrl, `https://${ref}.supabase.co`);
});
Deno.test('Free recovery bounds work while legacy environments keep their existing worker limits', () => {
  assertEquals(paymentWorkerLimits(read(valid)), { refreshLimit: 1, claimLimit: 1 });
  assertEquals(paymentWorkerLimits(read({})), { refreshLimit: 10, claimLimit: 20 });
});
for (const forbidden of RECOVERY_FORBIDDEN_REFS) {
  Deno.test('recovery cannot adopt existing project ' + forbidden, () => {
    assertThrows(() => recoveryDeploymentBinding(read({ ...valid, TABA_RECOVERY_PROJECT_REF: forbidden,
      SUPABASE_URL: `https://${forbidden}.supabase.co`, MERCADOPAGO_OAUTH_PROJECT_REF: forbidden })));
  });
}
for (const [field, value] of Object.entries({
  MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_ENVIRONMENT: 'production',
  MERCADOPAGO_OAUTH_ENVIRONMENT: 'production', TABA_DEPLOYMENT_ENV: 'production',
  MERCADOPAGO_CREDENTIAL_MODE: 'legacy', MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'fixture-authorization',
  MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved', SUPABASE_URL: 'https://attacker.invalid',
  TABA_RECOVERY_CHECKOUT_ORIGIN: 'https://la-taba.pages.dev', MERCADOPAGO_OAUTH_PROJECT_REF: 'wrong-project',
})) {
  Deno.test('recovery rejects cross-environment field ' + field, () => {
    assertThrows(() => recoveryDeploymentBinding(read({ ...valid, [field]: value })));
  });
}
Deno.test('real oauthConfig accepts the new test binding and derives callback and webhook on its own project', () => {
  const names = [...Object.keys(valid), 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', 'MERCADOPAGO_PRODUCTION_REVIEW_STATUS'];
  const before = new Map(names.map(name => [name, Deno.env.get(name)]));
  try {
    for (const name of names) Deno.env.delete(name);
    for (const [name, value] of Object.entries(valid)) Deno.env.set(name, value);
    const result = oauthConfig();
    assertEquals(result.environment, 'test');
    assertEquals(result.callback, `https://${ref}.supabase.co/functions/v1/mercadopago-oauth-callback`);
    assertEquals(result.webhook, `https://${ref}.supabase.co/functions/v1/mercadopago-webhook`);
    Deno.env.set('TABA_ALLOWED_ORIGINS', 'https://la-taba.pages.dev');
    assertThrows(() => oauthConfig());
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value);
    }
  }
});

Deno.test('actual recovery worker claims one job and refreshes at most one seller', async () => {
  const values = { ...valid, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    PAYMENT_WORKER_SECRET: 'fixture-worker-secret', PAYMENT_LOG_HASH_SALT: 'fixture-log-salt' };
  const names = [...Object.keys(values), 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', 'MERCADOPAGO_PRODUCTION_REVIEW_STATUS'];
  const before = new Map(names.map(name => [name, Deno.env.get(name)]));
  const originalFetch = globalThis.fetch, serve = Deno.serve;
  let handler!: (request: Request) => Promise<Response>;
  try {
    for (const name of names) Deno.env.delete(name);
    for (const [name, value] of Object.entries(values)) Deno.env.set(name, value);
    Deno.serve = ((fn: typeof handler) => { handler = fn; return {}; }) as typeof Deno.serve;
    await import('../mercadopago-payment-worker/index.ts');
    Deno.serve = serve;
    let claimed = false;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assertEquals(url.origin, `https://${ref}.supabase.co`);
      if (url.pathname.endsWith('/mp_seller_connections')) {
        assertEquals(url.searchParams.get('limit'), '1'); return Response.json([]);
      }
      if (url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({ allowed: true });
      if (url.pathname.endsWith('/claim_payment_outbox_v2')) {
        const body = JSON.parse(String((init as RequestInit | undefined)?.body));
        assertEquals(body.p_limit, 1); assertEquals(body.p_lease_seconds, 90);
        claimed = true; return Response.json([]);
      }
      throw new Error('Unexpected recovery fixture request');
    };
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID();
    const signature = await signPaymentWorkerRequest(values.PAYMENT_WORKER_SECRET, timestamp, nonce);
    const response = await handler(new Request(`https://${ref}.supabase.co/functions/v1/mercadopago-payment-worker`, {
      method: 'POST', headers: { 'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': nonce, 'x-taba-worker-signature': signature },
    }));
    assertEquals(response.status, 200); assertEquals(claimed, true);
  } finally {
    Deno.serve = serve; globalThis.fetch = originalFetch;
    for (const [name, value] of before) {
      if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value);
    }
  }
});
