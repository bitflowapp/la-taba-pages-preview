import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  connection,
  invalidateRejectedToken,
  assertOAuthBusiness,
  assertOAuthPaymentEnvironment,
  oauthConfig,
  oauthMode,
  protect,
  sellerAccessToken,
  tokenGrant,
  sellerIdentity,
} from "./seller-oauth.ts";
import { randomSecret } from "./seller-oauth-crypto.ts";
import { mercadoPagoRequest } from "./mercadopago.ts";

const business = "92000000-0000-4000-8000-000000000001";
function configure() {
  Deno.env.delete("MERCADOPAGO_CREDENTIAL_MODE");
  Deno.env.delete("MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID");
  for (
    const [name, value] of Object.entries({
      SUPABASE_URL: "https://ukxqbgswjlibmnjemrzd.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-server-key",
      MERCADOPAGO_ENVIRONMENT: "test",
      MERCADOPAGO_OAUTH_ENVIRONMENT: "test",
      MERCADOPAGO_CREDENTIAL_MODE: "oauth",
      TABA_DEPLOYMENT_ENV: "staging",
      MERCADOPAGO_OAUTH_PROJECT_REF: "ukxqbgswjlibmnjemrzd",
      MERCADOPAGO_OAUTH_PANEL_URL: "https://taba2-staging.pages.dev/",
      TABA_CHECKOUT_BASE_URL: "https://taba2-staging.pages.dev",
      TABA_ALLOWED_ORIGINS: "https://taba2-staging.pages.dev",
      MERCADOPAGO_CLIENT_ID: "2691240967769590",
      MERCADOPAGO_CLIENT_SECRET: "fixture-client-secret",
      MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(),
    })
  ) Deno.env.set(name, value);
}
Deno.test("staging rejects every production-consent exception", async () => {
  configure();
  Deno.env.set("MERCADOPAGO_OAUTH_ENVIRONMENT", "production");
  await assertRejects(async () => oauthConfig());
  Deno.env.set("MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID", business);
  await assertRejects(async () => oauthConfig());
  configure();
  assertOAuthPaymentEnvironment();
});
Deno.test("seller identity uses provider tags to prevent test/production crossover", async () => {
  configure();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve(Response.json({id: 123, site_id: "MLA", tags: ["test_user"]}));
    assertEquals((await sellerIdentity("fixture", "123")).seller_id, "123");
    globalThis.fetch = () => Promise.resolve(Response.json({id: 123, site_id: "MLA", tags: ["normal"]}));
    await assertRejects(() => sellerIdentity("fixture", "123"));
    await assertRejects(() => sellerIdentity("fixture", "456"));
    configure();
    await assertRejects(() => sellerIdentity("fixture", "123"));
  } finally { globalThis.fetch = original; configure(); }
});
const tokens = {
  access_token: "fixture-access",
  refresh_token: "fixture-refresh",
  user_id: 123,
  expires_in: 15552000,
  scope: "read write offline_access",
  live_mode: false,
};

