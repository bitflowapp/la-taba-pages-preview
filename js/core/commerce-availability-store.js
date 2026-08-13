// Commerce Availability Store
// ---------------------------
// Guarda la última respuesta del backend a «¿estás abierto?, ¿llegás a esta
// dirección?, ¿cuánto sale el envío?, ¿cuál es el mínimo?». Esa respuesta la
// produce `commerce_availability` en la base, que es la MISMA función que
// consulta el checkout al crear la sesión: lo que se muestra y lo que se cobra
// no pueden divergir porque salen del mismo lugar.
//
// QUÉ NO HACE ESTE MÓDULO
// -----------------------
// No decide. No calcula una tarifa, no evalúa un horario y no compara una
// dirección contra una lista. Todo eso pasa en el servidor. Acá sólo se
// normaliza lo que llegó y se lo deja disponible para la tienda.
//
// POR QUÉ NO BLOQUEA CUANDO NO SABE
// ---------------------------------
// Mientras no haya respuesta —modo demo, sandbox, red caída, primer arranque—
// el estado es `known: false` y la tienda NO bloquea. El cliente nunca habilita
// una compra: la habilita el backend, que rechaza igual si no corresponde.
// Bloquear por desconocimiento rompería la tienda cada vez que se cae una
// consulta, sin ganar una sola garantía: la garantía ya está del otro lado.
// Cuando el servidor SÍ contestó y dijo que no, ahí sí se bloquea, y con la
// frase que mandó el servidor.
//
// Es una hoja: no importa state.js ni pricing.js, así cualquier consumidor
// puede leerlo sin ciclos de import.

const OUT_OF_COVERAGE_FALLBACK = 'Por el momento no realizamos entregas en esta zona.';
const CLOSED_FALLBACK = 'El comercio está cerrado en este momento.';

const EMPTY = Object.freeze({
  known: false,
  businessId: '',
  channel: 'delivery',
  orderingReady: false,
  isOpen: true,
  hoursEnforced: false,
  coverageEnforced: false,
  nextOpenAt: null,
  hours: Object.freeze([]),
  areas: Object.freeze([]),
  delivery: Object.freeze({
    eligible: false,
    reason: '',
    message: '',
    zoneName: '',
    deliveryFee: null,
    minimumSubtotal: null,
  }),
});

let current = EMPTY;

