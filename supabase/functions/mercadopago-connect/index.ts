import {
  assertAllowedOrigin,
  createServiceClient,
  enforceRateLimit,
  handleOptions,
  jsonResponse,
  PublicPaymentError,
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
  assertIntegratorForConnection,
  assertOAuthBusiness,
  connection,
  oauthConfig,
  protect,
} from "../_shared/seller-oauth.ts";
import { verifySellerConnection } from '../_shared/seller-connection-verification.ts';
import {
  blockingPendingCount,
  sessionExpiresAtMs,
  SESSION_MIN_REMAINING_MS,
  verificationFailure,
} from '../_shared/seller-connection-panel.ts';

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
    let verification;
    if (action === "connect") {
      // The callback re-validates THIS session after the person consents in
      // Mercado Pago. A token about to expire turned a correct consent into a
      // generic error; the panel refreshes its session and asks again.
      const expiresAt = sessionExpiresAtMs(request.headers.get("authorization"));
      if (!expiresAt || expiresAt - Date.now() < SESSION_MIN_REMAINING_MS) {
        return jsonResponse(request, {
          ok: false,
          code: "SESSION_REFRESH_REQUIRED",
          message: "Renovamos tu sesión antes de continuar.",
        }, 409);
      }
      // An integrator application of the other environment would make every payment of this link fail: say so before
      // the seller consents at Mercado Pago, not after.
      await assertIntegratorForConnection();
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
      if (started.error) {
        if (String(started.error.message || "").includes("connection_busy")) {
          throw new PublicPaymentError(409, "SELLER_REFRESHING", "Mercado Pago está renovando la autorización. Probá de nuevo en un minuto.");
        }
        throw new Error("Unable to begin connection");
      }
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
    if (action === "disconnect_preview") {
      // Read-only: what would stay without a way to reach Mercado Pago.
      const preview = await service.rpc("mp_disconnect_preflight", {
        p_business_id: businessId,
        p_environment: config.environment,
      });
      if (preview.error || !preview.data) throw new Error("Unable to review disconnection");
      return jsonResponse(request, {
        ok: true,
        pending: preview.data,
        blocking: blockingPendingCount(preview.data),
        connection: await publicConnection(businessId),
      });
    }
    if (action === "disconnect") {
      if (body.confirmation !== "DISCONNECT_MERCADOPAGO") {
        return jsonResponse(request, {
          ok: false,
          code: "CONFIRMATION_REQUIRED",
        }, 409);
      }
      // First call: pause new online payments and commit it, then look at what
      // is still open. A checkout that was starting at this very moment is
      // counted by the second call, which disconnects only with nothing pending.
      const paused = await service.rpc("mp_disconnect_checked", {
        p_business_id: businessId,
        p_environment: config.environment,
        p_execute: false,
      });
      if (paused.error || !paused.data) throw new Error("Unable to pause payments");
      if (paused.data.code === "pending_operations") return pendingOperations(request, paused.data);
      const disconnected = await service.rpc("mp_disconnect_checked", {
        p_business_id: businessId,
        p_environment: config.environment,
        p_execute: true,
      });
      if (disconnected.error || !disconnected.data) throw new Error("Unable to disconnect");
      if (disconnected.data.ok !== true) return pendingOperations(request, disconnected.data);
      audit("seller_disconnected", businessId, crypto.randomUUID());
    } else if (action === "verify") {
      // A failed verification is an answer for the owner, not a server error:
      // the panel shows the real state (for example «Requiere reconexión»).
      try {
        verification = await verifySellerConnection(businessId);
      } catch (error) {
        verification = verificationFailure(error, (await connection(businessId))?.status);
      }
    } else if (action !== "status") {
      return jsonResponse(request, { ok: false, code: "INVALID_ACTION" }, 400);
    }
    return jsonResponse(request, {
      ok: true,
      ...(verification ? { verification } : {}),
      connection: {
        ...(await publicConnection(businessId)),
        ...(verification ? { verification } : {}),
      },
    });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

// What the panel may know about the link. Never tokens, generations or leases.
async function publicConnection(businessId: string) {
  const row = await connection(businessId);
  return {
    status: row?.status || "disconnected",
    seller_id: row?.seller_id || null,
    connected_at: row?.connected_at || null,
    environment: oauthConfig().environment,
    account_label: row?.status === "connected" ? row?.account_label || null : null,
    deauthorized_at: row?.deauthorized_at || null,
  };
}

function pendingOperations(request: Request, result: Record<string, unknown>) {
  return jsonResponse(request, {
    ok: false,
    code: "DISCONNECT_PENDING_OPERATIONS",
    paused: result.paused === true,
    pending: result.pending || {},
    blocking: blockingPendingCount(result.pending),
    message: "Hay cobros o devoluciones sin cerrar. Pausamos los cobros online nuevos; cuando se cierren vas a poder desvincular.",
  }, 409);
}
