import {
  jsonResponse,
  publicErrorResponse,
  requirePost,
  requireWorkerAuthorization,
} from '../_shared/payment-runtime.ts';
import { runMobbexWorker } from '../_shared/mobbex/handlers.ts';
import { mobbexConfigFromEnv, mobbexLedger, mobbexOperations } from '../_shared/mobbex/runtime.deno.ts';

// Scheduled reconciliation: sweeps stale payments back into the queue, then reads each one from Mobbex and hands the
// confirmed answer to the ledger. Non-JWT only because a scheduler calls it; it requires the shared worker secret.
Deno.serve(async (request) => {
  try {
    requirePost(request);
    await requireWorkerAuthorization(request);
    let config;
    try { config = mobbexConfigFromEnv(); } catch (_) {
      return jsonResponse(request, { ok: true, ignored: 'disabled' });
    }
    const result = await runMobbexWorker({
      ledger: mobbexLedger(),
      operations: mobbexOperations(config),
      now: Date.now,
    }, { owner: `mobbex-worker:${crypto.randomUUID()}`, budgetMs: 40_000 });
    return jsonResponse(request, result);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