async function refreshFailureFixture(mode: string) {
  configure();
  const sealed = await protect(tokens, business);
  const row = {
    business_id: business, environment: 'test', seller_id: '123', status: 'connected',
    protected_tokens: sealed, scopes: tokens.scope, generation: 'fixture-generation',
    expires_at: new Date(Date.now() + (mode === 'stale_lease' || mode === 'rejected_access' ? 3 * 86400000 : 1000)).toISOString(),
    refresh_owner: mode === 'stale_lease' ? 'stale-owner' : null as string | null,
    refresh_started_at: mode === 'stale_lease' ? new Date(Date.now() - 61000).toISOString() : null,
  };
  const original = globalThis.fetch;
  const patches: Record<string, unknown>[] = [];
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const options = init as { method?: string; body?: unknown } | undefined;
    if (url.origin === 'https://api.mercadopago.com') {
      providerCalls++;
      assertEquals(url.pathname, '/oauth/token');
      if (mode === 'network') throw new TypeError('fixture network loss');
      if (mode === 'server') return Response.json({error:'temporarily_unavailable'}, {status:503});
      if (mode === 'invalid_grant') return Response.json({error:'invalid_grant'}, {status:400});
      return Response.json({...tokens, access_token:'rotated-access', refresh_token:'rotated-refresh'});
    }
    if (url.pathname.endsWith('/mp_seller_connections')) {
      if (options?.method === 'PATCH') {
        const patch = JSON.parse(String(options.body));
        patches.push(patch);
        Object.assign(row, patch);
      }
      return Response.json(row);
    }
    if (url.pathname.endsWith('/mp_claim_refresh')) {
      const body = JSON.parse(String(options?.body));
      if (row.refresh_owner) return Response.json([]);
      row.refresh_owner = body.p_owner;
      return Response.json([row]);
    }
    if (url.pathname.endsWith('/mp_finish_refresh')) {
      if (mode === 'persist_failure') return Response.json({message:'fixture persistence unavailable'}, {status:503});
      const body = JSON.parse(String(options?.body));
      row.protected_tokens = body.p_protected_tokens;
      row.expires_at = body.p_expires_at;
      row.refresh_owner = null;
      return Response.json(true);
    }
    throw Error('Unexpected refresh fixture request');
  };
  return {row, sealed, patches, providerCalls:()=>providerCalls, cleanup:()=>{globalThis.fetch=original;}};
}

for (const mode of ['network','server','persist_failure']) Deno.test(`OAuth ${mode} preserves the encrypted grant and does not demand seller consent`, async () => {
  const f = await refreshFailureFixture(mode);
  try {
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(f.row.status, 'connected');
    assertEquals(f.row.protected_tokens, f.sealed);
    assertEquals(f.row.refresh_owner, null);
    assertEquals(f.patches.some(patch => 'protected_tokens' in patch), false);
  } finally {f.cleanup();}
});

Deno.test('only a confirmed invalid_grant requires seller reauthorization, without deleting the sealed grant', async () => {
  const f = await refreshFailureFixture('invalid_grant');
  try {
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(f.row.status, 'requires_reauthorization');
    assertEquals(f.row.protected_tokens, f.sealed);
  } finally {f.cleanup();}
});

Deno.test('a stale refresh lease is recovered without revoking a still-valid seller', async () => {
  const f = await refreshFailureFixture('stale_lease');
  try {
    assertEquals(await sellerAccessToken(business), tokens.access_token);
    assertEquals(f.row.status, 'connected');
    assertEquals(f.row.protected_tokens, f.sealed);
    assertEquals(f.providerCalls(), 0);
  } finally {f.cleanup();}
});

Deno.test('an access-token 401 renews through the existing offline grant instead of reconnecting the seller', async () => {
  const f = await refreshFailureFixture('rejected_access');
  try {
    await invalidateRejectedToken(business, tokens.access_token);
    assertEquals(f.row.status, 'connected');
    assertEquals(f.row.protected_tokens, f.sealed);
    assertEquals(await sellerAccessToken(business), 'rotated-access');
    assertEquals(f.providerCalls(), 1);
    assertEquals(f.row.status, 'connected');
  } finally {f.cleanup();}
});

Deno.test('a stale 401 cannot expire a newer credential', async () => {
  const f = await refreshFailureFixture('rejected_access');
  try {
    const expiry = f.row.expires_at;
    await invalidateRejectedToken(business, 'obsolete-fixture-access');
    assertEquals(f.row.expires_at, expiry);
    assertEquals(f.patches.length, 0);
  } finally {f.cleanup();}
});

