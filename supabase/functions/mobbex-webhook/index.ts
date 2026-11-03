import {
  createServiceClient,
  enforceRateLimit,
  jsonResponse,
  publicErrorResponse,
  requirePost,
} from '../_shared/payment-runtime.ts';
import { requestIsHttps } from '../_shared/request-protocol.ts';
import { handleMobbexWebhook } from '../_shared/mobbex/handlers.ts';
import { mobbexConfigFromEnv, mobbexLedger, mobbexOperations, sha256Hex } from '../_shared/mobbex/runtime.ts';

// Mobbex documents no webhook signature. The body is an untrusted hint; the URL carries TABA's own capability token
// (see _shared/mobbex/webhook.ts) and the state only ever changes after an authenticated read of the operation.
Deno.serve(async (request) => {
  try {
    requirePost(request);
    const rawBody = await request.clone().text();
    // `consume_payment_rate_limit` only accepts the scopes of payment_rate_limit_scope_check: any other value raises
    // and turns into a permanent 429. The `mobbex-` subject keeps the bucket apart from Mercado Pago's.
    await enforceRateLimit(createServiceClient(), request, 'webhook', 240, 60, 'mobbex-webhook');
    const result = await handleMobbexWebhook({
      ledger: mobbexLedger(),
      operations: { createCheckout: () => Promise.reject(new Error('unused')), getOperationByReference: (reference) => mobbexOperations(mobbexConfigFromEnv()).getOperationByReference(reference) },
      resolveConfig: mobbexConfigFromEnv,
      sha256Hex,
    }, { url: new URL(request.url), rawBody, https: requestIsHttps(request) });
    return jsonResponse(request, result.body, result.status);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
