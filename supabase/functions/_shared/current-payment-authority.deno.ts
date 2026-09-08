import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.19';
import { assertCurrentSellerPaymentAuthority, protect } from './seller-oauth.ts';

const businessId = '94000000-0000-4000-8000-000000000001';
const sellerId = '123456789';

function configure(environment: 'test' | 'production' = 'test') {
  const production = environment === 'production';
  const ref = production ? 'wwcpogltfgzgkrlilbcd' : 'ukxqbgswjlibmnjemrzd';
  const origin = production ? 'https://la-taba.pages.dev' : 'https://taba2-staging.pages.dev';
  for (const [name, value] of Object.entries({
    SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
    MERCADOPAGO_ENVIRONMENT: environment,
    MERCADOPAGO_OAUTH_ENVIRONMENT: environment,
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved',
    TABA_DEPLOYMENT_ENV: production ? 'production' : 'staging',
    MERCADOPAGO_OAUTH_PROJECT_REF: ref,
    MERCADOPAGO_OAUTH_PANEL_URL: `${origin}/`,
    TABA_CHECKOUT_BASE_URL: origin,
    TABA_ALLOWED_ORIGINS: origin,
    MERCADOPAGO_CLIENT_ID: production ? '7677852968049976' : '2691240967769590',
    MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  })) Deno.env.set(name, value);
  Deno.env.delete('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
}

type Scenario = {
  status?: string;
  tokenPresent?: boolean;
  sellerBusinessId?: string;
  sellerEnvironment?: string;
  settingsEnabled?: boolean;
};

async function runScenario(input: Scenario, valid = false) {
  configure();
  const token = await protect({ access_token: 'fixture-seller-token' }, businessId);
  const seller = {
    business_id: input.sellerBusinessId ?? businessId,
    environment: input.sellerEnvironment ?? 'test',
    status: input.status ?? 'connected',
    seller_id: sellerId,
    application_id: '2691240967769590',
    protected_tokens: input.tokenPresent === false ? null : token,
    expires_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    generation: '95000000-0000-4000-8000-000000000001',
    refresh_owner: null,
  };
  let providerCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.origin === 'https://api.mercadopago.com') {
      providerCalls += 1;
      return Response.json({ id: Number(sellerId), site_id: 'MLA', tags: ['test_user'] });
    }
    if (url.pathname.endsWith('/mp_seller_connections')) return Response.json(seller);
    if (url.pathname.endsWith('/businesses')) {
      return Response.json({ id: businessId, is_active: true, status: 'open', ordering_enabled: true, ordering_verified: true });
    }
    if (url.pathname.endsWith('/business_payment_settings')) {
      return Response.json({
        business_id: businessId,
        provider: 'mercadopago',
        enabled: input.settingsEnabled !== false,
        environment: 'test',
        checkout_mode: 'checkout_pro',
        currency: 'ARS',
        reserve_stock: true,
        production_review_status: 'not_requested',
        collector_id: sellerId,
        application_id: '2691240967769590',
      });
    }
    throw new Error(`Unexpected authority request: ${url}`);
  };
  try {
    if (valid) await assertCurrentSellerPaymentAuthority(businessId);
    else await assertRejects(() => assertCurrentSellerPaymentAuthority(businessId));
    assertEquals(providerCalls, valid ? 1 : 0);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('stored init_point rejects a disconnected seller', () => runScenario({ status: 'disconnected' }));
Deno.test('stored init_point rejects a seller requiring reauthorization', () => runScenario({ status: 'requires_reauthorization' }));
Deno.test('stored init_point rejects cleared seller tokens', () => runScenario({ tokenPresent: false }));
Deno.test('stored init_point rejects a seller row from another business', () => runScenario({ sellerBusinessId: '94000000-0000-4000-8000-000000000002' }));
Deno.test('stored init_point rejects a seller row from another environment', () => runScenario({ sellerEnvironment: 'production' }));
Deno.test('stored init_point rejects disabled payment settings', () => runScenario({ settingsEnabled: false }));
Deno.test('stored init_point accepts all-current seller authority', () => runScenario({}, true));

Deno.test('stored production init_point rejects absent real-payment authorization before provider access', async () => {
  configure('production');
  let providerCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    providerCalls += 1;
    return Promise.reject(new Error('provider must not be called'));
  };
  try {
    await assertRejects(() => assertCurrentSellerPaymentAuthority(businessId));
    assertEquals(providerCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
