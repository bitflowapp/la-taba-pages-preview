import { checkoutRefusal } from '../_shared/checkout-refusal.ts';
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
import { assertPaymentCreationGate } from '../_shared/seller-oauth.ts';

Deno.serve(async (request) => {
  const preflight = handleOptions(request);
  if (preflight) return preflight;
  try {
    requirePost(request);
    assertAllowedOrigin(request);
    const payload = await readJsonObject(request);
    const { user } = await requireAuthenticatedUser(request);
    const service = createServiceClient();
    // `availability_only` pregunta si se puede pagar con Mercado Pago y no crea
    // nada. Tiene el cupo de una consulta —el de la pantalla de estado—, no el
    // de crear checkouts, que es el que protege el stock.
    const availabilityOnly = payload.availability_only === true;
    if (availabilityOnly) await enforceRateLimit(service, request, 'checkout_status', 60, 60, user.id);
    else await enforceRateLimit(service, request, 'checkout_session', 12, 600, user.id);

    // A checkout reserves stock. Without a seller that can actually charge
    // (connected, with protected tokens, same collector and application as the
    // settings) the preference would be refused anyway, so the stock is never
    // taken. The same rule decides whether the storefront offers the option.
    //
    // Y sin la compuerta de despliegue abierta, tampoco. Es la misma función
    // que evalúa `mercadopago-create-preference`: si acá pasa y allá no, cada
    // intento deja una sesión y quince minutos de stock reservado para un pago
    // que no se puede emitir. Con la compuerta de producción cerrada eso era
    // todo cliente que tocaba pagar.
    let environment = '';
    try {
      environment = assertPaymentCreationGate().environment;
    } catch (error) {
      // Sólo el motivo: los mensajes de la compuerta nombran la variable que
      // falta, nunca su valor.
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'payment_creation_gate_closed',
        reason: error instanceof Error ? error.message : 'unknown',
      }));
    }
    const businessId = String(payload.business_id || '').trim();
    const businessIdIsValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId);
    let availability: Record<string, unknown> | null = null;
    if (environment && businessIdIsValid) {
      const { data, error: availabilityError } = await service.rpc('get_mercadopago_checkout_availability', {
        p_business_id: businessId,
      });
      availability = !availabilityError && data && typeof data === 'object' ? data as Record<string, unknown> : null;
    }
    // La configuración del negocio tiene que ser del entorno de este proyecto:
    // con otro, la preferencia se niega («environment does not match»).
    const available = availability?.available === true && availability.environment === environment;

    if (availabilityOnly) {
      return jsonResponse(request, {
        ok: true,
        availability: {
          available,
          environment: availability?.environment ?? null,
          checkout_mode: availability?.checkout_mode ?? null,
          allow_offline_payment_methods: availability?.allow_offline_payment_methods === true,
          installments_limit: availability?.installments_limit ?? null,
        },
      });
    }
    // Un `business_id` que ni siquiera es un UUID sigue de largo con la
    // compuerta abierta: lo rechaza la base, como siempre, sin reservar nada.
    if (!available && (!environment || businessIdIsValid)) {
      return jsonResponse(request, {
        ok: false,
        code: 'PAYMENTS_NOT_ENABLED',
        message: 'Mercado Pago no está disponible para este comercio en este momento.',
      }, 409);
    }

    // The database function whitelists this payload again and calculates all
    // commercial values itself. This Edge Function never accepts a total,
    // price, currency, preference ID, payment ID, or provider status.
    const { data, error } = await service.rpc('create_checkout_session', {
      p_customer_id: user.id,
      p_payload: payload,
    });
    // Una respuesta sin sesión no es un checkout: el freno de la base puede
    // contestar su propio cuerpo en lugar de levantar una excepción.
    const created = !error && data && typeof data === 'object' && !Array.isArray(data)
      && typeof (data as Record<string, unknown>).checkout_session_id === 'string';
    if (!created) {
      const { status, ...refusal } = checkoutRefusal(error || data);
      return jsonResponse(request, { ok: false, ...refusal }, status);
    }
    return jsonResponse(request, { ok: true, checkout: data });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
