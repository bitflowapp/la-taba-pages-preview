import { assertCurrentSellerPaymentAuthority, beginSellerPaymentAuthority, businessForIntent, type PaymentAuthoritySnapshot } from '../_shared/seller-oauth.ts';
import {
  assertAllowedOrigin,
  createServiceClient,
  enforceRateLimit,
  handleOptions,
  jsonResponse,
  publicErrorResponse,
  PublicPaymentError,
  readJsonObject,
  requireAuthenticatedUser,
  requirePost,
  requireUuid,
  sha256Hex,
} from '../_shared/payment-runtime.ts';
import {
  createPreference,
  findPreferenceByExternalReference,
  verifyStoredPreference,
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

    const { data, error } = await service.rpc('prepare_mercadopago_preference_v2', {
      p_checkout_session_id: checkoutSessionId,
      p_customer_id: user.id,
      p_new_attempt: newAttempt,
    });
    if (error || !data) return checkoutUnavailable(request);
    const preparation = data as PreferencePreparation;
    const businessId = await businessForIntent(preparation.payment_intent_id);
    const authority = await beginSellerPaymentAuthority(businessId, authorityContext(preparation, user.id));
    const storedPoint = selectedInitPoint(preparation);
    if (preparation.attempt_status === 'created' && storedPoint) {
      let snapshot = authority.snapshot;
      if (!snapshot.attempt.seller_generation || !snapshot.intent.current_payment_attempt_id) {
        const verified = await verifyStoredPreference(preparation, businessId, authority.accessToken, snapshot.seller!.seller_id);
        if (!verified) return checkoutUnavailable(request);
        const { data: persisted, error: persistError } = await service.rpc('record_mercadopago_preference_created_v2', {
          ...persistenceContext(preparation, businessId, user.id, snapshot),
          p_payment_attempt_id: preparation.payment_attempt_id, p_preference_id: preparation.preference_id,
          p_init_point: storedPoint, p_sandbox_init_point: preparation.sandbox_init_point,
          p_response_hash: await sha256Hex(JSON.stringify(verified)), p_provider_request_id: null,
        });
        if (persistError || !persisted) return checkoutUnavailable(request);
        snapshot = persisted;
      }
      return await authorizedPreferenceResponse(request, preparation, storedPoint, businessId, user.id, snapshot);
    }

    // A network timeout is never retried blindly. The official preference
    // search endpoint is queried by stable external_reference before another
    // POST is attempted, and a recovered preference is persisted under the
    // original idempotency key.
    const existing = await findPreferenceByExternalReference(preparation.external_reference, businessId, authority.accessToken, preparation.payment_attempt_id, authority.snapshot.seller!.seller_id);
    if (existing) {
      const preferenceId = String(existing.id || '').trim();
      const initPoint = String(existing.init_point || '').trim();
      const sandboxInitPoint = String(existing.sandbox_init_point || '').trim();
      if (preferenceId && initPoint) {
        const { data: persisted, error: persistError } = await service.rpc('record_mercadopago_preference_created_v2', {
          ...persistenceContext(preparation, businessId, user.id, authority.snapshot),
          p_payment_attempt_id: preparation.payment_attempt_id,
          p_preference_id: preferenceId,
          p_init_point: initPoint,
          p_sandbox_init_point: sandboxInitPoint || null,
          p_response_hash: await sha256Hex(JSON.stringify(existing)),
          p_provider_request_id: null,
        });
        if (persistError || !persisted) return checkoutUnavailable(request);
        const ready = {
          ...preparation,
          preference_id: preferenceId,
          init_point: initPoint,
          sandbox_init_point: sandboxInitPoint,
        };
        return await authorizedPreferenceResponse(request, ready, selectedInitPoint(ready), businessId, user.id, persisted);
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
      const created = await createPreference(preparation, businessId, authority.accessToken);
      const { data: persisted, error: persistError } = await service.rpc('record_mercadopago_preference_created_v2', {
        ...persistenceContext(preparation, businessId, user.id, authority.snapshot),
        p_payment_attempt_id: preparation.payment_attempt_id,
        p_preference_id: created.preferenceId,
        p_init_point: created.initPoint,
        p_sandbox_init_point: created.sandboxInitPoint || null,
        p_response_hash: created.responseHash,
        p_provider_request_id: created.requestId || null,
      });
      if (persistError || !persisted) return checkoutUnavailable(request);
      const ready = {
        ...preparation,
        preference_id: created.preferenceId,
        init_point: created.initPoint,
        sandbox_init_point: created.sandboxInitPoint,
      };
      return await authorizedPreferenceResponse(request, ready, selectedInitPoint(ready), businessId, user.id, persisted);
    } catch (error) {
      // A final authority rejection is not an uncertain provider POST.
      if (error instanceof PublicPaymentError) throw error;
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
  return String(preparation.init_point || '');
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

async function authorizedPreferenceResponse(
  request: Request,
  preparation: PreferencePreparation,
  initPoint: string,
  businessId: string,
  customerId: string,
  snapshot: PaymentAuthoritySnapshot,
): Promise<Response> {
  if (!initPoint) return checkoutUnavailable(request);
  await assertCurrentSellerPaymentAuthority(businessId, authorityContext(preparation, customerId), snapshot);
  return preferenceResponse(request, preparation, initPoint);
}

function authorityContext(preparation: PreferencePreparation, customerId: string) {
  return {
    checkoutSessionId: preparation.checkout_session_id, paymentIntentId: preparation.payment_intent_id, customerId,
    paymentAttemptId: preparation.payment_attempt_id, attemptNumber: preparation.attempt_number,
    idempotencyKey: preparation.idempotency_key, preferenceId: preparation.preference_id, initPoint: preparation.init_point,
  };
}

function persistenceContext(preparation: PreferencePreparation, businessId: string, customerId: string, snapshot: PaymentAuthoritySnapshot) {
  return { p_business_id: businessId, p_environment: preparation.environment,
    p_checkout_session_id: preparation.checkout_session_id, p_customer_id: customerId,
    p_expected_authority: snapshot.authority_version };
}

function checkoutUnavailable(request: Request): Response {
  return jsonResponse(request, {
    ok: false,
    code: 'CHECKOUT_NOT_AVAILABLE',
    message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.',
  }, 409);
}
