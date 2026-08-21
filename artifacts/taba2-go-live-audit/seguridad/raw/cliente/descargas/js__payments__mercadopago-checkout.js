const STORAGE_VERSION = 'taba-mercadopago-checkout-v1';

export function createCheckoutClientRequestId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID !== 'function') {
    throw new Error('secure random UUID unavailable');
  }
  return cryptoImpl.randomUUID();
}

export function buildMercadoPagoCheckoutPayload({
  businessId,
  clientRequestId,
  values = {},
  items = [],
} = {}) {
  // Una línea es de producto o de combo. El combo viaja por su identificador
  // estable y NUNCA con un precio: el backend deriva el precio de lista de los
  // precios que bloquea al reservar y aplica el descuento aprobado. Mandar un
  // precio desde acá sería justamente lo que el contrato prohíbe.
  const normalizedItems = items.map((item) => {
    const comboId = String(item?.combo_id || item?.comboId || '').trim();
    const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    if (comboId) return { combo_id: comboId, quantity };
    return {
      product_id: String(item?.product_id || item?.productId || '').trim(),
      quantity,
    };
  });
  const delivery = String(values.deliveryMode || values.fulfillmentType || 'delivery').trim().toLowerCase();
  const address = delivery === 'delivery'
    ? compactObject({
      ...(values.customerAddressId ? { customer_address_id: String(values.customerAddressId).trim() } : {}),
      label: text(values.customerAddressLabel || values.customerAddress),
      street: text(values.deliveryStreet || values.addressDetails?.street || values.customerStreetAddress),
      street_number: text(values.deliveryStreetNumber || values.addressDetails?.streetNumber),
      floor: text(values.deliveryFloor),
      apartment: text(values.deliveryApartment),
      reference: text(values.customerReference || values.addressDetails?.reference),
      city: text(values.deliveryCity || values.customerNeighborhood || values.addressDetails?.neighborhood),
      // El barrio declarado va aparte de la localidad: es una de las dos
      // entradas con las que el backend resuelve la cobertura, y confundirlo con
      // la ciudad haría que «Neuquén» pareciera un barrio de la lista.
      neighborhood: text(values.deliveryNeighborhood || values.customerNeighborhood),
      province: text(values.deliveryProvince),
      postal_code: text(values.deliveryPostalCode),
      source: text(values.deliveryAddressSource || 'manual'),
      // El punto de entrega viaja con la dirección. Faltaba: con dirección
      // escrita a mano el pedido de Checkout Pro nacía sin coordenadas aunque
      // la persona hubiera confirmado el pin, y la instantánea del Rider —que
      // se toma al crear el pedido y es inmutable— quedaba vacía para siempre.
      ...coordinate('latitude', values.deliveryLatitude),
      ...coordinate('longitude', values.deliveryLongitude),
      ...coordinate('geolocation_accuracy', values.deliveryGeolocationAccuracy),
      location_source: text(values.deliveryLocationSource),
      location_confirmed_at: text(values.deliveryLocationConfirmedAt),
    })
    : {};

  return {
    business_id: String(businessId || '').trim(),
    client_request_id: String(clientRequestId || '').trim(),
    items: normalizedItems,
    fulfillment_type: delivery,
    contact: {
      name: text(values.customerName),
      phone: text(values.customerPhone),
    },
    address,
    age_confirmed: values.ageConfirmed === true,
    payment_method: 'mercadopago',
    // Las observaciones del pedido —«tocar timbre», «dejar en portería», «sin
    // hielo»— faltaban acá, así que el negocio preparaba y el rider salía sin
    // la indicación que la persona escribió. El camino directo sí las manda
    // (`customer_notes`); éste no.
    //
    // La clave sólo viaja cuando hay algo que decir: `create_checkout_session`
    // valida el payload contra una LISTA BLANCA y levanta «campo no permitido»
    // ante lo que no conoce, así que esta línea depende de la migración que
    // agrega `notes` a esa lista (20260812235000). Las dos mitades van juntas o
    // el checkout entero se cae.
    ...(text(values.customerNotes) ? { notes: text(values.customerNotes) } : {}),
  };
}

export function checkoutStorageKey(businessId) {
  return `${STORAGE_VERSION}:${String(businessId || '').trim()}`;
}

export function readMercadoPagoCheckoutRecord(storage, businessId) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(checkoutStorageKey(businessId)) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const checkoutSessionId = String(parsed.checkoutSessionId || '').trim();
    if (!isUuid(checkoutSessionId)) return null;
    return {
      checkoutSessionId,
      updatedAt: String(parsed.updatedAt || ''),
    };
  } catch (_) {
    return null;
  }
}

export function writeMercadoPagoCheckoutRecord(storage, businessId, checkoutSessionId) {
  if (!isUuid(checkoutSessionId)) return false;
  try {
    storage?.setItem?.(checkoutStorageKey(businessId), JSON.stringify({
      checkoutSessionId,
      updatedAt: new Date().toISOString(),
    }));
    return true;
  } catch (_) {
    return false;
  }
}

export function clearMercadoPagoCheckoutRecord(storage, businessId) {
  try {
    storage?.removeItem?.(checkoutStorageKey(businessId));
  } catch (_) {
    // Private browsing or storage limits only affect convenience recovery.
  }
}

export function paymentStatusPresentation(checkout = {}) {
  const sessionStatus = String(checkout.status || '').toLowerCase();
  const paymentStatus = String(checkout.payment_status || '').toLowerCase();
  if (sessionStatus === 'completed' || paymentStatus === 'completed') {
    return { state: 'completed', label: 'Pedido confirmado', terminal: true, clearCart: true };
  }
  if (sessionStatus === 'manual_review_required' || paymentStatus === 'security_review_required') {
    return { state: 'manual_review', label: 'Necesitamos revisar este pago', terminal: true, clearCart: false };
  }
  if (sessionStatus === 'payment_approved' || sessionStatus === 'finalizing_order' || paymentStatus === 'approved_order_pending') {
    return { state: 'finalizing', label: 'Confirmando tu pedido', terminal: false, clearCart: false };
  }
  if (['pending', 'in_process'].includes(paymentStatus) || sessionStatus === 'payment_pending') {
    return { state: 'pending', label: 'Pago pendiente', terminal: false, clearCart: false };
  }
  if (['rejected', 'cancelled', 'expired', 'failed'].includes(paymentStatus) || ['cancelled', 'expired'].includes(sessionStatus)) {
    return { state: 'rejected', label: 'Pago rechazado', terminal: true, clearCart: false };
  }
  return { state: 'verifying', label: 'Verificando el pago', terminal: false, clearCart: false };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== ''));
}

// El backend valida las coordenadas como texto con una expresión regular
// estricta, así que se mandan como número serializado y sólo si son finitas.
// Un `NaN` o una cadena vacía haría abortar el checkout entero.
function coordinate(key, value) {
  const numeric = Number(value);
  if (value == null || String(value).trim() === '' || !Number.isFinite(numeric)) return {};
  return { [key]: String(numeric) };
}

function text(value) {
  return String(value || '').trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
