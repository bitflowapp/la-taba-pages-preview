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

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const body = await readJsonObject(request);
    const checkoutSessionId = requireUuid(body.checkout_session_id, 'checkout_session_id');
    const { user, client } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'checkout_status', 60, 60, user.id);
    const { data, error } = await client.rpc('get_checkout_session_for_customer', {
      p_checkout_session_id: checkoutSessionId,
    });
    if (error || !data) {
      return jsonResponse(request, {
        ok: false,
        code: 'CHECKOUT_NOT_FOUND',
        message: 'No encontramos ese checkout en tu sesión.',
      }, 404);
    }
    return jsonResponse(request, { ok: true, checkout: data });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
