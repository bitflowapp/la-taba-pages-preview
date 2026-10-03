import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  connection,
  assertOAuthBusiness,
  assertOAuthPaymentEnvironment,
  oauthConfig,
  oauthMode,
  protect,
  reveal,
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

// ── EDGE-08: la credencial del vendedor no se destruye por una señal que no la juzga ──
// Una conexión destruida saca a Mercado Pago de la tienda y deja sin leer los
// pagos en curso hasta que el dueño vuelve a consentir con su segundo factor.
// Sólo dos cosas dicen que la credencial ya no sirve: que el proveedor la
// rechace al preguntarle quién es (`/users/me`), o que rechace el refresh como
// concesión inválida.

type SellerRow = {
  business_id: string;
  environment: string;
  seller_id: string;
  status: string;
  protected_tokens: string | null;
  expires_at: string;
  generation: string;
  refresh_owner: string | null;
  refresh_started_at: string | null;
};
type ProviderReply = () => Response | Promise<Response>;

async function sellerHarness(
  overrides: Partial<SellerRow>,
  provider: { resource?: ProviderReply; identity?: ProviderReply; token?: ProviderReply; persist?: boolean },
) {
  configure();
  const row: SellerRow = {
    business_id: business,
    environment: "test",
    seller_id: "123",
    status: "connected",
    protected_tokens: await protect(tokens, business),
    expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
    generation: "fixture-generation",
    refresh_owner: null,
    refresh_started_at: null,
    ...overrides,
  };
  const calls = { identity: 0, token: 0, resource: 0 };
  const updates: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname.endsWith("/mp_seller_connections")) {
      if (init?.method !== "PATCH") return Response.json(row);
      // Las actualizaciones del runtime son comparar-y-escribir: sólo valen si
      // la fila sigue siendo la que se leyó.
      const expected = (column: keyof SellerRow) => {
        const filter = url.searchParams.get(column);
        return filter === null || filter === `eq.${row[column]}`;
      };
      if (expected("generation") && expected("refresh_owner") && expected("protected_tokens")) {
        updates.push(body);
        Object.assign(row, body);
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/rpc/mp_claim_refresh")) {
      if (row.refresh_owner || row.status !== "connected") return Response.json([]);
      row.refresh_owner = body.p_owner;
      row.refresh_started_at = new Date().toISOString();
      return Response.json([row]);
    }
    if (url.pathname.endsWith("/rpc/mp_finish_refresh")) {
      if (provider.persist === false || row.refresh_owner !== body.p_owner) return Response.json(false);
      Object.assign(row, {
        protected_tokens: body.p_protected_tokens,
        expires_at: body.p_expires_at,
        refresh_owner: null,
        refresh_started_at: null,
      });
      return Response.json(true);
    }
    if (url.pathname === "/users/me") {
      calls.identity++;
      assertEquals(new Headers(init?.headers).get("authorization"), "Bearer fixture-access");
      return await (provider.identity || (() => Response.json({ id: 123, site_id: "MLA", tags: ["test_user"] })))();
    }
    if (url.pathname === "/oauth/token") {
      calls.token++;
      assertEquals(body.grant_type, "refresh_token");
      assertEquals(body.refresh_token, "fixture-refresh");
      return await (provider.token || (() =>
        Response.json({ ...tokens, access_token: "rotated-access", refresh_token: "rotated-refresh" })))();
    }
    if (url.origin === "https://api.mercadopago.com") {
      calls.resource++;
      return await (provider.resource || (() => Response.json({ id: 1 })))();
    }
    throw new Error("Unexpected test request: " + url.pathname);
  };
  return { row, calls, updates, restore: () => { globalThis.fetch = original; } };
}

const dueSoon = () => ({ expires_at: new Date(Date.now() + 3600000).toISOString() });
const wiped = (updates: Record<string, unknown>[]) =>
  updates.some((update) => "protected_tokens" in update || update.status === "requires_reauthorization");

