import {
  createServiceClient,
  getRequiredEnv,
  providerEnvironment,
  PublicPaymentError,
  requireRealPaymentSmokeAuthorization,
} from "./payment-runtime.ts";
import { seal, unseal } from "./seller-oauth-crypto.ts";

const DEPLOYMENT_BINDINGS: Record<string, {
  deployment: "staging" | "production";
  paymentEnvironment: "test" | "production";
  oauthEnvironment: "test" | "production";
  clientId: string;
  supabaseUrl: string;
  panelUrl: string;
  checkoutBaseUrl: string;
  allowedOrigins: string;
}> = {
  ukxqbgswjlibmnjemrzd: {
    deployment: "staging",
    paymentEnvironment: "test",
    oauthEnvironment: "test",
    clientId: "2691240967769590",
    supabaseUrl: "https://ukxqbgswjlibmnjemrzd.supabase.co",
    panelUrl: "https://taba2-staging.pages.dev/",
    checkoutBaseUrl: "https://taba2-staging.pages.dev",
    allowedOrigins: "https://taba2-staging.pages.dev",
  },
  wwcpogltfgzgkrlilbcd: {
    deployment: "production",
    paymentEnvironment: "production",
    oauthEnvironment: "production",
    clientId: "7677852968049976",
    supabaseUrl: "https://wwcpogltfgzgkrlilbcd.supabase.co",
    panelUrl: "https://la-taba.pages.dev/",
    checkoutBaseUrl: "https://la-taba.pages.dev",
    allowedOrigins: "https://la-taba.pages.dev",
  },
};

