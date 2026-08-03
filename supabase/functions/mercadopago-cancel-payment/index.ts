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
import { mercadoPagoRequest } from '../_shared/mercadopago.ts';

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
    const providerIdempotencyKey = requireUuid(prepared.idempotency_key, 'prepared.idempotency_key');

    try {
      const result = await mercadoPagoRequest(
        `/v1/payments/${encodeURIComponent(String(prepared.provider_payment_id))}`,
        {
          method: 'PUT',
          body: JSON.stringify({ status: 'cancelled' }),
          idempotencyKey: providerIdempotencyKey,
        },
      );
      const responseHash = await sha256Hex(result.rawText);
      const providerStatus = String(result.body?.status || '').toLowerCase();
      const resolvedStatus = providerStatus === 'rejected'
        ? 'rejected'
        : ['cancelled', 'canceled'].includes(providerStatus) ? 'cancelled' : 'ambiguous';
      if (!result.response.ok || resolvedStatus === 'ambiguous') {
        if (result.response.status >= 400 && result.response.status < 500) {
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
      return jsonResponse(request, {
        ok: resolvedStatus === 'cancelled',
        status: resolvedStatus,
        message: resolvedStatus === 'cancelled'
          ? 'La cancelación fue registrada en Mercado Pago.'
          : 'Mercado Pago rechazó la cancelación solicitada.',
      }, resolvedStatus === 'cancelled' ? 200 : 409);
    } catch (_) {
      const requestHash = await sha256Hex(JSON.stringify({ paymentIntentId, idempotencyKey: providerIdempotencyKey }));
      await markAmbiguous(service, prepared.cancellation_id, requestHash, 'network_or_timeout');
      return reconciling(request);
    }
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

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