Deno.test("EDGE-08: un 401 sobre un recurso con la credencial todavía válida no destruye la conexión", async () => {
  const harness = await sellerHarness({}, {
    resource: () => Response.json({ message: "unauthorized" }, { status: 401 }),
  });
  try {
    const result = await mercadoPagoRequest("/v1/payments/179851082485/refunds", { businessId: business, method: "POST" });
    assertEquals(result.response.status, 401);
    // Se le preguntó al proveedor quién es esta credencial, y respondió.
    assertEquals(harness.calls.identity, 1);
    assertEquals(harness.updates, []);
    assertEquals(harness.row.status, "connected");
    assertEquals((await reveal(harness.row.protected_tokens!, business)).access_token, "fixture-access");
  } finally { harness.restore(); }
});

Deno.test("EDGE-08: un 401 que el proveedor confirma en /users/me sí pide reautorizar", async () => {
  const harness = await sellerHarness({}, {
    resource: () => Response.json({ message: "invalid access token" }, { status: 401 }),
    identity: () => Response.json({ message: "invalid access token" }, { status: 401 }),
  });
  try {
    const result = await mercadoPagoRequest("/v1/payments/1", { businessId: business });
    assertEquals(result.response.status, 401);
    assertEquals(harness.updates, [{ status: "requires_reauthorization", protected_tokens: null }]);
    assertEquals(harness.row.status, "requires_reauthorization");
  } finally { harness.restore(); }
});

for (const [name, identity] of Object.entries({
  "responde 500": () => Response.json({ message: "internal error" }, { status: 500 }),
  "responde 429": () => Response.json({ message: "too many requests" }, { status: 429 }),
  "no responde": () => Promise.reject(new TypeError("simulated network failure")),
} as Record<string, ProviderReply>)) {
  Deno.test(`EDGE-08: si /users/me ${name}, el 401 del recurso no alcanza para destruir la conexión`, async () => {
    const harness = await sellerHarness({}, {
      resource: () => Response.json({ message: "unauthorized" }, { status: 401 }),
      identity,
    });
    try {
      const result = await mercadoPagoRequest("/v1/payments/1", { businessId: business });
      assertEquals(result.response.status, 401);
      assertEquals(harness.updates, []);
      assertEquals(harness.row.status, "connected");
    } finally { harness.restore(); }
  });
}

for (const [name, token] of Object.entries({
  "un 503": () => Response.json({ message: "service unavailable" }, { status: 503 }),
  "un 500 sin cuerpo JSON": () => new Response("upstream error", { status: 500 }),
  "ninguna respuesta": () => Promise.reject(new DOMException("simulated timeout", "TimeoutError")),
} as Record<string, ProviderReply>)) {
  Deno.test(`EDGE-08: un refresh que termina en ${name} conserva la credencial vigente y queda para atender`, async () => {
    const harness = await sellerHarness(dueSoon(), { token });
    try {
      // La credencial actual vale una hora más: se sigue usando.
      assertEquals(await sellerAccessToken(business), "fixture-access");
      assertEquals(harness.calls.token, 1);
      assertEquals(wiped(harness.updates), false);
      assertEquals(harness.row.status, "connected");
      assertEquals((await reveal(harness.row.protected_tokens!, business)).refresh_token, "fixture-refresh");
      // Queda anotado: el reclamo se suelta y la marca de cuándo se intentó se conserva.
      assertEquals(harness.row.refresh_owner, null);
      assertEquals(typeof harness.row.refresh_started_at, "string");
      // Y no se vuelve a golpear al proveedor en cada pedido mientras dura la espera.
      assertEquals(await sellerAccessToken(business), "fixture-access");
      assertEquals(harness.calls.token, 1);
    } finally { harness.restore(); }
  });
}

Deno.test("EDGE-08: pasada la espera el refresh se reintenta y, si responde, la conexión queda sana", async () => {
  let answers = 0;
  const harness = await sellerHarness(dueSoon(), {
    token: () => (++answers === 1
      ? Response.json({ message: "service unavailable" }, { status: 503 })
      : Response.json({ ...tokens, access_token: "rotated-access", refresh_token: "rotated-refresh" })),
  });
  try {
    assertEquals(await sellerAccessToken(business), "fixture-access");
    // Simula que el intento anterior fue hace diez minutos.
    harness.row.refresh_started_at = new Date(Date.now() - 600000).toISOString();
    assertEquals(await sellerAccessToken(business), "rotated-access");
    assertEquals(harness.calls.token, 2);
    assertEquals(harness.row.refresh_owner, null);
    assertEquals(harness.row.refresh_started_at, null);
    assertEquals(wiped(harness.updates), false);
  } finally { harness.restore(); }
});

