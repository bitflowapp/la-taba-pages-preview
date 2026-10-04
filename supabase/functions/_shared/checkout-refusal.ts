/**
 * Por qué la base rechazó un checkout, dicho en un código público.
 *
 * `mercadopago-create-checkout-session` respondía CHECKOUT_NOT_AVAILABLE
 * —«revisá el carrito y volvé a intentar»— para todo: el local cerrado, la
 * dirección fuera de cobertura, el pedido debajo del mínimo, el freno por
 * intentos. Reintentar no arregla ninguno de esos, y ni el cliente ni soporte
 * podían saber cuál era.
 *
 * Lo que sale de acá es un conjunto CERRADO de códigos con un mensaje escrito
 * en este archivo. El mensaje, el detalle y la pista de la base no se reenvían
 * nunca. Las reglas exigen el SQLSTATE y el texto exactos que levanta
 * `create_checkout_session` —salvo el freno por intentos (54000) y la clave de
 * solicitud repetida (23505), que esa función usa para una sola cosa y se
 * reconocen por el SQLSTATE—, y lo que no coincide con ninguna queda en el
 * código genérico de siempre.
 */

export type CheckoutRefusal = {
  status: number;
  code:
    | 'CHECKOUT_NOT_AVAILABLE'
    | 'BUSINESS_CLOSED'
    | 'ALCOHOL_WINDOW_CLOSED'
    | 'OUT_OF_DELIVERY_ZONE'
    | 'DELIVERY_LOCATION_REQUIRED'
    | 'BELOW_MINIMUM'
    | 'OUT_OF_STOCK'
    | 'ORDER_TOO_LARGE'
    | 'RATE_LIMITED'
    | 'IDEMPOTENCY_CONFLICT';
  message: string;
  product_id?: string;
  retry_after_seconds?: number;
};

const GENERIC: CheckoutRefusal = {
  status: 409,
  code: 'CHECKOUT_NOT_AVAILABLE',
  message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.',
};

// (SQLSTATE, mensaje exacto) → rechazo público. Los textos son los de
// `create_checkout_session_reserving` y `private.order_intake_guard`.
const EXACT: Array<[string, string, Omit<CheckoutRefusal, 'status'>]> = [
  ['55000', 'BUSINESS_CLOSED', {
    code: 'BUSINESS_CLOSED',
    message: 'El comercio está cerrado en este momento. Podés hacer el pedido dentro del horario de atención.',
  }],
  ['55000', 'ALCOHOL_WINDOW_CLOSED', {
    code: 'ALCOHOL_WINDOW_CLOSED',
    message: 'En este horario no se venden bebidas alcohólicas. Quitalas del carrito o volvé a intentar más tarde.',
  }],
  ['55000', 'venta de alcohol fuera de horario', {
    code: 'ALCOHOL_WINDOW_CLOSED',
    message: 'En este horario no se venden bebidas alcohólicas. Quitalas del carrito o volvé a intentar más tarde.',
  }],
  ['55000', 'OUT_OF_DELIVERY_ZONE', {
    code: 'OUT_OF_DELIVERY_ZONE',
    message: 'Tu dirección está fuera de la zona de envío. Podés elegir retiro en el local.',
  }],
  ['22023', 'DELIVERY_LOCATION_REQUIRED', {
    code: 'DELIVERY_LOCATION_REQUIRED',
    message: 'Confirmá tu ubicación en el mapa para poder enviarte el pedido.',
  }],
  // La base levanta este texto por tres razones y sólo la primera es del
  // cliente: el carrito no llega al mínimo de la zona; la zona no tiene costo de
  // envío cargado; la zona no tiene mínimo y sus reglas no se exigen. El mensaje
  // no afirma cuál fue —no se sabe— y ofrece la salida que sirve en las tres.
  // (Separar el texto es de la base: `create_checkout_session_reserving`.)
  ['23514', 'configuracion o minimo de delivery no valido', {
    code: 'BELOW_MINIMUM',
    message: 'No podemos tomar este pedido con envío: puede que no llegue al mínimo de tu zona. Sumá productos o elegí retiro en el local.',
  }],
  ['22023', 'ORDER_TOO_LARGE', {
    code: 'ORDER_TOO_LARGE',
    message: 'El pedido supera la cantidad máxima por compra. Reducí las cantidades o coordiná el pedido con el comercio.',
  }],
];

const OUT_OF_STOCK = /^stock insuficiente para producto: ([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const RETRY_HINT = /^reintentar en ([1-9][0-9]{0,4}) segundos$/;

/**
 * `refusal` es el error de PostgREST tal como lo entrega supabase-js
 * (`{ code, message, details, hint }`), o el cuerpo que devolvió la función
 * cuando no trae una sesión.
 */
export function checkoutRefusal(refusal: unknown): CheckoutRefusal {
  const source = refusal && typeof refusal === 'object' && !Array.isArray(refusal)
    ? refusal as Record<string, unknown>
    : {};
  const code = typeof source.code === 'string' ? source.code : '';
  const message = typeof source.message === 'string' ? source.message : '';

  // El freno por intentos llega de dos maneras: la base lo responde por
  // PostgREST como HTTP 429 con este código en el cuerpo, o lo levanta como
  // excepción. En las dos el código es el mismo.
  if (code === '54000') {
    const retry = typeof source.hint === 'string' ? RETRY_HINT.exec(source.hint) : null;
    return {
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Hiciste varios intentos seguidos. Esperá unos minutos y volvé a intentar.',
      ...(retry ? { retry_after_seconds: Number(retry[1]) } : {}),
    };
  }
  if (code === '23505') {
    return {
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Esta solicitud de pago ya se usó con otro carrito. Volvé a intentar desde el carrito.',
    };
  }
  if (code === '23514') {
    const stock = OUT_OF_STOCK.exec(message);
    if (stock) {
      return {
        status: 409,
        code: 'OUT_OF_STOCK',
        message: 'No queda stock suficiente de uno de los productos. Revisá el carrito.',
        product_id: stock[1].toLowerCase(),
      };
    }
  }
  for (const [sqlstate, text, known] of EXACT) {
    if (code === sqlstate && message === text) return { status: 409, ...known };
  }
  return { ...GENERIC };
}
