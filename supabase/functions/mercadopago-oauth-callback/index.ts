import {
  createServiceClient,
  requireAuthenticatedUser,
} from "../_shared/payment-runtime.ts";
import { digest, parseCallback } from "../_shared/seller-oauth-crypto.ts";
import {
  audit,
  oauthConfig,
  protect,
  reveal,
  sellerIdentity,
  tokenGrant,
} from "../_shared/seller-oauth.ts";

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
  const redirect = (result: string) => {
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
  try {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const input = parseCallback(new URL(request.url));
    const service = createServiceClient();
    const consumed = await service.rpc("mp_consume_oauth", {
      p_state_hash: await digest(input.state),
      p_environment: config.environment,
    });
    const state = consumed.data?.[0];
    if (consumed.error || !state) throw new Error("Invalid OAuth state");
    businessId = state.business_id;
    if (input.denied) return redirect("cancelled");
    const protectedState = await reveal(
      state.protected_verifier,
      businessId,
      "state",
    );
    // Recheck the original TABA session and current role before accepting consent.
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
    const tokens = await tokenGrant({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: config.callback,
      code_verifier: protectedState.verifier,
    });
    await sellerIdentity(String(tokens.access_token), String(tokens.user_id));
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
    if (saved.error || saved.data !== true) {
      throw new Error("Unable to save authorization");
    }
    audit("oauth_callback_success", businessId, correlationId);
    audit("seller_connected", businessId, correlationId);
    return redirect("connected");
  } catch (_) {
    audit("oauth_callback_failed", businessId, correlationId);
    return redirect("error");
  }
});
