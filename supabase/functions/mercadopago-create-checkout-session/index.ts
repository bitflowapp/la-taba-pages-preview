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

    // A checkout reserves stock. Without a seller that can actually charge
    // (connected, with protected tokens, same collector and application as the
    // settings) the preference would be refused anyway, so the stock is never
    // taken. The same rule decides whether the storefront offers the option.
    const businessId = String(payload.business_id || '').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
      const { data: availability, error: availabilityError } = await service.rpc('get_mercadopago_checkout_availability', {
        p_business_id: businessId,
      });
      if (availabilityError || availability?.available !== true) {
        return jsonResponse(request, {
          ok: false,
          code: 'PAYMENTS_NOT_ENABLED',
          message: 'Mercado Pago no está disponible para este comercio en este momento.',
        }, 409);
      }
    }

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
