import {
  createServiceClient,
  getRequiredEnv,
  providerEnvironment,
  PublicPaymentError,
  requireRealMoneyGate,
} from "./payment-runtime.ts";
import { businessPaymentsEnabled, sellerConnected } from "./real-money-gate.ts";
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
  ucbtjcurawxjwjdvvcvj: {
    deployment: "staging",
    paymentEnvironment: "test",
    oauthEnvironment: "test",
    clientId: "2691240967769590",
    supabaseUrl: "https://ucbtjcurawxjwjdvvcvj.supabase.co",
    panelUrl: "https://taba2-staging.pages.dev/",
    checkoutBaseUrl: "https://taba2-staging.pages.dev",
    allowedOrigins: "https://taba2-staging.pages.dev",
  },
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
  // CONTROLLED_PRODUCTION: same La Taba Delivery application as the original
  // production project, its own callback/webhook host and storefront. Dormant
  // until the owner registers this callback and webhook in that application
  // and loads the project's secrets; without them every function fails closed.
  tkanbadcglszlcyfjvpv: {
    deployment: "production",
    paymentEnvironment: "production",
    oauthEnvironment: "production",
    clientId: "7677852968049976",
    supabaseUrl: "https://tkanbadcglszlcyfjvpv.supabase.co",
    panelUrl: "https://la-taba-commercial-pilot.pages.dev/",
    checkoutBaseUrl: "https://la-taba-commercial-pilot.pages.dev",
    allowedOrigins: "https://la-taba-commercial-pilot.pages.dev",
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
// El pedido de token salió y no volvió respuesta (corte, plazo vencido): no se
// sabe si el proveedor lo procesó.
export class OAuthTransportError extends Error {
  constructor() {
    super("OAuth provider did not answer");
  }
}
// El proveedor respondió 200 con material que no sirve (sin permiso de refresh,
// otro modo, campos faltantes). Es una respuesta, no una duda.
export class OAuthTokenResponseError extends Error {
  constructor() {
    super("Invalid OAuth token response");
  }
}
export async function tokenGrant(
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const c = oauthConfig();
  // El cuerpo se arma ANTES de salir: una configuración local faltante no es
  // una respuesta dudosa del proveedor, y quien llama las distingue.
  const payload = JSON.stringify({
    ...fields,
    client_id: c.clientId,
    client_secret: getRequiredEnv("MERCADOPAGO_CLIENT_SECRET"),
    test_token: c.environment === "test",
  });
  let response: Response;
  try {
    response = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(12000),
      body: payload,
    });
  } catch (_) {
    throw new OAuthTransportError();
  }
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
    (body.live_mode === true) !== (c.environment === "production")
  ) throw new OAuthTokenResponseError();
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
// Un reclamo de refresh más viejo que esto ya no está en curso: la llamada al
// proveedor corta a los 12 s.
const REFRESH_CLAIM_STALE_MS = 60_000;
// Cuánto se espera para volver a intentar un refresh que no terminó. Sin esta
// espera, cada pedido de pago repetía contra el proveedor una llamada de hasta
// 12 s mientras durara su caída.
const REFRESH_RETRY_AFTER_MS = 5 * 60_000;
const REFRESH_DUE_BEFORE_EXPIRY_MS = 86_400_000;

