import {
  assertAllowedOrigin,
  handleOptions,
  jsonResponse,
  publicErrorResponse,
  readJsonObject,
  requireAuthenticatedUser,
  requirePost,
} from '../_shared/payment-runtime.ts';
import { mobbexAvailability } from '../_shared/mobbex/customer-handlers.ts';
import { mobbexConfigFromEnv } from '../_shared/mobbex/runtime.ts';

// «Mobbex» appears in the storefront checkout only when this says so: deployment switch + credentials + business
// flag + (in production) an open authorization for THIS customer. Default: not available.
Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    const { client } = await requireAuthenticatedUser(request);
    const result = await mobbexAvailability({
      resolveConfig: mobbexConfigFromEnv,
      databaseAvailability: async (businessId) => {
        const { data, error } = await client.rpc('get_mobbex_checkout_availability', { p_business_id: businessId });
        if (error) return { available: false };
        return { available: (data as { available?: boolean })?.available === true, environment: (data as { environment?: string })?.environment };
      },
    }, String(body.business_id ?? ''));
    return jsonResponse(request, result.body, result.status);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
