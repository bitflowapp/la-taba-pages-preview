import {
  assertAllowedOrigin,
  createServiceClient,
  enforceRateLimit,
  handleOptions,
  jsonResponse,
  publicErrorResponse,
  readJsonObject,
  requireAuthenticatedUser,
  requirePost,
  requireUuid,
} from "../_shared/payment-runtime.ts";
import {
  authorizationUrl,
  digest,
  randomSecret,
} from "../_shared/seller-oauth-crypto.ts";
import {
  audit,
  assertOAuthBusiness,
  connection,
  invalidateRejectedToken,
  oauthConfig,
  OAuthProviderError,
  protect,
  sellerAccessToken,
  sellerIdentity,
} from "../_shared/seller-oauth.ts";

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const { user, client } = await requireAuthenticatedUser(request);
    const body = await readJsonObject(request);
    const businessId = requireUuid(body.business_id, "business_id");
    assertOAuthBusiness(businessId);
    const permission = await client.rpc("mp_connection_authorized", {
      p_business_id: businessId,
    });
    if (permission.error || permission.data !== true) {
      return jsonResponse(request, {
        ok: false,
        code: "BUSINESS_FORBIDDEN",
        message: "La conexión la hace el dueño o el encargado.",
      }, 403);
    }
    const service = createServiceClient();
    await enforceRateLimit(
      service,
      request,
      "preference",
      12,
      600,
      `oauth:${user.id}`,
    );
    const config = oauthConfig();
    const action = String(body.action || "status");
    if (action === "connect") {
      const state = randomSecret(), verifier = randomSecret();
      const started = await service.rpc("mp_begin_oauth", {
        p_business_id: businessId,
        p_user_id: user.id,
        p_environment: config.environment,
        p_state_hash: await digest(state),
        p_protected_verifier: await protect(
          { verifier, authorization: request.headers.get("authorization") },
          businessId,
          "state",
        ),
      });
      if (started.error) throw new Error("Unable to begin connection");
      audit("oauth_started", businessId, crypto.randomUUID());
      return jsonResponse(request, {
        ok: true,
        authorization_url: authorizationUrl(
          config.clientId,
          config.callback,
          state,
          await digest(verifier),
        ),
      });
    }
    if (action === "disconnect") {
      if (body.confirmation !== "DISCONNECT_MERCADOPAGO") {
        return jsonResponse(request, {
          ok: false,
          code: "CONFIRMATION_REQUIRED",
        }, 409);
      }
      const disconnected = await service.rpc("mp_disconnect", {
        p_business_id: businessId,
        p_environment: config.environment,
      });
      if (disconnected.error) throw new Error("Unable to disconnect");
      audit("seller_disconnected", businessId, crypto.randomUUID());
    } else if (action === "verify") {
      const token = await sellerAccessToken(businessId);
      const row = await connection(businessId);
      try {
        await sellerIdentity(token, String(row.seller_id));
      } catch (error) {
        // Verification does not claim a disconnected seller is connected.
        // A provider/network error itself is not proof of revocation.
        if (error instanceof OAuthProviderError && error.status === 401) {
          await invalidateRejectedToken(businessId, token);
        }
        throw new Error("Unable to verify seller");
      }
    } else if (action !== "status") {
      return jsonResponse(request, { ok: false, code: "INVALID_ACTION" }, 400);
    }
    const row = await connection(businessId);
    return jsonResponse(request, {
      ok: true,
      connection: {
        status: row?.status || "disconnected",
        seller_id: row?.seller_id || null,
        connected_at: row?.connected_at || null,
      },
    });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
