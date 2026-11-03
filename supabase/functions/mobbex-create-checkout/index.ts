import {
  assertAllowedOrigin,
  checkoutReturnUrl,
  createServiceClient,
  enforceRateLimit,
  getRequiredEnv,
  handleOptions,
  jsonResponse,
  publicErrorResponse,
  readJsonObject,
  requireAuthenticatedUser,
  requirePost,
} from '../_shared/payment-runtime.ts';
import { createMobbexCheckout } from '../_shared/mobbex/handlers.ts';
import { mobbexConfigFromEnv, mobbexLedger, mobbexOperations } from '../_shared/mobbex/runtime.deno.ts';

// Creates the hosted Mobbex checkout for the signed-in customer. Nothing the browser sends can set an amount:
// the database prices the session (create_mobbex_checkout_session) and this function reads the total back from it.
Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const payload = await readJsonObject(request);
    const { user } = await requireAuthenticatedUser(request);
    await enforceRateLimit(createServiceClient(), request, 'mobbex_checkout', 12, 600, user.id);
    const result = await createMobbexCheckout({
      ledger: mobbexLedger(),
      resolveConfig: mobbexConfigFromEnv,
      operations: mobbexOperations,
      supabaseUrl: getRequiredEnv('SUPABASE_URL'),
      returnUrl: checkoutReturnUrl('/pago/resultado'),
      now: Date.now,
    }, { userId: user.id, userEmail: user.email ?? 'cliente@taba.invalid', payload });
    return jsonResponse(request, result.body, result.status);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
