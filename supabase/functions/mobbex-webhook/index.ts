import {
  createServiceClient,
  enforceRateLimit,
  jsonResponse,
  publicErrorResponse,
  requirePost,
} from '../_shared/payment-runtime.ts';
import { requestIsHttps } from '../_shared/request-protocol.ts';
import { handleMobbexWebhook } from '../_shared/mobbex/handlers.ts';
import { mobbexConfigFromEnv, mobbexLedger, mobbexOperations, sha256Hex } from '../_shared/mobbex/runtime.deno.ts';

// Mobbex documents no webhook signature. The body is an untrusted hint; the URL carries TABA's own capability token
// (see _shared/mobbex/webhook.ts) and the state only ever changes after an authenticated read of the operation.
Deno.serve(async (request) => {
  try {
    requirePost(request);
    const rawBody = await request.clone().text();
    await enforceRateLimit(createServiceClient(), request, 'mobbex_webhook', 240, 60, 'mobbex-webhook');
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
