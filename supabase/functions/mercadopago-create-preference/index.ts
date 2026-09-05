import { businessForIntent } from '../_shared/seller-oauth.ts';
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
  sha256Hex,
} from '../_shared/payment-runtime.ts';
import {
  createPreference,
  findPreferenceByExternalReference,
  MercadoPagoApiError,
  type PreferencePreparation,
} from '../_shared/mercadopago.ts';

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    const checkoutSessionId = requireUuid(body.checkout_session_id, 'checkout_session_id');
    const newAttempt = body.new_attempt === true;
    const { user } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'preference', 12, 600, user.id);

    const { data, error } = await service.rpc('prepare_mercadopago_preference', {
      p_checkout_session_id: checkoutSessionId,
      p_customer_id: user.id,
      p_new_attempt: newAttempt,
    });
    if (error || !data) return checkoutUnavailable(request);
    const preparation = data as PreferencePreparation;
    const businessId = await businessForIntent(preparation.payment_intent_id);
    const storedPoint = selectedInitPoint(preparation);
    if (preparation.attempt_status === 'created' && storedPoint) {
      return preferenceResponse(request, preparation, storedPoint);
    }

    // A network timeout is never retried blindly. The official preference
    // search endpoint is queried by stable external_reference before another
    // POST is attempted, and a recovered preference is persisted under the
    // original idempotency key.
    const existing = await findPreferenceByExternalReference(preparation.external_reference, businessId);
    if (existing) {
      const preferenceId = String(existing.id || '').trim();
      const initPoint = String(existing.init_point || '').trim();
      const sandboxInitPoint = String(existing.sandbox_init_point || '').trim();
      if (preferenceId && initPoint) {
        const { error: persistError } = await service.rpc('record_mercadopago_preference_created', {
          p_payment_attempt_id: preparation.payment_attempt_id,
          p_preference_id: preferenceId,
          p_init_point: initPoint,
          p_sandbox_init_point: sandboxInitPoint || null,
          p_response_hash: await sha256Hex(JSON.stringify(existing)),
          p_provider_request_id: null,
        });
        if (persistError) return checkoutUnavailable(request);
        return preferenceResponse(request, preparation, selectedInitPoint({
          ...preparation,
          init_point: initPoint,
          sandbox_init_point: sandboxInitPoint,
        }));
      }
    }

    if (preparation.attempt_status === 'ambiguous' || preparation.attempt_status === 'request_sent') {
      return jsonResponse(request, {
        ok: false,
        code: 'PREFERENCE_RECONCILING',
        status: 'reconciling',
        message: 'Estamos verificando la preparación de tu pago. No vuelvas a pagar todavía.',
      }, 202);
    }

    try {
      const created = await createPreference(preparation, businessId);
      const { error: persistError } = await service.rpc('record_mercadopago_preference_created', {
        p_payment_attempt_id: preparation.payment_attempt_id,
        p_preference_id: created.preferenceId,
        p_init_point: created.initPoint,
        p_sandbox_init_point: created.sandboxInitPoint || null,
        p_response_hash: created.responseHash,
        p_provider_request_id: created.requestId || null,
      });
      if (persistError) return checkoutUnavailable(request);
      return preferenceResponse(request, preparation, selectedInitPoint({
        ...preparation,
        init_point: created.initPoint,
        sandbox_init_point: created.sandboxInitPoint,
      }));
    } catch (error) {
      const requestHash = await sha256Hex(JSON.stringify({
        checkoutSessionId,
        paymentAttemptId: preparation.payment_attempt_id,
        externalReference: preparation.external_reference,
      }));
      if (error instanceof MercadoPagoApiError && error.status >= 400 && error.status < 500) {
        await service.rpc('record_mercadopago_preference_failed', {
          p_payment_attempt_id: preparation.payment_attempt_id,
          p_response_hash: error.responseHash,
          p_error_code: String(error.status),
        });
        return jsonResponse(request, {
          ok: false,
          code: 'PAYMENT_SETUP_REJECTED',
          message: 'No pudimos preparar Mercado Pago. Conservamos tu carrito para que vuelvas a intentar.',
        }, 409);
      }
      await service.rpc('record_mercadopago_preference_uncertain', {
        p_payment_attempt_id: preparation.payment_attempt_id,
        p_request_hash: requestHash,
        p_error_code: error instanceof MercadoPagoApiError ? String(error.status) : 'network_or_timeout',
      });
      return jsonResponse(request, {
        ok: false,
        code: 'PREFERENCE_RECONCILING',
        status: 'reconciling',
        message: 'Estamos verificando la preparación de tu pago. No vuelvas a pagar todavía.',
      }, 202);
    }
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

function selectedInitPoint(preparation: PreferencePreparation): string {
  // `sandbox_init_point` is Mercado Pago's deprecated sandbox host. Measured on
  // 2026-08-06 from an iPhone-shaped WebKit context: it renders the checkout for
  // the same preference but rejects every attempt with "No pudimos procesar tu
  // pago", while `init_point` completes it against the same sandbox collector
  // and the same test card. The test environment is already determined by the
  // credentials, not by the host, so `init_point` is the one to send.
  return String(preparation.init_point || '').trim();
}

function preferenceResponse(request: Request, preparation: PreferencePreparation, initPoint: string): Response {
  if (!initPoint) return checkoutUnavailable(request);
  return jsonResponse(request, {
    ok: true,
    init_point: initPoint,
    checkout_session_id: preparation.checkout_session_id,
    expires_at: preparation.expires_at,
    status: 'redirect_ready',
  });
}

function checkoutUnavailable(request: Request): Response {
  return jsonResponse(request, {
    ok: false,
    code: 'CHECKOUT_NOT_AVAILABLE',
    message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.',
  }, 409);
}
