import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  connection,
  oauthConfig,
  protect,
  sellerAccessToken,
  tokenGrant,
} from "./seller-oauth.ts";
import { randomSecret } from "./seller-oauth-crypto.ts";

const business = "92000000-0000-4000-8000-000000000001";
function configure() {
  for (
    const [name, value] of Object.entries({
      SUPABASE_URL: "https://oauth-fixture.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-server-key",
      MERCADOPAGO_ENVIRONMENT: "test",
      TABA_DEPLOYMENT_ENV: "staging",
      MERCADOPAGO_OAUTH_PROJECT_REF: "oauth-fixture",
      MERCADOPAGO_OAUTH_PANEL_URL: "https://staging.example.invalid/",
      MERCADOPAGO_CLIENT_ID: "123456",
      MERCADOPAGO_CLIENT_SECRET: "fixture-client-secret",
      MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(),
    })
  ) Deno.env.set(name, value);
}
const tokens = {
  access_token: "fixture-access",
  refresh_token: "fixture-refresh",
  user_id: 123,
  expires_in: 15552000,
  scope: "read write offline_access",
  live_mode: false,
};

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
Deno.test("refresh rotates once and subsequent readers use the persisted token", async () => {
  configure();
  let row = {
    business_id: business,
    environment: "test",
    seller_id: "123",
    status: "connected",
    protected_tokens: await protect(tokens, business),
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
