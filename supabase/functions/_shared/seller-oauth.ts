import {
  createServiceClient,
  getRequiredEnv,
  providerEnvironment,
  PublicPaymentError,
} from "./payment-runtime.ts";
import { seal, unseal } from "./seller-oauth-crypto.ts";

export const oauthMode = () =>
  Deno.env.get("MERCADOPAGO_CREDENTIAL_MODE") === "oauth";
export function oauthConfig() {
  const paymentEnvironment = providerEnvironment();
  const environment = Deno.env.get("MERCADOPAGO_OAUTH_ENVIRONMENT") || paymentEnvironment;
  const deployment = getRequiredEnv("TABA_DEPLOYMENT_ENV");
  const onboardingBusinessId = Deno.env.get("MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID") || "";
  const isolatedConsent = deployment === "staging" && paymentEnvironment === "test" &&
    environment === "production" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(onboardingBusinessId);
  const project = new URL(getRequiredEnv("SUPABASE_URL"));
  const expected = getRequiredEnv("MERCADOPAGO_OAUTH_PROJECT_REF");
  if (
    project.hostname !== `${expected}.supabase.co` ||
    !["test", "production"].includes(environment) ||
    (!isolatedConsent && ((environment === "production") !== (deployment === "production") || environment !== paymentEnvironment)) ||
    !["staging", "production"].includes(deployment)
  ) throw new Error("OAuth environment mismatch");
  const callback = `${project.origin}/functions/v1/mercadopago-oauth-callback`;
  const panel = new URL(getRequiredEnv("MERCADOPAGO_OAUTH_PANEL_URL"));
  if (
    panel.protocol !== "https:" || panel.username || panel.password ||
    panel.search || panel.hash
  ) throw new Error("Invalid panel URL");
  const clientId = getRequiredEnv("MERCADOPAGO_CLIENT_ID");
  if (!/^\d+$/.test(clientId)) throw new Error("Invalid application ID");
  return { environment: environment as "test" | "production", callback, panel: panel.toString(), clientId, onboardingBusinessId: isolatedConsent ? onboardingBusinessId : "" };
}
export function assertOAuthBusiness(businessId: string) {
  const config = oauthConfig();
  if (config.onboardingBusinessId && businessId !== config.onboardingBusinessId) {
    throw new Error("Business is outside the isolated onboarding scope");
  }
}
export function assertOAuthPaymentEnvironment() {
  if (oauthConfig().environment !== providerEnvironment()) {
    throw new Error("Seller consent is isolated from payment execution");
  }
}
export function protectionContext(
  businessId: string,
  purpose = "tokens",
): string {
  assertOAuthBusiness(businessId);
  const c = oauthConfig();
  return `${
    getRequiredEnv("MERCADOPAGO_OAUTH_PROJECT_REF")
  }:${c.environment}:${c.clientId}:${businessId}:${purpose}`;
}
export const protect = (
  value: unknown,
  businessId: string,
  purpose = "tokens",
) =>
  seal(
    value,
    getRequiredEnv("MERCADOPAGO_TOKEN_ENCRYPTION_KEY"),
    protectionContext(businessId, purpose),
  );
export const reveal = (value: string, businessId: string, purpose = "tokens") =>
  unseal(
    value,
    getRequiredEnv("MERCADOPAGO_TOKEN_ENCRYPTION_KEY"),
    protectionContext(businessId, purpose),
  );
