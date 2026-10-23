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
import { isFinalProviderRejection, logProviderRejection, mercadoPagoRequest } from '../_shared/mercadopago.ts';
import { providerResourceId } from '../_shared/refund-correlation.ts';

const CANCELLATION_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION';

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    if (body.confirmation !== CANCELLATION_CONFIRMATION) {
      return jsonResponse(request, {
        ok: false,
        code: 'EXPLICIT_CANCELLATION_CONFIRMATION_REQUIRED',
        message: 'Confirmá explícitamente la cancelación antes de enviarla a Mercado Pago.',
      }, 409);
    }
    const paymentIntentId = requireUuid(body.payment_intent_id, 'payment_intent_id');
    const idempotencyKey = requireUuid(body.idempotency_key, 'idempotency_key');
    const { user, client } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'cancellation', 6, 600, user.id);
    const { data: prepared, error: prepareError } = await client.rpc('prepare_payment_cancellation', {
      p_payment_intent_id: paymentIntentId,
      p_idempotency_key: idempotencyKey,
    });
    if (prepareError || !prepared) return unavailable(request);
    if (prepared.reconciliation_required === true) return reconciling(request);
    const businessId = await businessForIntent(paymentIntentId);
    const providerIdempotencyKey = requireUuid(prepared.idempotency_key, 'prepared.idempotency_key');
    if (prepared.idempotent === true) {
      const existing = await service.from('payment_cancellations')
        .select('payment_intent_id,idempotency_key,status').eq('id', prepared.cancellation_id).maybeSingle();
      if (existing.error || !existing.data || existing.data.payment_intent_id !== paymentIntentId ||
        existing.data.idempotency_key !== providerIdempotencyKey) return unavailable(request);
      if (existing.data.status === 'cancelled' || existing.data.status === 'rejected') {
        return cancellationResponse(request, existing.data.status);
      }
      // The first invocation owns the provider mutation. A concurrent caller
      // observes it without resending the PUT or changing its financial state.
      return reconciling(request);
    }

    try {
      const result = await mercadoPagoRequest(
        `/v1/payments/${encodeURIComponent(String(prepared.provider_payment_id))}`,
        {
          method: 'PUT',
          body: JSON.stringify({ status: 'cancelled' }),
          idempotencyKey: providerIdempotencyKey,
          businessId,
        },
      );
      const responseHash = await sha256Hex(result.rawText);
      // A successful response can settle only the exact payment prepared by
      // the database. Missing or mismatched identities require reconciliation.
      if (result.response.ok && providerResourceId(result.body?.id) !== String(prepared.provider_payment_id)) {
        await markAmbiguous(service, prepared.cancellation_id, responseHash, 'cancellation_payment_identity_mismatch');
        return reconciling(request);
      }
      const providerStatus = String(result.body?.status || '').toLowerCase();
      const resolvedStatus = providerStatus === 'rejected'
        ? 'rejected'
        : ['cancelled', 'canceled'].includes(providerStatus) ? 'cancelled' : 'ambiguous';
      if (!result.response.ok || resolvedStatus === 'ambiguous') {
        if (!result.response.ok) logProviderRejection('cancellation', businessId, paymentIntentId, result);
        if (isFinalProviderRejection(result.response.status)) {
          await service.rpc('record_payment_cancellation_response', {
            p_cancellation_id: prepared.cancellation_id,
            p_status: 'rejected',
            p_response_hash: responseHash,
          });
          return jsonResponse(request, {
            ok: false,
            code: 'CANCELLATION_REJECTED',
            message: 'Mercado Pago no pudo aceptar la cancelación solicitada.',
          }, 409);
        }
        await markAmbiguous(service, prepared.cancellation_id, responseHash, `http_${result.response.status || 'network'}`);
        return reconciling(request);
      }
      const { error: recordError } = await service.rpc('record_payment_cancellation_response', {
        p_cancellation_id: prepared.cancellation_id,
        p_status: resolvedStatus,
        p_response_hash: responseHash,
      });
      if (recordError) return unavailable(request);
      return cancellationResponse(request, resolvedStatus);
    } catch (_) {
      const requestHash = await sha256Hex(JSON.stringify({ paymentIntentId, idempotencyKey: providerIdempotencyKey }));
      await markAmbiguous(service, prepared.cancellation_id, requestHash, 'network_or_timeout');
      return reconciling(request);
    }
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

function cancellationResponse(request: Request, status: string): Response {
  return jsonResponse(request, {
    ok: status === 'cancelled', status,
    message: status === 'cancelled'
      ? 'La cancelación fue registrada en Mercado Pago.'
      : 'Mercado Pago rechazó la cancelación solicitada.',
  }, status === 'cancelled' ? 200 : 409);
}

async function markAmbiguous(service: ReturnType<typeof createServiceClient>, cancellationId: string, hash: string, code: string): Promise<void> {
  await service.rpc('mark_payment_cancellation_ambiguous', {
    p_cancellation_id: cancellationId,
    p_request_hash: hash,
    p_error_code: code,
  });
}

function reconciling(request: Request): Response {
  return jsonResponse(request, {
    ok: false,
    code: 'CANCELLATION_RECONCILING',
    message: 'El resultado de la cancelación está siendo verificado antes de cualquier nuevo intento.',
  }, 202);
}

function unavailable(request: Request): Response {
  return jsonResponse(request, {
    ok: false,
    code: 'CANCELLATION_NOT_AVAILABLE',
    message: 'No se pudo preparar la cancelación para este pago.',
  }, 409);
}
