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
import { mobbexCheckoutStatus } from '../_shared/mobbex/customer-handlers.ts';
import { mobbexConfigFromEnv, mobbexLedger, mobbexOperations } from '../_shared/mobbex/runtime.ts';

// The page the customer lands on after Mobbex READS the payment; it never writes "paid" itself. The confirmation is
// an authenticated server-to-server read of the operation, the same one the worker does.
Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    const sessionId = requireUuid(body.checkout_session_id, 'checkout_session_id');
    const { user, client } = await requireAuthenticatedUser(request);
    // Same budget as the Mercado Pago status poll: the return page polls every 3 s for up to 20 attempts per load.
    await enforceRateLimit(createServiceClient(), request, 'checkout_status', 60, 60, `mobbex:${user.id}`);
    const result = await mobbexCheckoutStatus({
      ledger: mobbexLedger(),
      operations: { createCheckout: () => Promise.reject(new Error('unused')), getOperationByReference: (reference) => mobbexOperations(mobbexConfigFromEnv()).getOperationByReference(reference) },
      resolveConfig: mobbexConfigFromEnv,
      requestReconcile: async (id) => {
        const { data, error } = await client.rpc('mobbex_request_reconcile', { p_checkout_session_id: id });
        if (error) throw new Error('not available');
        return (data ?? {}) as { queued?: boolean; intent_id?: string; reference?: string };
      },
      readStatus: async (id) => {
        const { data, error } = await client.rpc('get_mobbex_checkout_status', { p_checkout_session_id: id });
        return error || !data ? null : data as Record<string, unknown>;
      },
    }, sessionId);
    return jsonResponse(request, result.body, result.status);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
