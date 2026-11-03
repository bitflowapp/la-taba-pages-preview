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
import { mobbexConfigFromEnv, mobbexLedger, mobbexOperations } from '../_shared/mobbex/runtime.ts';

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
    // Existing scope + provider-prefixed subject: a scope outside payment_rate_limit_scope_check would always answer 429.
    await enforceRateLimit(createServiceClient(), request, 'checkout_session', 12, 600, `mobbex:${user.id}`);
    const result = await createMobbexCheckout({
      ledger: mobbexLedger(),
      resolveConfig: mobbexConfigFromEnv,
      operations: mobbexOperations,
      supabaseUrl: getRequiredEnv('SUPABASE_URL'),
      // Its own return page: the Mercado Pago one looks for a Mercado Pago record. Returning never marks anything paid.
      returnUrl: new URL('./mobbex/', checkoutReturnUrl('/pago/resultado')).toString(),
      now: Date.now,
    }, { userId: user.id, userEmail: user.email ?? 'cliente@taba.invalid', payload });
    return jsonResponse(request, result.body, result.status);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