/**
 * La credencial vigente del vendedor, renovándola cuando le queda menos de un
 * día.
 *
 * QUÉ DESTRUYE UNA CONEXIÓN Y QUÉ NO. Pasar a `requires_reauthorization` saca a
 * Mercado Pago de la tienda y deja sin leer los pagos en curso hasta que el
 * dueño vuelve a consentir. Eso sólo corresponde cuando el proveedor RESPONDE
 * que la concesión ya no vale (`invalid_grant`), o devuelve material de otro
 * vendedor o inservible. Un corte, un plazo vencido, un 5xx, no poder guardar el
 * resultado o un reclamo que quedó a medias no dicen nada sobre la credencial:
 * la que está guardada sigue sirviendo hasta que vence, y se sigue usando.
 *
 * CÓMO QUEDA ANOTADO. Un refresh que no terminó suelta el reclamo
 * (`refresh_owner` nulo) y CONSERVA `refresh_started_at`: esa combinación es
 * «refresh pendiente de atención desde tal hora». Sirve de espera entre
 * reintentos y es lo que puede leer una alerta. Un refresh que termina bien
 * limpia las dos columnas (`mp_finish_refresh`).
 *
 * POR QUÉ SE REINTENTA con el mismo refresh token. Si el intento dudoso no
 * llegó a ejecutarse, el reintento conecta y no hubo nada que lamentar. Si sí
 * se había ejecutado, el proveedor responde `invalid_grant` y recién ahí —con
 * una respuesta, no con una duda— se pide reautorizar. Nunca hay dos refresh a
 * la vez: el reclamo sigue siendo de a uno.
 */
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
  const releaseClaim = (claimOwner: string, generation: string) =>
    service.from("mp_seller_connections").update({ refresh_owner: null })
      .eq("business_id", businessId).eq("environment", environment)
      .eq("generation", generation).eq("refresh_owner", claimOwner);
  const lastAttemptAt = Date.parse(row.refresh_started_at);
  if (row.refresh_owner && lastAttemptAt < Date.now() - REFRESH_CLAIM_STALE_MS) {
    // Quien tomó el refresh no lo terminó (el proceso murió, o no pudo soltar el
    // reclamo). No se sabe cómo salió, y eso no es una revocación.
    const released = await releaseClaim(row.refresh_owner, row.generation);
    if (released.error) throw new Error("Refresh claim unavailable");
    audit("token_refresh_needs_attention", businessId, String(row.refresh_owner));
    row = { ...row, refresh_owner: null };
  }
  const expiresAt = Date.parse(row.expires_at);
  if (!row.refresh_owner) {
    if (expiresAt > Date.now() + REFRESH_DUE_BEFORE_EXPIRY_MS) {
      return String(
        (await reveal(row.protected_tokens, businessId)).access_token,
      );
    }
    if (lastAttemptAt > Date.now() - REFRESH_RETRY_AFTER_MS) {
      // Hubo un intento hace poco que no terminó. Mientras dura la espera se usa
      // la credencial vigente; si ya venció no hay nada que devolver.
      if (expiresAt > Date.now()) {
        return String(
          (await reveal(row.protected_tokens, businessId)).access_token,
        );
      }
      throw new Error("Seller refresh unavailable");
    }
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
  let currentAccessToken = "";
  try {
    const old = await reveal(row.protected_tokens, businessId);
    currentAccessToken = typeof old.access_token === "string" ? old.access_token : "";
    const tokens = await tokenGrant({
      grant_type: "refresh_token",
      refresh_token: old.refresh_token,
    });
    if (String(tokens.user_id) !== row.seller_id) {
      throw new RefreshedSellerMismatchError();
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
    // Sólo una RESPUESTA del proveedor que invalida la concesión pide volver a
    // consentir. Todo lo demás conserva lo guardado.
    const revoked = (error instanceof OAuthProviderError && error.invalidGrant) ||
      error instanceof OAuthTokenResponseError ||
      error instanceof RefreshedSellerMismatchError;
    if (revoked) {
      await service.from("mp_seller_connections").update({
        status: "requires_reauthorization",
        protected_tokens: null,
        refresh_owner: null,
        refresh_started_at: null,
      })
        .eq("business_id", businessId).eq("environment", environment).eq(
          "generation",
          row.generation,
        ).eq("refresh_owner", owner);
      audit("token_refresh_failed", businessId, owner);
      throw new Error("Seller refresh unavailable");
    }
    // Un 4xx que no es `invalid_grant` es un rechazo de configuración (se
    // corrige y se reintenta); el resto es un resultado desconocido. En los dos
    // casos se suelta el reclamo dejando la marca de cuándo se intentó.
    await releaseClaim(owner, row.generation);
    const configurationRejected = error instanceof OAuthProviderError &&
      error.status >= 400 && error.status < 500;
    audit(
      configurationRejected ? "token_refresh_failed" : "token_refresh_needs_attention",
      businessId,
      owner,
    );
    if (currentAccessToken && Date.parse(row.expires_at) > Date.now()) {
      return currentAccessToken;
    }
    throw new Error("Seller refresh unavailable");
  }
}
class RefreshedSellerMismatchError extends Error {
  constructor() {
    super("Refreshed seller mismatch");
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
  paymentAttemptId: string;
  attemptNumber: number;
  idempotencyKey: string;
  preferenceId: string | null;
  initPoint: string | null;
};
type AuthoritySeller = {
  business_id: string; environment: string; status: string; seller_id: string;
  application_id: string; protected_tokens: string | null; expires_at: string;
  generation: string; refresh_owner: string | null;
};
export type PaymentAuthoritySnapshot = {
  authority_version: string;
  business: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  seller: AuthoritySeller | null;
  checkout: Record<string, unknown> | null;
  attempt: Record<string, unknown>;
  intent: Record<string, unknown>;
};

async function paymentAuthoritySnapshot(
  businessId: string, environment: string, context: PaymentAuthorityContext,
): Promise<PaymentAuthoritySnapshot> {
  const { data, error } = await createServiceClient().rpc("get_mercadopago_payment_authority_v2", {
    p_business_id: businessId, p_environment: environment,
    p_checkout_session_id: context.checkoutSessionId, p_customer_id: context.customerId,
    p_payment_attempt_id: context.paymentAttemptId,
  });
  if (error || !data) {
    throw new PublicPaymentError(409, "PAYMENT_AUTHORITY_UNAVAILABLE", "No pudimos verificar la autorización del pago. Intentá nuevamente.");
  }
  return data as PaymentAuthoritySnapshot;
}

function validatePaymentAuthority(
  snapshot: PaymentAuthoritySnapshot, businessId: string, environment: string,
  applicationId: string, context: PaymentAuthorityContext,
  ready = true,
): AuthoritySeller {
  const { business, settings, seller, checkout } = snapshot;
  if (!business || business.id !== businessId || business.is_active !== true ||
    business.status !== "open" || business.ordering_enabled !== true ||
    business.ordering_verified !== true || checkout?.business_open !== true) {
    throw new PublicPaymentError(409, "BUSINESS_NOT_OPERATIONAL", "El comercio no está disponible para cobrar.");
  }
  // Comercio y vendedor se juzgan con los mismos predicados que el estado del
  // interruptor de dinero real (real-money-gate.ts): no hay una segunda copia.
  if (!settings || !businessPaymentsEnabled(settings, businessId, environment)) {
    throw new PublicPaymentError(409, "PAYMENTS_NOT_ENABLED", "Mercado Pago no está habilitado.");
  }
  if (!checkout || checkout.id !== context.checkoutSessionId || checkout.customer_id !== context.customerId ||
    checkout.business_id !== businessId || checkout.payment_intent_id !== context.paymentIntentId ||
    checkout.environment !== environment || checkout.reservation_valid !== true ||
    !["ready_for_payment", "redirected", "payment_pending"].includes(String(checkout.status)) ||
    !(Date.parse(String(checkout.expires_at)) > Date.now())) {
    throw new PublicPaymentError(409, "CHECKOUT_NOT_AVAILABLE", "El checkout cambió o venció. Revisá el carrito.");
  }
  if (!seller || !sellerConnected(seller, settings, businessId, environment, applicationId, Date.now())) {
    throw new PublicPaymentError(409, "SELLER_REAUTHORIZATION_REQUIRED", "Necesitamos volver a conectar Mercado Pago.");
  }
  if (!/^[a-f0-9]{64}$/.test(snapshot.authority_version || "")) {
    throw new PublicPaymentError(409, "PAYMENT_AUTHORITY_UNAVAILABLE", "No pudimos verificar la autorización del pago.");
  }
  const { attempt, intent } = snapshot;
  if (!attempt || !intent || attempt.id !== context.paymentAttemptId ||
    attempt.payment_intent_id !== context.paymentIntentId || attempt.attempt_type !== "preference" ||
    attempt.attempt_number !== context.attemptNumber || attempt.idempotency_key !== context.idempotencyKey ||
    !(Number(attempt.authority_revision) >= 1) || intent.id !== context.paymentIntentId ||
    intent.business_id !== businessId || intent.checkout_session_id !== context.checkoutSessionId ||
    (intent.current_payment_attempt_id !== context.paymentAttemptId &&
      (ready || intent.current_payment_attempt_id != null)) ||
    !["created", "preference_creating", "preference_created", "redirected", "ambiguous"].includes(String(intent.internal_status)) ||
    !["prepared", "request_sent", "ambiguous", "created"].includes(String(attempt.status)) ||
    attempt.preference_id !== context.preferenceId || attempt.init_point !== context.initPoint ||
    (ready && (attempt.status !== "created" || !context.preferenceId || !context.initPoint ||
      intent.preference_id !== context.preferenceId || attempt.seller_id !== seller.seller_id ||
      attempt.seller_generation !== seller.generation))) {
    throw new PublicPaymentError(409, "PAYMENT_ATTEMPT_CHANGED", "El intento de pago cambió. Revisá el carrito.");
  }
  return seller;
}

/**
 * La compuerta de despliegue para CREAR un cobro: lo que tiene que ser cierto en
 * la configuración de este proyecto, antes de mirar el negocio, el vendedor o el
 * checkout, para que se pueda emitir una preferencia. No toca la base ni llama
 * al proveedor.
 *
 * Es UNA sola función a propósito. `mercadopago-create-preference` la evalúa
 * acá abajo; `mercadopago-create-checkout-session` la evalúa ANTES de reservar
 * stock. Cuando cada uno tenía su propia idea de «se puede cobrar», la sesión
 * se creaba, el stock quedaba reservado quince minutos y recién después la
 * preferencia respondía que no: en producción, con la compuerta cerrada, eso
 * era cada cliente que tocaba pagar.
 *
 * EL INTERRUPTOR DE DINERO REAL (EDGE-03, decisión del dueño). En producción
 * la cuarta comprobación es el secreto MERCADOPAGO_REAL_MONEY_ENABLED con el
 * valor exacto `enabled`, evaluado por `realMoneyGateState` (real-money-gate.ts).
 * La variable vieja de la prueba de humo ya no abre nada. En test el interruptor
 * no se pide: ahí la credencial misma es de prueba (binding del proyecto,
 * `live_mode` del token, vendedor `test_user`).
 *
 * Sólo la evalúan los caminos que CREAN un cobro. Reembolsos, cancelaciones,
 * webhook, worker, conciliación y pantalla de estado no la consultan: cerrar el
 * dinero real nunca traba la plata que vuelve.
 */
export function assertPaymentCreationGate() {
  const environment = providerEnvironment();
  if (!oauthMode()) throw new Error("Seller OAuth mode required");
  const config = oauthConfig();
  requireRealMoneyGate(environment);
  return { environment, config };
}

export async function beginSellerPaymentAuthority(businessId: string, context: PaymentAuthorityContext) {
  const { environment, config } = assertPaymentCreationGate();
  await sellerAccessToken(businessId);
  const snapshot = await paymentAuthoritySnapshot(businessId, environment, context);
  const seller = validatePaymentAuthority(snapshot, businessId, environment, config.clientId, context, false);
  const material = await reveal(seller.protected_tokens!, businessId);
  if (typeof material.access_token !== "string" || !material.access_token.trim()) {
    throw new PublicPaymentError(409, "SELLER_REAUTHORIZATION_REQUIRED", "Necesitamos volver a conectar Mercado Pago.");
  }
  return { snapshot, accessToken: material.access_token };
}

export async function assertCurrentSellerPaymentAuthority(
  businessId: string, context: PaymentAuthorityContext,
  before: PaymentAuthoritySnapshot,
): Promise<void> {
  const { environment, config } = assertPaymentCreationGate();
  // Refresh first if necessary. The snapshot, not this return value, supplies
  // the exact ciphertext/generation/expiry whose credential is verified.
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
    finalConfig = assertPaymentCreationGate().config;
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

/**
 * Qué hacer cuando un recurso del proveedor (un pago, un reembolso, una orden,
 * una preferencia) responde 401.
 *
 * Ese 401 no dice que la credencial esté revocada: Mercado Pago lo usa también
 * cuando la credencial es válida y no alcanza a ESE recurso (medido el
 * 2026-09-25, docs/MERCADOPAGO_FINALIZATION_2026-09-25.md §3:
 * `POST /v1/payments/{id}/refunds` → 401 `unauthorized` con una credencial
 * válida que no era la del vendedor de ese pago). Antes cualquier 401 borraba
 * los tokens.
 * Ahora se le pregunta al proveedor por la credencial misma —`/users/me`, la
 * misma comprobación que usa «verificar conexión»— y sólo si ESA respuesta es
 * 401 se pide reautorizar. Si no responde, o responde otra cosa, no se toca
 * nada. Devuelve si la conexión quedó invalidada.
 */
export async function invalidateTokenIfProviderRejectsIt(
  businessId: string,
  rejectedToken: string,
): Promise<boolean> {
  let status = 0;
  try {
    const response = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${rejectedToken}` },
      signal: AbortSignal.timeout(10000),
    });
    status = response.status;
    await response.body?.cancel();
  } catch (_) {
    return false;
  }
  if (status !== 401) return false;
  await invalidateRejectedToken(businessId, rejectedToken);
  return true;
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
