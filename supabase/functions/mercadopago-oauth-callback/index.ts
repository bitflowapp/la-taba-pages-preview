import {
  createServiceClient,
  requireAuthenticatedUser,
} from "../_shared/payment-runtime.ts";
import { digest, parseCallback } from "../_shared/seller-oauth-crypto.ts";
import {
  assertIntegratorEnvironment,
  audit,
  oauthConfig,
  protect,
  reveal,
  sellerIdentity,
  tokenGrant,
} from "../_shared/seller-oauth.ts";

// The result tells the panel WHICH message to show; the connection state shown
// to the owner is always read again from the server.
type CallbackResult = "connected" | "cancelled" | "expired" | "session" | "account" | "seller_changed" | "error";

Deno.serve(async (request) => {
  let businessId = "unknown";
  const correlationId = crypto.randomUUID();
  let config;
  try {
    config = oauthConfig();
  } catch (_) {
    return new Response("La conexión no está disponible.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const redirect = (result: CallbackResult) => {
    const url = new URL(config.panel);
    url.searchParams.set("mp_connection", result);
    url.hash = "business";
    return new Response(null, {
      status: 303,
      headers: {
        location: url.toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  };
  let failure: CallbackResult = "error";
  try {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const input = parseCallback(new URL(request.url));
    const service = createServiceClient();
    failure = "expired";
    const consumed = await service.rpc("mp_consume_oauth", {
      p_state_hash: await digest(input.state),
      p_environment: config.environment,
    });
    const state = consumed.data?.[0];
    if (consumed.error || !state) throw new Error("Invalid OAuth state");
    businessId = state.business_id;
    if (input.denied) return redirect("cancelled");
    failure = "error";
    const protectedState = await reveal(
      state.protected_verifier,
      businessId,
      "state",
    );
    // Recheck the original TABA session and current role before accepting consent.
    failure = "session";
    const authRequest = new Request(config.callback, {
      headers: { authorization: String(protectedState.authorization) },
    });
    const { user, client } = await requireAuthenticatedUser(authRequest);
    const permission = await client.rpc("mp_connection_authorized", {
      p_business_id: businessId,
    });
    if (
      user.id !== state.user_id || permission.error || permission.data !== true
    ) throw new Error("Authorization revoked");
    // An integrator of the other environment makes every payment of this link fail at the provider: never link.
    failure = "error";
    await assertIntegratorEnvironment();
    failure = "account";
    const tokens = await tokenGrant({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: config.callback,
      code_verifier: protectedState.verifier,
    });
    const identity = await sellerIdentity(String(tokens.access_token), String(tokens.user_id));
    failure = "error";
    const saved = await service.rpc("mp_finish_oauth", {
      p_business_id: businessId,
      p_environment: config.environment,
      p_generation: state.generation,
      p_seller_id: String(tokens.user_id),
      p_application_id: config.clientId,
      p_scopes: String(tokens.scope),
      p_protected_tokens: await protect(tokens, businessId),
      p_expires_at: new Date(Date.now() + Number(tokens.expires_in) * 1000)
        .toISOString(),
    });
    if (saved.error && String(saved.error.message || "").includes("seller_change_requires_migration")) {
      failure = "seller_changed";
    }
    if (saved.error || saved.data !== true) {
      throw new Error("Unable to save authorization");
    }
    // A readable name of the linked account, so the owner can tell whether the
    // personal or the business account was authorized. Best effort: the link
    // is already saved and valid without it.
    await service.from("mp_seller_connections")
      .update({ account_label: identity.label, deauthorized_at: null })
      .eq("business_id", businessId).eq("environment", config.environment)
      .eq("generation", state.generation);
    audit("oauth_callback_success", businessId, correlationId);
    audit("seller_connected", businessId, correlationId);
    return redirect("connected");
  } catch (_) {
    audit("oauth_callback_failed", businessId, correlationId);
    return redirect(failure);
  }
});