function text(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  // Los caracteres de control no llegan a una pantalla. Se escriben con
  // secuencias de escape a proposito: un byte de control literal dentro del
  // archivo lo vuelve binario para las herramientas del repositorio.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// `null` y `0` son cosas distintas y acá la diferencia importa: un mínimo nulo
// es «sin mínimo» y un mínimo cero es «cero pesos». `Number(null)` vale 0, así
// que la ausencia se mira antes de convertir.
function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function normalizeHours(value) {
  if (!Array.isArray(value)) return [];
  return Object.freeze(value
    .filter((row) => row && typeof row === 'object')
    .map((row) => Object.freeze({
      weekday: Number.isInteger(Number(row.weekday)) ? Number(row.weekday) : null,
      opensAt: text(row.opens_at ?? row.opensAt, 5),
      closesAt: text(row.closes_at ?? row.closesAt, 5),
    }))
    .filter((row) => row.weekday !== null && row.opensAt && row.closesAt)
    .slice(0, 64));
}

function normalizeAreas(value) {
  if (!Array.isArray(value)) return [];
  return Object.freeze(value
    .filter((row) => row && typeof row === 'object')
    .map((row) => Object.freeze({
      name: text(row.name, 80),
      deliveryFee: money(row.delivery_fee ?? row.deliveryFee),
      minimumSubtotal: money(row.minimum_subtotal ?? row.minimumSubtotal),
    }))
    .filter((row) => row.name)
    .slice(0, 200));
}

function normalizeDelivery(value) {
  const source = value && typeof value === 'object' ? value : {};
  const eligible = source.eligible === true;
  return Object.freeze({
    eligible,
    reason: text(source.reason, 40),
    message: text(source.message, 200),
    zoneName: text(source.zone_name ?? source.zoneName, 80),
    // La tarifa sólo existe si el backend dijo que llegamos. Una tarifa colgada
    // de una respuesta negativa sería un número que nadie autorizó.
    deliveryFee: eligible ? money(source.delivery_fee ?? source.deliveryFee) : null,
    minimumSubtotal: eligible ? money(source.minimum_subtotal ?? source.minimumSubtotal) : null,
  });
}

export function setCommerceAvailability(payload) {
  if (!payload || typeof payload !== 'object') {
    current = EMPTY;
    return current;
  }
  current = Object.freeze({
    known: true,
    businessId: text(payload.business_id ?? payload.businessId, 64),
    channel: (payload.channel === 'pickup') ? 'pickup' : 'delivery',
    orderingReady: payload.ordering_ready === true || payload.orderingReady === true,
    // Una respuesta sin `is_open` no autoriza a asumir que está abierto.
    isOpen: (payload.is_open ?? payload.isOpen) === true,
    hoursEnforced: (payload.hours_enforced ?? payload.hoursEnforced) === true,
    coverageEnforced: (payload.coverage_enforced ?? payload.coverageEnforced) === true,
    nextOpenAt: text(payload.next_open_at ?? payload.nextOpenAt, 40) || null,
    hours: normalizeHours(payload.hours),
    areas: normalizeAreas(payload.areas),
    delivery: normalizeDelivery(payload.delivery),
  });
  return current;
}

export function clearCommerceAvailability() {
  current = EMPTY;
  return current;
}

export function getCommerceAvailability() {
  return current;
}

/** La tarifa que dijo el servidor, o `null` si todavía no dijo nada. */
export function serverDeliveryFee(deliveryMode = 'delivery') {
  if (deliveryMode === 'pickup') return 0;
  if (!current.known || !current.delivery.eligible) return null;
  return current.delivery.deliveryFee;
}

/**
 * Si el servidor ya resolvió la cobertura de la dirección activa. Hace falta
 * para leer bien un mínimo nulo: sin esto, «esta zona no tiene mínimo» y
 * «todavía no pregunté» se escriben igual.
 */
export function hasResolvedDelivery() {
  return current.known && current.delivery.eligible;
}

/** El mínimo que dijo el servidor. `null` puede ser «sin mínimo» o «no sé». */
export function serverMinimumSubtotal(deliveryMode = 'delivery') {
  if (deliveryMode === 'pickup') return null;
  if (!current.known || !current.delivery.eligible) return null;
  return current.delivery.minimumSubtotal;
}

function openingHint() {
  if (!current.nextOpenAt) return '';
  const when = new Date(current.nextOpenAt);
  if (Number.isNaN(when.getTime())) return '';
  const sameDay = when.toDateString() === new Date().toDateString();
  // Reloj de 24 horas: es como se lee un horario comercial en Argentina, y
  // además evita el «02:54 a. m.» que sale por defecto en algunos entornos.
  const time = when.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return sameDay ? ` Abrimos a las ${time}.` : ` Abrimos el ${when.toLocaleDateString('es-AR', { weekday: 'long' })} a las ${time}.`;
}

/**
 * El motivo por el que el checkout no puede avanzar, según el servidor, o `null`
 * si no hay ninguno o si el servidor todavía no contestó.
 *
 * El carrito NO se toca: se bloquea el paso siguiente y se explica por qué. Una
 * zona que deja de estar disponible no borra lo que la persona eligió.
 */
export function commerceCheckoutBlock(deliveryMode = 'delivery') {
  if (!current.known) return null;
  if (!current.isOpen) {
    return {
      reason: 'closed',
      message: `${CLOSED_FALLBACK}${openingHint()}`.trim(),
    };
  }
  if (deliveryMode === 'pickup') return null;
  if (!current.delivery.eligible) {
    return {
      reason: current.delivery.reason || 'out_of_coverage',
      message: current.delivery.message || OUT_OF_COVERAGE_FALLBACK,
    };
  }
  return null;
}

export const COMMERCE_OUT_OF_COVERAGE_MESSAGE = OUT_OF_COVERAGE_FALLBACK;
export const COMMERCE_CLOSED_MESSAGE = CLOSED_FALLBACK;
