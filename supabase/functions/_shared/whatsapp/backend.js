/**
 * El puerto contra el comercio.
 *
 * Todo lo que el canal sabe del negocio entra por acá, y todo lo que entra por
 * acá es una llamada a una función de la base. No hay una segunda fuente de
 * precios, de stock ni de pedidos: `create_checkout_session` es la misma que
 * usa la web, con el mismo payload y las mismas validaciones.
 *
 * `rpc(name, args)` lo inyecta el runtime: en producción es el cliente de
 * Supabase con service_role; en el E2E aislado es la misma función ejecutada
 * contra una base local. Cambia el transporte, no el contrato.
 */

import { sha256Hex } from './signature.js';

/**
 * @param {object} deps
 * @param {(name: string, args: object) => Promise<any>} deps.rpc
 * @param {string} deps.businessId
 * @param {string} deps.waId teléfono del cliente, tal como lo entrega Meta
 * @param {string} deps.customerId cliente del comercio ya resuelto
 * @param {string} deps.contactId
 * @param {string} deps.conversationId
 * @param {(input: object) => Promise<object>} deps.createPaymentLink
 */
export function createCommerceBackend(deps) {
  const { rpc, businessId } = deps;

  return {
    async shelves() {
      const data = await rpc('whatsapp_catalog_shelves', { p_business_id: businessId });
      return Array.isArray(data) ? data : [];
    },

    async products({ shelfId = null, query = null, limit = 8, offset = 0, productIds = null } = {}) {
      const data = await rpc('whatsapp_catalog_products', {
        p_business_id: businessId,
        p_shelf_id: shelfId,
        p_query: query,
        p_limit: limit,
        p_offset: offset,
        p_product_ids: productIds,
      });
      return {
        shelf_id: data?.shelf_id || shelfId || null,
        total: Number(data?.total || 0),
        products: Array.isArray(data?.products) ? data.products : [],
      };
    },

    async combos({ limit = 8, offset = 0 } = {}) {
      const data = await rpc('whatsapp_catalog_combos', {
        p_business_id: businessId,
        p_limit: limit,
        p_offset: offset,
      });
      return {
        total: Number(data?.total || 0),
        combos: Array.isArray(data?.combos) ? data.combos : [],
      };
    },

    async quote({ cart, fulfillmentType = 'delivery' }) {
      return rpc('whatsapp_quote_cart', {
        p_business_id: businessId,
        p_cart: cart,
        p_fulfillment_type: fulfillmentType,
      });
    },

    async saveDisplayName(name) {
      await rpc('whatsapp_upsert_contact', {
        p_business_id: businessId,
        p_wa_id: deps.waId,
        p_wa_id_hash: deps.waIdHash,
        p_display_name: name,
        p_customer_id: deps.customerId,
      });
    },

    /**
     * El único camino al cobro. Arma el MISMO payload que manda el navegador y
     * llama a la MISMA función: si acá hubiera un total, un precio o un
     * descuento, la base lo rechazaría por «campo no permitido en checkout».
     */
    async startPayment({ cart, fulfillmentType, address, ageConfirmed, contactName }) {
      const payload = await checkoutPayload({
        businessId,
        conversationId: deps.conversationId,
        cart,
        fulfillmentType,
        address,
        ageConfirmed,
        contactName,
        phone: deps.waId,
      });

      let checkout;
      try {
        checkout = await rpc('create_checkout_session', {
          p_customer_id: deps.customerId,
          p_payload: payload,
        });
      } catch (error) {
        return { ok: false, message: checkoutErrorMessage(error) };
      }
      if (!checkout?.checkout_session_id) {
        return { ok: false, message: 'No pudimos preparar este pago. Revisá el carrito y volvé a intentar.' };
      }

      const link = await deps.createPaymentLink({
        checkoutSessionId: checkout.checkout_session_id,
        customerId: deps.customerId,
      });
      if (!link?.initPoint) {
        return {
          ok: false,
          checkoutSessionId: checkout.checkout_session_id,
          message: link?.message || 'Estamos verificando la preparación de tu pago. No vuelvas a pagar todavía.',
        };
      }

      return {
        ok: true,
        checkoutSessionId: checkout.checkout_session_id,
        total: checkout.total,
        expiresAt: checkout.expires_at,
        initPoint: link.initPoint,
      };
    },
  };
}

/**
 * `client_request_id` es la idempotencia del checkout: el mismo carrito, la
 * misma dirección y la misma modalidad devuelven la MISMA sesión, así que tocar
 * «Pagar» dos veces no reserva stock dos veces ni abre dos pagos. Cambiar
 * cualquier cosa del pedido cambia el identificador, que es exactamente lo que
 * la base exige para no confundir dos compras distintas.
 */
export async function checkoutPayload({
  businessId, conversationId, cart, fulfillmentType, address, ageConfirmed, contactName, phone,
}) {
  const items = cart.map((line) => (line.product_id
    ? { product_id: line.product_id, quantity: line.quantity }
    : { combo_id: line.combo_id, quantity: line.quantity }));

  const normalizedAddress = fulfillmentType === 'delivery' ? cleanAddress(address) : {};
  const fingerprint = await sha256Hex(JSON.stringify({
    conversationId,
    items: [...items].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    fulfillmentType,
    address: normalizedAddress,
    ageConfirmed: Boolean(ageConfirmed),
    contactName,
  }));

  return {
    business_id: businessId,
    client_request_id: `wa${fingerprint.slice(0, 30)}`,
    items,
    fulfillment_type: fulfillmentType,
    contact: {
      name: String(contactName || '').slice(0, 80),
      phone: String(phone || '').replace(/[^0-9]/g, ''),
    },
    address: normalizedAddress,
    age_confirmed: Boolean(ageConfirmed),
    payment_method: 'mercadopago',
  };
}

function cleanAddress(address = {}) {
  const allowed = [
    'label', 'street', 'street_number', 'floor', 'apartment', 'reference',
    'city', 'province', 'postal_code', 'latitude', 'longitude',
    'geolocation_accuracy', 'source',
  ];
  const result = {};
  for (const key of allowed) {
    const value = address?.[key];
    if (value === undefined || value === null || value === '') continue;
    result[key] = value;
  }
  return result;
}

/**
 * El error de la base es para el registro del servidor, no para el chat. Se
 * traduce a algo accionable sin filtrar la excepción ni el SQLSTATE.
 */
function checkoutErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('stock')) return 'Se nos acaba de terminar el stock de algo del carrito. Revisalo y volvé a intentar.';
  if (message.includes('minimo') || message.includes('mínimo') || message.includes('delivery')) {
    return 'No llegamos al mínimo de envío. Sumá algo más o elegí retiro en el local.';
  }
  if (message.includes('alcohol') || message.includes('edad')) {
    return 'No podemos vender alcohol en este momento. Sacá esos productos y seguimos.';
  }
  if (message.includes('direccion') || message.includes('dirección')) {
    return 'La dirección quedó incompleta. Mandame calle, número y ciudad.';
  }
  return 'No podemos preparar este pago ahora. Revisá el carrito y volvé a intentar.';
}
