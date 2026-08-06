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
} from '../_shared/payment-runtime.ts';
import { findPaymentByExternalReference, paymentSnapshot } from '../_shared/mercadopago.ts';

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    const checkoutSessionId = requireUuid(body.checkout_session_id, 'checkout_session_id');
    const { user, client } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'checkout_status', 60, 60, user.id);
    const { data, error } = await client.rpc('get_checkout_session_for_customer', {
      p_checkout_session_id: checkoutSessionId,
    });
    if (error || !data) {
      return jsonResponse(request, {
        ok: false,
        code: 'CHECKOUT_NOT_FOUND',
        message: 'No encontramos ese checkout en tu sesión.',
      }, 404);
    }

    // Reaching this point proves the caller owns the session, because the RPC
    // above runs under the customer's own credentials.
    const reconciled = await reconcile(service, checkoutSessionId);
    if (!reconciled) return jsonResponse(request, { ok: true, checkout: data });

    const refreshed = await client.rpc('get_checkout_session_for_customer', {
      p_checkout_session_id: checkoutSessionId,
    });
    return jsonResponse(request, {
      ok: true,
      checkout: refreshed.data || data,
      reconciled: true,
    });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

/**
 * Pulls the payment back from Mercado Pago and runs it through the same
 * verification the webhook worker uses. Returns true when the session moved.
 *
 * This exists because Mercado Pago does not deliver a *validatable* Checkout Pro
 * notification for test credentials: the notification it does send is signed by
 * the auto-provisioned test application, whose key the panel keeps masked. The
 * provider read-back is the authoritative path — the caller supplies nothing but
 * a session id, and every commercial assertion still happens inside
 * `record_mercadopago_payment_snapshot`.
 */
async function reconcile(
  service: ReturnType<typeof createServiceClient>,
  checkoutSessionId: string,
): Promise<boolean> {
  const { data: intents } = await service
    .from('payment_intents')
    .select('id, external_reference, internal_status')
    .eq('checkout_session_id', checkoutSessionId)
    .limit(1);
  const intent = Array.isArray(intents) ? intents[0] : null;
  if (!intent?.external_reference) return false;
  // Nothing to do once the intent reached a settled state.
  if (['completed', 'refunded', 'charged_back', 'security_review_required'].includes(String(intent.internal_status))) {
    return false;
  }

  let payment: Record<string, unknown> | null = null;
  try {
    payment = await findPaymentByExternalReference(String(intent.external_reference));
  } catch (_) {
    // A provider outage must never break the status screen: the shopper keeps
    // seeing the last known state and the next poll retries.
    return false;
  }
  if (!payment) return false;

  const { data: recorded, error: recordError } = await service.rpc('record_mercadopago_payment_snapshot', {
    p_payment_intent_id: intent.id,
    p_snapshot: await paymentSnapshot(payment),
    p_source: 'reconciliation',
    p_webhook_receipt_id: null,
  });
  if (recordError || !recorded) return false;

  if ((recorded as Record<string, unknown>).finalize_required === true) {
    // `finalize_paid_checkout_session` is idempotent: a session that already has
    // a completed order returns it instead of creating a second one.
    const finalized = await service.rpc('finalize_paid_checkout_session', {
      p_checkout_session_id: checkoutSessionId,
    });
    if (finalized.error) return false;
  }
  return true;
}