export function oauthMode(): boolean {
  const mode = Deno.env.get("MERCADOPAGO_CREDENTIAL_MODE")?.trim() || "";
  let projectRef: string;
  try {
    projectRef = new URL(Deno.env.get("SUPABASE_URL") || "").hostname
      .replace(/\.supabase\.co$/i, "");
  } catch (_) {
    throw new Error("Unknown Mercado Pago deployment");
  }
  if (!DEPLOYMENT_BINDINGS[projectRef]) {
    throw new Error("Unknown Mercado Pago deployment");
  }
  if (mode !== "oauth") {
    throw new Error("Hosted Mercado Pago payments require seller OAuth mode");
  }
  return true;
}
export function oauthConfig() {
  const paymentEnvironment = providerEnvironment();
  const environment = getRequiredEnv("MERCADOPAGO_OAUTH_ENVIRONMENT");
  const deployment = getRequiredEnv("TABA_DEPLOYMENT_ENV");
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const expected = getRequiredEnv("MERCADOPAGO_OAUTH_PROJECT_REF");
  const clientId = getRequiredEnv("MERCADOPAGO_CLIENT_ID");
  const binding = DEPLOYMENT_BINDINGS[expected];
  const panelUrl = getRequiredEnv("MERCADOPAGO_OAUTH_PANEL_URL");
  const checkoutBaseUrl = getRequiredEnv("TABA_CHECKOUT_BASE_URL");
  const allowedOrigins = getRequiredEnv("TABA_ALLOWED_ORIGINS");
  if (!binding) throw new Error("Unknown Mercado Pago deployment");
  oauthMode();
  if (
    supabaseUrl !== binding.supabaseUrl ||
    deployment !== binding.deployment ||
    paymentEnvironment !== binding.paymentEnvironment ||
    environment !== binding.oauthEnvironment ||
    clientId !== binding.clientId ||
    panelUrl !== binding.panelUrl ||
    checkoutBaseUrl !== binding.checkoutBaseUrl ||
    allowedOrigins !== binding.allowedOrigins
  ) throw new Error("OAuth environment mismatch");
  const callback = `${binding.supabaseUrl}/functions/v1/mercadopago-oauth-callback`;
  const webhook = `${binding.supabaseUrl}/functions/v1/mercadopago-webhook`;
  return { environment: binding.oauthEnvironment, callback, webhook, panel: binding.panelUrl, clientId };
}
export function assertOAuthBusiness(_businessId: string) {
  oauthConfig();
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

export type PaymentAuthorityContext = {
  checkoutSessionId: string;
  customerId: string;
  paymentIntentId: string;
};
type AuthoritySeller = {
  business_id: string; environment: string; status: string; seller_id: string;
  application_id: string; protected_tokens: string | null; expires_at: string;
  generation: string; refresh_owner: string | null;
};
type PaymentAuthoritySnapshot = {
  authority_version: string;
  business: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  seller: AuthoritySeller | null;
  checkout: Record<string, unknown> | null;
};

async function paymentAuthoritySnapshot(
  businessId: string, environment: string, context: PaymentAuthorityContext,
): Promise<PaymentAuthoritySnapshot> {
  const { data, error } = await createServiceClient().rpc("get_mercadopago_payment_authority", {
    p_business_id: businessId, p_environment: environment,
    p_checkout_session_id: context.checkoutSessionId, p_customer_id: context.customerId,
  });
  if (error || !data) {
    throw new PublicPaymentError(409, "PAYMENT_AUTHORITY_UNAVAILABLE", "No pudimos verificar la autorización del pago. Intentá nuevamente.");
  }
  return data as PaymentAuthoritySnapshot;
}

function validatePaymentAuthority(
  snapshot: PaymentAuthoritySnapshot, businessId: string, environment: string,
  applicationId: string, context: PaymentAuthorityContext,
): AuthoritySeller {
  const { business, settings, seller, checkout } = snapshot;
  if (!business || business.id !== businessId || business.is_active !== true ||
    business.status !== "open" || business.ordering_enabled !== true ||
    business.ordering_verified !== true || checkout?.business_open !== true) {
    throw new PublicPaymentError(409, "BUSINESS_NOT_OPERATIONAL", "El comercio no está disponible para cobrar.");
  }
  if (!settings || settings.business_id !== businessId || settings.provider !== "mercadopago" ||
    settings.enabled !== true || settings.environment !== environment ||
    settings.checkout_mode !== "checkout_pro" || settings.currency !== "ARS" ||
    settings.reserve_stock !== true ||
    (environment === "production" && settings.production_review_status !== "approved")) {
    throw new PublicPaymentError(409, "PAYMENTS_NOT_ENABLED", "Mercado Pago no está habilitado.");
  }
  if (!checkout || checkout.id !== context.checkoutSessionId || checkout.customer_id !== context.customerId ||
    checkout.business_id !== businessId || checkout.payment_intent_id !== context.paymentIntentId ||
    checkout.environment !== environment || checkout.reservation_valid !== true ||
    !["ready_for_payment", "redirected", "payment_pending"].includes(String(checkout.status)) ||
    !(Date.parse(String(checkout.expires_at)) > Date.now())) {
    throw new PublicPaymentError(409, "CHECKOUT_NOT_AVAILABLE", "El checkout cambió o venció. Revisá el carrito.");
  }
  if (!seller || seller.business_id !== businessId || seller.environment !== environment ||
    seller.status !== "connected" || !seller.protected_tokens || !seller.seller_id || !seller.generation ||
    seller.refresh_owner || !(Date.parse(seller.expires_at) > Date.now()) ||
    seller.seller_id !== settings.collector_id ||
    seller.application_id !== applicationId || settings.application_id !== applicationId) {
    throw new PublicPaymentError(409, "SELLER_REAUTHORIZATION_REQUIRED", "Necesitamos volver a conectar Mercado Pago.");
  }
  if (!/^[a-f0-9]{64}$/.test(snapshot.authority_version || "")) {
    throw new PublicPaymentError(409, "PAYMENT_AUTHORITY_UNAVAILABLE", "No pudimos verificar la autorización del pago.");
  }
  return seller;
}

export async function assertCurrentSellerPaymentAuthority(
  businessId: string, context: PaymentAuthorityContext,
): Promise<void> {
  const environment = providerEnvironment();
  if (!oauthMode()) throw new Error("Seller OAuth mode required");
  const config = oauthConfig();
  requireRealPaymentSmokeAuthorization(environment);
  // Refresh first if necessary. The snapshot, not this return value, supplies
  // the exact ciphertext/generation/expiry whose credential is verified.
  await sellerAccessToken(businessId);
  const before = await paymentAuthoritySnapshot(businessId, environment, context);
  const seller = validatePaymentAuthority(before, businessId, environment, config.clientId, context);
  const material = await reveal(seller.protected_tokens!, businessId);
  const accessToken = material.access_token;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new PublicPaymentError(409, "SELLER_REAUTHORIZATION_REQUIRED", "Necesitamos volver a conectar Mercado Pago.");
  }
  try {
    await sellerIdentity(accessToken, seller.seller_id);
  } catch (error) {
    if (error instanceof OAuthProviderError && error.status === 401) {
      await invalidateRejectedToken(businessId, accessToken);
    }
    throw new PublicPaymentError(409, "SELLER_REAUTHORIZATION_REQUIRED", "Necesitamos volver a conectar Mercado Pago.");
  }
  // One MVCC snapshot covers the complete final decision. No transaction spans
  // provider I/O, and no provider call follows this final database read.
  const after = await paymentAuthoritySnapshot(businessId, environment, context);
  let finalConfig: ReturnType<typeof oauthConfig>;
  try {
    finalConfig = oauthConfig();
    requireRealPaymentSmokeAuthorization(providerEnvironment());
  } catch (_) {
    throw new PublicPaymentError(409, "PAYMENT_AUTHORITY_CHANGED", "La autorización del pago cambió. Intentá nuevamente.");
  }
  const current = validatePaymentAuthority(after, businessId, environment, config.clientId, context);
  if (JSON.stringify(finalConfig) !== JSON.stringify(config) ||
    after.authority_version !== before.authority_version ||
    current.generation !== seller.generation ||
    current.protected_tokens !== seller.protected_tokens) {
    throw new PublicPaymentError(409, "PAYMENT_AUTHORITY_CHANGED", "La autorización del pago cambió. Intentá nuevamente.");
  }
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