Deno.test("OAuth configuration rejects project and deployment crossover", () => {
  configure();
  assertEquals(oauthConfig().environment, "test");
  Deno.env.set("TABA_DEPLOYMENT_ENV", "production");
  let failed = false;
  try {
    oauthConfig();
  } catch (_) {
    failed = true;
  }
  assertEquals(failed, true);
});
Deno.test("OAuth contract rejects cross-origin, unknown-project and normalized bypasses", async () => {
  configure();
  for (const panel of [
    "https://la-taba.pages.dev/",
    "https://attacker.invalid/",
    "https://TABA2-STAGING.pages.dev/",
    "https://taba2-staging.pages.dev/path",
  ]) {
    Deno.env.set("MERCADOPAGO_OAUTH_PANEL_URL", panel);
    await assertRejects(async () => oauthConfig());
  }
  configure();
  Deno.env.set("SUPABASE_URL", "https://unknown-project.supabase.co");
  Deno.env.set("MERCADOPAGO_OAUTH_PROJECT_REF", "unknown-project");
  await assertRejects(async () => oauthConfig());
  configure();
  Deno.env.set("MERCADOPAGO_OAUTH_PROJECT_REF", "UKXQBGSwjlibmnjemrzd");
  await assertRejects(async () => oauthConfig());
});
Deno.test("known deployments reject the other Mercado Pago application", async () => {
  configure();
  Deno.env.set("MERCADOPAGO_CREDENTIAL_MODE", "oauth");
  Deno.env.set("SUPABASE_URL", "https://wwcpogltfgzgkrlilbcd.supabase.co");
  Deno.env.set("MERCADOPAGO_OAUTH_PROJECT_REF", "wwcpogltfgzgkrlilbcd");
  Deno.env.set("TABA_DEPLOYMENT_ENV", "production");
  Deno.env.set("MERCADOPAGO_ENVIRONMENT", "production");
  Deno.env.set("MERCADOPAGO_OAUTH_ENVIRONMENT", "production");
  Deno.env.set("MERCADOPAGO_PRODUCTION_REVIEW_STATUS", "approved");
  Deno.env.set("MERCADOPAGO_OAUTH_PANEL_URL", "https://la-taba.pages.dev/");
  Deno.env.set("TABA_CHECKOUT_BASE_URL", "https://la-taba.pages.dev");
  Deno.env.set("TABA_ALLOWED_ORIGINS", "https://la-taba.pages.dev");
  Deno.env.set("MERCADOPAGO_CLIENT_ID", "2691240967769590");
  await assertRejects(async () => oauthConfig());
  Deno.env.set("MERCADOPAGO_CLIENT_ID", "7677852968049976");
  assertEquals(oauthConfig().clientId, "7677852968049976");

  Deno.env.set("SUPABASE_URL", "https://ukxqbgswjlibmnjemrzd.supabase.co");
  Deno.env.set("MERCADOPAGO_OAUTH_PROJECT_REF", "ukxqbgswjlibmnjemrzd");
  Deno.env.set("TABA_DEPLOYMENT_ENV", "staging");
  Deno.env.set("MERCADOPAGO_ENVIRONMENT", "test");
  Deno.env.set("MERCADOPAGO_OAUTH_ENVIRONMENT", "test");
  Deno.env.delete("MERCADOPAGO_PRODUCTION_REVIEW_STATUS");
  Deno.env.set("MERCADOPAGO_OAUTH_PANEL_URL", "https://taba2-staging.pages.dev/");
  Deno.env.set("TABA_CHECKOUT_BASE_URL", "https://taba2-staging.pages.dev");
  Deno.env.set("TABA_ALLOWED_ORIGINS", "https://taba2-staging.pages.dev");
  Deno.env.set("MERCADOPAGO_CLIENT_ID", "7677852968049976");
  await assertRejects(async () => oauthConfig());
  Deno.env.set("MERCADOPAGO_CLIENT_ID", "2691240967769590");
  assertEquals(oauthConfig().clientId, "2691240967769590");
  configure();
});
Deno.test("controlled production binds only its own host, storefront and the La Taba Delivery application", async () => {
  configure();
  const cp = {
    MERCADOPAGO_CREDENTIAL_MODE: "oauth", SUPABASE_URL: "https://tkanbadcglszlcyfjvpv.supabase.co",
    MERCADOPAGO_OAUTH_PROJECT_REF: "tkanbadcglszlcyfjvpv", TABA_DEPLOYMENT_ENV: "production",
    MERCADOPAGO_ENVIRONMENT: "production", MERCADOPAGO_OAUTH_ENVIRONMENT: "production",
    MERCADOPAGO_PRODUCTION_REVIEW_STATUS: "approved", MERCADOPAGO_CLIENT_ID: "7677852968049976",
    MERCADOPAGO_OAUTH_PANEL_URL: "https://la-taba-commercial-pilot.pages.dev/",
    TABA_CHECKOUT_BASE_URL: "https://la-taba-commercial-pilot.pages.dev",
    TABA_ALLOWED_ORIGINS: "https://la-taba-commercial-pilot.pages.dev",
  };
  for (const [name, value] of Object.entries(cp)) Deno.env.set(name, value);
  const config = oauthConfig();
  assertEquals(config.clientId, "7677852968049976");
  assertEquals(config.callback, "https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/mercadopago-oauth-callback");
  assertEquals(config.webhook, "https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/mercadopago-webhook");
  // The staging application, the old production storefront or a test
  // environment cannot run under this project.
  Deno.env.set("MERCADOPAGO_CLIENT_ID", "2691240967769590");
  await assertRejects(async () => oauthConfig());
  Deno.env.set("MERCADOPAGO_CLIENT_ID", "7677852968049976");
  Deno.env.set("TABA_CHECKOUT_BASE_URL", "https://la-taba.pages.dev");
  await assertRejects(async () => oauthConfig());
  Deno.env.set("TABA_CHECKOUT_BASE_URL", "https://la-taba-commercial-pilot.pages.dev");
  Deno.env.set("MERCADOPAGO_OAUTH_ENVIRONMENT", "test");
  await assertRejects(async () => oauthConfig());
  Deno.env.set("MERCADOPAGO_OAUTH_ENVIRONMENT", "production");
  // Without the declared production review nothing starts.
  Deno.env.delete("MERCADOPAGO_PRODUCTION_REVIEW_STATUS");
  await assertRejects(async () => oauthConfig());
  configure();
});
Deno.test("known hosted projects cannot fall back to a global credential", async () => {
  configure();
  Deno.env.set("SUPABASE_URL", "https://wwcpogltfgzgkrlilbcd.supabase.co");
  // Even a globally present token cannot become payment authority in either
  // hosted project. Only the exact seller-OAuth mode may proceed.
  Deno.env.set("MERCADOPAGO_ACCESS_TOKEN", "fixture-global-token-must-stay-unused");
  for (const mode of [undefined, "legacy", "oath"]) {
    if (mode === undefined) Deno.env.delete("MERCADOPAGO_CREDENTIAL_MODE");
    else Deno.env.set("MERCADOPAGO_CREDENTIAL_MODE", mode);
    await assertRejects(async () => oauthMode());
  }
  Deno.env.set("MERCADOPAGO_CREDENTIAL_MODE", "oauth");
  assertEquals(oauthMode(), true);
  Deno.env.set("SUPABASE_URL", "https://ukxqbgswjlibmnjemrzd.supabase.co");
  Deno.env.set("MERCADOPAGO_CREDENTIAL_MODE", "legacy");
  await assertRejects(async () => oauthMode());
  Deno.env.set("MERCADOPAGO_CREDENTIAL_MODE", "oauth");
  assertEquals(oauthMode(), true);
  configure();
  Deno.env.delete("MERCADOPAGO_ACCESS_TOKEN");
});
Deno.test("a global token cannot reach the provider when hosted OAuth mode is invalid", async () => {
  configure();
  Deno.env.set("SUPABASE_URL", "https://wwcpogltfgzgkrlilbcd.supabase.co");
  Deno.env.set("MERCADOPAGO_ENVIRONMENT", "production");
  Deno.env.set("MERCADOPAGO_OAUTH_ENVIRONMENT", "production");
  Deno.env.set("MERCADOPAGO_PRODUCTION_REVIEW_STATUS", "approved");
  Deno.env.set("MERCADOPAGO_OAUTH_PROJECT_REF", "wwcpogltfgzgkrlilbcd");
  Deno.env.set("TABA_DEPLOYMENT_ENV", "production");
  Deno.env.set("MERCADOPAGO_CLIENT_ID", "7677852968049976");
  Deno.env.set("MERCADOPAGO_OAUTH_PANEL_URL", "https://la-taba.pages.dev/");
  Deno.env.set("TABA_CHECKOUT_BASE_URL", "https://la-taba.pages.dev");
  Deno.env.set("TABA_ALLOWED_ORIGINS", "https://la-taba.pages.dev");
  Deno.env.set("MERCADOPAGO_ACCESS_TOKEN", "fixture-global-token-must-stay-unused");
  let providerCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    providerCalls++;
    return Promise.resolve(Response.json({ id: 1 }));
  };
  try {
    for (const mode of [undefined, "legacy", "invalid"]) {
      if (mode === undefined) Deno.env.delete("MERCADOPAGO_CREDENTIAL_MODE");
      else Deno.env.set("MERCADOPAGO_CREDENTIAL_MODE", mode);
      await assertRejects(() =>
        mercadoPagoRequest("/v1/payments/1", {
          businessId: business,
        })
      );
    }
    assertEquals(providerCalls, 0);
  } finally {
    globalThis.fetch = original;
    Deno.env.delete("MERCADOPAGO_ACCESS_TOKEN");
    configure();
  }
});
Deno.test("refresh rotates once and subsequent readers use the persisted token", async () => {
  configure();
  let row = {
    business_id: business,
    environment: "test",
    seller_id: "123",
    status: "connected",
    protected_tokens: await protect(tokens, business) as string | null,
    expires_at: new Date(Date.now() + 1000).toISOString(),
    generation: "fixture-generation",
    refresh_owner: null as string | null,
  };
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    let result: unknown = row;
    if (url.includes("/oauth/token")) {
      calls++;
      const body = JSON.parse(String((init as {body?: unknown})?.body));
      assertEquals(body.grant_type, "refresh_token");
      assertEquals(body.test_token, true);
      result = {
        ...tokens,
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
      };
    } else if (url.includes("/rpc/mp_claim_refresh")) {
      const body = JSON.parse(String((init as {body?: unknown})?.body));
      if (row.refresh_owner) result = [];
      else {
        row.refresh_owner = body.p_owner;
        result = [row];
      }
    } else if (url.includes("/rpc/mp_finish_refresh")) {
      const body = JSON.parse(String((init as {body?: unknown})?.body));
      row = {
        ...row,
        protected_tokens: body.p_protected_tokens,
        expires_at: body.p_expires_at,
        refresh_owner: null,
      };
      result = true;
    }
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    assertEquals(await sellerAccessToken(business), "rotated-access");
    assertEquals(await sellerAccessToken(business), "rotated-access");
    assertEquals(calls, 1);
    row.refresh_owner = "other-owner";
    row.expires_at = new Date().toISOString();
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(calls, 1);
    row.status = "disconnected";
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(calls, 1);
    assertEquals((await connection(business)).status, "disconnected");
    row = {
      ...row,
      status: "connected",
      protected_tokens: null,
      expires_at: new Date(Date.now() + 86400000 * 2).toISOString(),
    };
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("OAuth rejects missing offline permission, wrong live mode and invalid grants", async () => {
  configure();
  const original = globalThis.fetch;
  try {
    for (
      const body of [{ ...tokens, scope: "read write" }, {
        ...tokens,
        live_mode: true,
      }, { error: "invalid_grant" }]
    ) {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: "error" in body ? 400 : 200,
          }),
        );
      await assertRejects(() =>
        tokenGrant({ grant_type: "authorization_code", code: "fixture" })
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
