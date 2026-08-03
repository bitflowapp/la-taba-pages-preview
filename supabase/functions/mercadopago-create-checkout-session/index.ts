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

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const payload = await readJsonObject(request);
    const { user } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'checkout_session', 12, 600, user.id);

    // The database function whitelists this payload again and calculates all
    // commercial values itself. This Edge Function never accepts a total,
    // price, currency, preference ID, payment ID, or provider status.
    const { data, error } = await service.rpc('create_checkout_session', {
      p_customer_id: user.id,
      p_payload: payload,
    });
    if (error || !data) {
      return jsonResponse(request, {
        ok: false,
        code: 'CHECKOUT_NOT_AVAILABLE',
        message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.',
      }, 409);
    }
    return jsonResponse(request, { ok: true, checkout: data });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