export function audit(
  event: string,
  businessId: string,
  correlationId: string,
) {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      business_id: businessId,
      correlation_id: correlationId,
    }),
  );
}
export class OAuthProviderError extends Error {
  constructor(public status: number, public invalidGrant: boolean) {
    super("OAuth provider unavailable");
  }
}
export async function tokenGrant(
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const c = oauthConfig();
  const response = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      ...fields,
      client_id: c.clientId,
      client_secret: getRequiredEnv("MERCADOPAGO_CLIENT_SECRET"),
      test_token: c.environment === "test",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new OAuthProviderError(
      response.status,
      body.error === "invalid_grant",
    );
  }
  if (
    !body.access_token || !body.refresh_token || !body.user_id ||
    !Number.isFinite(body.expires_in) || body.expires_in <= 0 ||
    !String(body.scope).split(" ").includes("offline_access") ||
    body.live_mode !== (c.environment === "production")
  ) throw new Error("Invalid OAuth token response");
  return body;
}
export async function sellerIdentity(accessToken: string, sellerId: string) {
  const response = await fetch("https://api.mercadopago.com/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new OAuthProviderError(response.status, false);
  if (String(body.id) !== sellerId || body.site_id !== "MLA") {
    throw new Error("Seller identity mismatch");
  }
  if (!Array.isArray(body.tags) || body.tags.includes("test_user") !== (oauthConfig().environment === "test")) {
    throw new Error("Seller account environment mismatch");
  }
  return { seller_id: sellerId };
}
export async function connection(businessId: string) {
  assertOAuthBusiness(businessId);
  const { data, error } = await createServiceClient().from(
    "mp_seller_connections",
  ).select("*").eq("business_id", businessId).eq(
    "environment",
    oauthConfig().environment,
  ).maybeSingle();
  if (error) throw new Error("Connection unavailable");
  return data;
}
export async function sellerAccessToken(businessId: string): Promise<string> {
  const service = createServiceClient();
  const environment = oauthConfig().environment;
  let row = await connection(businessId);
  if (!row || row.status !== "connected") {
    throw new PublicPaymentError(
      409,
      "SELLER_REAUTHORIZATION_REQUIRED",
      "Necesitamos volver a conectar Mercado Pago.",
    );
  }
  if (
    row.refresh_owner && Date.parse(row.refresh_started_at) < Date.now() - 60000
  ) {
    await service.from("mp_seller_connections").update({
      status: "requires_reauthorization",
      protected_tokens: null,
    }).eq("business_id", businessId).eq("environment", environment).eq(
      "generation",
      row.generation,
    ).eq("refresh_owner", row.refresh_owner);
    throw new Error("Refresh outcome unknown");
  }
  if (
    Date.parse(row.expires_at) > Date.now() + 86400000 && !row.refresh_owner
  ) {
    return String(
      (await reveal(row.protected_tokens, businessId)).access_token,
    );
  }
  const owner = crypto.randomUUID();
  const claim = await service.rpc("mp_claim_refresh", {
    p_business_id: businessId,
    p_environment: environment,
    p_owner: owner,
  });
  if (claim.error) throw new Error("Refresh claim unavailable");
  row = claim.data?.[0];
  if (!row) {
    throw new PublicPaymentError(
      409,
      "SELLER_REFRESHING",
      "Estamos verificando la conexión. Intentá nuevamente en unos segundos.",
    );
  }
  try {
    const old = await reveal(row.protected_tokens, businessId);
    const tokens = await tokenGrant({
      grant_type: "refresh_token",
      refresh_token: old.refresh_token,
    });
    if (String(tokens.user_id) !== row.seller_id) {
      throw new Error("Refreshed seller mismatch");
    }
    const saved = await service.rpc("mp_finish_refresh", {
      p_business_id: businessId,
      p_environment: environment,
      p_owner: owner,
      p_generation: row.generation,
      p_protected_tokens: await protect(tokens, businessId),
      p_expires_at: new Date(Date.now() + Number(tokens.expires_in) * 1000)
        .toISOString(),
      p_scopes: String(tokens.scope),
    });
    if (saved.error || saved.data !== true) {
      throw new Error("Unable to persist refresh");
    }
    audit("token_refresh_success", businessId, owner);
    return String(tokens.access_token);
  } catch (error) {
    // Definite configuration rejection is retryable; invalid/ambiguous rotating grants are not.
    const definite = error instanceof OAuthProviderError &&
      !error.invalidGrant && error.status >= 400 && error.status < 500;
    await service.from("mp_seller_connections").update(
      definite ? { refresh_owner: null, refresh_started_at: null } : {
        status: "requires_reauthorization",
        protected_tokens: null,
        refresh_owner: null,
        refresh_started_at: null,
      },
    )
      .eq("business_id", businessId).eq("environment", environment).eq(
        "generation",
        row.generation,
      ).eq("refresh_owner", owner);
    audit("token_refresh_failed", businessId, owner);
    throw new Error("Seller refresh unavailable");
  }
}
export async function businessForIntent(intentId: string): Promise<string> {
  const { data, error } = await createServiceClient().from("payment_intents")
    .select("business_id,environment").eq("id", intentId).single();
  if (error || !data || data.environment !== providerEnvironment()) {
    throw new Error("Invalid payment tenant");
  }
  return String(data.business_id);
}

export async function invalidateRejectedToken(
  businessId: string,
  rejectedToken: string,
) {
  const row = await connection(businessId);
  if (!row?.protected_tokens || row.status !== "connected") return;
  const current = await reveal(row.protected_tokens, businessId);
  if (current.access_token !== rejectedToken) return;
  const updated = await createServiceClient().from("mp_seller_connections")
    .update({ status: "requires_reauthorization", protected_tokens: null })
    .eq("business_id", businessId).eq("environment", oauthConfig().environment)
    .eq("generation", row.generation).eq(
      "protected_tokens",
      row.protected_tokens,
    );
  if (updated.error) {
    throw new Error("Unable to persist rejected authorization");
  }
}
