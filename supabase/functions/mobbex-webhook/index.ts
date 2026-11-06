import {
  createServiceClient,
  enforceRateLimit,
  jsonResponse,
  publicErrorResponse,
  requirePost,
} from '../_shared/payment-runtime.ts';
import { requestIsHttps } from '../_shared/request-protocol.ts';
import { handleMobbexWebhook } from '../_shared/mobbex/handlers.ts';
import { MOBBEX_WEBHOOK_MAX_BYTES } from '../_shared/mobbex/webhook.ts';
import { mobbexConfigFromEnv, mobbexLedger, mobbexOperations, sha256Hex } from '../_shared/mobbex/runtime.ts';

async function readBounded(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) { await reader.cancel(); break; }
  }
  const all = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) { const part = chunk.subarray(0, Math.max(0, all.length - offset)); all.set(part, offset); offset += part.length; if (offset >= all.length) break; }
  return new TextDecoder().decode(all);
}

// Mobbex documents no webhook signature. The body is an untrusted hint; the URL carries TABA's own capability token
// (see _shared/mobbex/webhook.ts) and the state only ever changes after an authenticated read of the operation.
Deno.serve(async (request) => {
  try {
    requirePost(request);
    // `consume_payment_rate_limit` only accepts the scopes of payment_rate_limit_scope_check: any other value raises
    // and turns into a permanent 429. The `mobbex-` subject keeps the bucket apart from Mercado Pago's.
    await enforceRateLimit(createServiceClient(), request, 'webhook', 240, 60, 'mobbex-webhook');
    // The body is only a hint: it is read AFTER the rate limit and never beyond the cap (a declared or streamed oversize body is
    // refused without being buffered). Before: the whole body was buffered first, for any caller, with or without the token.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MOBBEX_WEBHOOK_MAX_BYTES) return jsonResponse(request, { ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    const rawBody = await readBounded(request, MOBBEX_WEBHOOK_MAX_BYTES + 1);
    if (new TextEncoder().encode(rawBody).byteLength > MOBBEX_WEBHOOK_MAX_BYTES) return jsonResponse(request, { ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    const result = await handleMobbexWebhook({
      ledger: mobbexLedger(),
      operations: { createCheckout: () => Promise.reject(new Error('unused')), getOperationByReference: (reference) => mobbexOperations(mobbexConfigFromEnv()).getOperationByReference(reference), getOperationByUid: (uid) => mobbexOperations(mobbexConfigFromEnv()).getOperationByUid(uid) },
      resolveConfig: mobbexConfigFromEnv,
      sha256Hex,
    }, { url: new URL(request.url), rawBody, https: requestIsHttps(request) });
    return jsonResponse(request, result.body, result.status);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
