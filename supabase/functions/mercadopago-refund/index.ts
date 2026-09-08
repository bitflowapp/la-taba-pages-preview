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
import { mercadoPagoRequest } from '../_shared/mercadopago.ts';
import { correlateProviderRefund, providerResourceId } from '../_shared/refund-correlation.ts';

const REFUND_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND';

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    if (body.confirmation !== REFUND_CONFIRMATION) {
      return jsonResponse(request, {
        ok: false,
        code: 'EXPLICIT_REFUND_CONFIRMATION_REQUIRED',
        message: 'Confirmá explícitamente el reembolso antes de enviarlo a Mercado Pago.',
      }, 409);
    }
    const paymentIntentId = requireUuid(body.payment_intent_id, 'payment_intent_id');
    const idempotencyKey = requireUuid(body.idempotency_key, 'idempotency_key');
    const amount = body.amount === undefined || body.amount === null || body.amount === ''
      ? null
      : normalizedAmount(body.amount);
    const reason = String(body.reason || '').trim().slice(0, 300);
    const { user, client } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'refund', 6, 600, user.id);

    const { data: prepared, error: prepareError } = await client.rpc('prepare_payment_refund', {
      p_payment_intent_id: paymentIntentId,
      p_amount: amount,
      p_idempotency_key: idempotencyKey,
      p_reason: reason || null,
    });
    if (prepareError || !prepared) return unavailable(request);
    if (prepared.reconciliation_required === true) return reconciling(request);
    const businessId = await businessForIntent(paymentIntentId);
    const providerIdempotencyKey = requireUuid(prepared.idempotency_key, 'prepared.idempotency_key');
    const { data: refundRow, error: refundReadError } = await service.from('payment_refunds')
      .select('payment_intent_id,idempotency_key,provider_refund_id,status,requested_at')
      .eq('id', prepared.refund_id).maybeSingle();
    if (refundReadError || !refundRow || refundRow.payment_intent_id !== paymentIntentId ||
      refundRow.idempotency_key !== providerIdempotencyKey) return unavailable(request);
    if (refundRow.status === 'approved' || refundRow.status === 'rejected') {
      return refundResponse(request, refundRow.status);
    }
    if (refundRow.provider_refund_id || prepared.idempotent === true) {
      // An existing/uncertain request is reconciled by its stored identity. A
      // lost response never authorizes a new POST or a guessed provider ID.
      await markAmbiguous(service, prepared.refund_id,
        await sha256Hex(JSON.stringify({ paymentIntentId, idempotencyKey: providerIdempotencyKey })),
        'existing_refund_requires_reconciliation');
      return reconciling(request);
    }

    // Total vs. parcial lo decide la BASE (prepared.full_refund), no el dato
    // que mandó el navegador: con un reembolso parcial previo, "importe vacío"
    // del cliente y "total" del proveedor pueden no ser el mismo número, y lo
    // que se asienta después es prepared.amount.
    const fullRefund = prepared.full_refund === true
      || (prepared.full_refund === undefined && amount === null);
    try {
      const result = await mercadoPagoRequest(
        `/v1/payments/${encodeURIComponent(String(prepared.provider_payment_id))}/refunds`,
        {
          method: 'POST',
          body: fullRefund ? undefined : JSON.stringify({ amount: Number(prepared.amount) }),
          idempotencyKey: providerIdempotencyKey,
          businessId,
        },
      );
      const responseHash = await sha256Hex(result.rawText);
      if (!result.response.ok || !result.body) {
        if (result.response.status >= 400 && result.response.status < 500) {
          await service.rpc('record_payment_refund_response', {
            p_refund_id: prepared.refund_id,
            p_provider_refund_id: '',
            p_status: 'rejected',
            p_amount: Number(prepared.amount),
            p_response_hash: responseHash,
          });
          return jsonResponse(request, {
            ok: false,
            code: 'REFUND_REJECTED',
            message: 'Mercado Pago no pudo aceptar el reembolso solicitado.',
          }, 409);
        }
        await markAmbiguous(service, prepared.refund_id, responseHash, `http_${result.response.status}`);
        return reconciling(request);
      }
      const providerId = providerResourceId(result.body.id);
      if (!providerId || (result.body.payment_id !== undefined &&
        providerResourceId(result.body.payment_id) !== String(prepared.provider_payment_id))) {
        await markAmbiguous(service, prepared.refund_id, responseHash, 'refund_identity_missing_or_invalid');
        return reconciling(request);
      }
      // Identity comes from the authenticated response to this exact POST and
      // persisted idempotency key. Save it even if the rest of the response is
      // partial/pending, before any financial state is recorded.
      const captured = await service.rpc('record_payment_refund_identity', {
        p_refund_id: prepared.refund_id,
        p_payment_intent_id: paymentIntentId,
        p_provider_payment_id: String(prepared.provider_payment_id),
        p_idempotency_key: providerIdempotencyKey,
        p_provider_refund_id: providerId,
      });
      if (captured.error || captured.data !== true) {
        await markAmbiguous(service, prepared.refund_id, responseHash, 'refund_identity_not_persisted');
        return reconciling(request);
      }
      const verified = correlateProviderRefund([result.body], {
        amount: Number(prepared.amount), providerRefundId: providerId,
        paymentId: String(prepared.provider_payment_id), requestedAt: String(refundRow.requested_at),
      }, new Set());
      if (verified.kind !== 'matched') {
        await markAmbiguous(service, prepared.refund_id, responseHash, 'refund_response_requires_specific_lookup');
        return reconciling(request);
      }
      const providerStatus = String(verified.outcome.status);
      const { error: recordError } = await service.rpc('record_payment_refund_response', {
        p_refund_id: prepared.refund_id,
        p_provider_refund_id: providerId,
        p_status: providerStatus,
        p_amount: Number(verified.outcome.amount),
        p_response_hash: responseHash,
      });
      if (recordError) {
        await markAmbiguous(service, prepared.refund_id, responseHash, 'refund_response_not_persisted');
        return reconciling(request);
      }
      return refundResponse(request, providerStatus);
    } catch (_) {
      const requestHash = await sha256Hex(JSON.stringify({ paymentIntentId, idempotencyKey: providerIdempotencyKey, amount: prepared.amount }));
      await markAmbiguous(service, prepared.refund_id, requestHash, 'network_or_timeout');
      return reconciling(request);
    }
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

function refundResponse(request: Request, status: string): Response {
  return jsonResponse(request, {
    ok: status === 'approved', status,
    message: status === 'approved'
      ? 'El reembolso fue registrado. Verificá su acreditación en Mercado Pago.'
      : 'Mercado Pago rechazó el reembolso solicitado.',
  }, status === 'approved' ? 200 : 409);
}

function normalizedAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000 || Math.round(amount * 100) !== amount * 100) {
    throw new Error('Invalid refund amount');
  }
  return amount;
}

async function markAmbiguous(service: ReturnType<typeof createServiceClient>, refundId: string, hash: string, code: string): Promise<void> {
  await service.rpc('mark_payment_refund_ambiguous', {
    p_refund_id: refundId,
    p_request_hash: hash,
    p_error_code: code,
  });
}

function reconciling(request: Request): Response {
  return jsonResponse(request, {
    ok: false,
    code: 'REFUND_RECONCILING',
    message: 'El resultado del reembolso está siendo verificado antes de cualquier nuevo intento.',
  }, 202);
}

function unavailable(request: Request): Response {
  return jsonResponse(request, {
    ok: false,
    code: 'REFUND_NOT_AVAILABLE',
    message: 'No se pudo preparar el reembolso para este pago.',
  }, 409);
}