Deno.test("EDGE-08: el refresh que quedó a medias de un worker caído no destruye la credencial", async () => {
  const harness = await sellerHarness({
    ...dueSoon(),
    refresh_owner: "9a000000-0000-4000-8000-000000000001",
    refresh_started_at: new Date(Date.now() - 120000).toISOString(),
  }, {});
  try {
    // El reclamo viejo se suelta, la credencial vigente se sigue usando y no se
    // insiste todavía contra el proveedor.
    assertEquals(await sellerAccessToken(business), "fixture-access");
    assertEquals(harness.calls.token, 0);
    assertEquals(harness.updates, [{ refresh_owner: null }]);
    assertEquals(harness.row.status, "connected");
    // Pasada la espera se reintenta, y esta vez responde.
    harness.row.refresh_started_at = new Date(Date.now() - 600000).toISOString();
    assertEquals(await sellerAccessToken(business), "rotated-access");
    assertEquals(wiped(harness.updates), false);
    assertEquals(harness.row.refresh_started_at, null);
  } finally { harness.restore(); }
});

Deno.test("EDGE-08: un refresh en curso de otro proceso sigue respondiendo «reintentá», sin tocar nada", async () => {
  const harness = await sellerHarness({
    ...dueSoon(),
    refresh_owner: "9a000000-0000-4000-8000-000000000001",
    refresh_started_at: new Date(Date.now() - 5000).toISOString(),
  }, {});
  try {
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(harness.calls.token, 0);
    assertEquals(harness.updates, []);
  } finally { harness.restore(); }
});

Deno.test("EDGE-08: si no se pudo guardar el refresh, la credencial anterior sigue en uso", async () => {
  const harness = await sellerHarness(dueSoon(), { persist: false });
  try {
    assertEquals(await sellerAccessToken(business), "fixture-access");
    assertEquals(wiped(harness.updates), false);
    assertEquals(harness.row.refresh_owner, null);
  } finally { harness.restore(); }
});

Deno.test("EDGE-08: un rechazo de configuración del refresh tampoco deja sin credencial vigente", async () => {
  const harness = await sellerHarness(dueSoon(), {
    token: () => Response.json({ error: "invalid_client" }, { status: 401 }),
  });
  try {
    assertEquals(await sellerAccessToken(business), "fixture-access");
    assertEquals(wiped(harness.updates), false);
    assertEquals(harness.row.status, "connected");
  } finally { harness.restore(); }
});

Deno.test("EDGE-08: con la credencial ya vencida un refresh dudoso falla, pero no borra nada", async () => {
  const harness = await sellerHarness({ expires_at: new Date(Date.now() - 1000).toISOString() }, {
    token: () => Response.json({ message: "service unavailable" }, { status: 503 }),
  });
  try {
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(wiped(harness.updates), false);
    assertEquals(harness.row.status, "connected");
    // Dentro de la espera no se devuelve una credencial vencida ni se insiste.
    await assertRejects(() => sellerAccessToken(business));
    assertEquals(harness.calls.token, 1);
  } finally { harness.restore(); }
});

for (const [name, token] of Object.entries({
  "invalid_grant": () => Response.json({ error: "invalid_grant" }, { status: 400 }),
  "otro vendedor": () => Response.json({ ...tokens, user_id: 999, access_token: "other-access" }),
  "una respuesta sin permiso de refresh": () => Response.json({ ...tokens, scope: "read write" }),
} as Record<string, ProviderReply>)) {
  Deno.test(`EDGE-08: un refresh que devuelve ${name} sigue pidiendo reautorizar`, async () => {
    const harness = await sellerHarness(dueSoon(), { token });
    try {
      await assertRejects(() => sellerAccessToken(business));
      assertEquals(harness.row.status, "requires_reauthorization");
      assertEquals(harness.row.protected_tokens, null);
    } finally { harness.restore(); }
  });
}
