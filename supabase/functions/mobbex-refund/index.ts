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
} from '../_shared/payment-runtime.ts';
import { refundMobbexPayment } from '../_shared/mobbex/customer-handlers.ts';
import { mobbexConfigFromEnv, mobbexOperations } from '../_shared/mobbex/runtime.ts';

// Only an owner/admin of the business passes `mobbex_prepare_refund` (it runs with the caller's session).
Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    const { user, client } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'refund', 6, 600, `mobbex:${user.id}`);
    const result = await refundMobbexPayment({
      resolveConfig: mobbexConfigFromEnv,
      prepareRefund: async ({ intentId, amount, idempotencyKey, reason }) => {
        const { data, error } = await client.rpc('mobbex_prepare_refund', {
          p_payment_intent_id: intentId, p_amount: amount, p_idempotency_key: idempotencyKey, p_reason: reason || null,
        });
        if (error || !data) throw new Error('refund not available');
        return data as Record<string, unknown>;
      },
      // supabase-js does not throw: an unchecked `{ error }` would send the refund without marking it, or lose Mobbex's answer.
      markRefundSent: async (refundId) => {
        const { error } = await service.rpc('mobbex_mark_refund_sent', { p_refund_id: refundId });
        if (error) throw new Error('refund could not be marked as sent');
      },
      recordRefundResult: async (refundId, outcome, hash) => {
        const { error } = await service.rpc('mobbex_record_refund_result', { p_refund_id: refundId, p_outcome: outcome, p_response_hash: hash });
        if (error) throw new Error('refund result could not be recorded');
      },
      refundOperation: (operationId, cents) => mobbexOperations(mobbexConfigFromEnv()).refundOperation(operationId, cents),
    }, body);
    return jsonResponse(request, result.body, result.status);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
