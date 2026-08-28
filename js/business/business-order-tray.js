/*
 * LA BANDEJA DE TRABAJO DEL PANEL — clasificación, urgencia y contacto.
 * ============================================================================
 *
 * Qué resuelve
 * ------------
 * El Panel de producción mostraba UNA lista plana de tarjetas. Medido a 390×844
 * con la bandeja de prueba (seis pedidos): entraba **un** pedido entero en la
 * pantalla, y a 320×568 **ninguno**. Para contestar «¿cuántos me quedan?» —la
 * pregunta que alguien se hace cada dos minutos durante un turno— había que
 * recorrer 2.400px de tarjetas leyendo el estado de cada una.
 *
 * Este módulo contesta las dos preguntas que la lista plana no contestaba:
 *
 *   1. ¿Qué requiere atención AHORA?  → `orderAttentionSignals()`
 *   2. ¿Cómo va el turno?             → `buildOrderTray()`, con recuentos
 *
 * De dónde salen los umbrales
 * ---------------------------
 * NO se inventó ninguno. Los tres umbrales de demora son EXACTAMENTE los que el
 * servidor usa para levantar sus alertas operativas, copiados de
 * `supabase/migrations/20260810140000_scheduler_stalled_needs_history.sql`:
 *
 *   ORDER_NOT_ACCEPTED       created_at < now - 10 min, sin acknowledged_at
 *   ORDER_STALLED            coalesce(acknowledged_at, created_at)
 *                              + (preparation_estimate_minutes ?? 30) + 30 min < now
 *   ORDER_READY_WITHOUT_RIDER  ready, delivery, sin rider,
 *                              coalesce(ready_at, updated_at) < now - 15 min
 *
 * `tests/business-order-tray.test.mjs` LEE esa migración y compara los números
 * contra las constantes de acá: si el servidor cambia un umbral y el Panel no,
 * la prueba corta. Es la única forma de que dos lecturas de la misma regla no
 * se separen con el tiempo.
 *
 * Quién manda
 * -----------
 * La AUTORIDAD sigue siendo el servidor: «Qué pasa» muestra las alertas que
 * calcula la tarea automática cada minuto, y eso no cambia. Lo de acá es una
 * lectura LOCAL de la misma regla, para que la bandeja no tenga que esperar
 * hasta un minuto —ni una llamada de red más por repintado— para marcar en rojo
 * un pedido que ya está demorado. Cuando las dos difieren, difieren por el
 * tiempo que le falta al barrido, nunca por la regla.
 *
 * Este módulo es PURO: recibe pedidos, pagos, ofertas y un reloj, y devuelve
 * datos. No toca el DOM, no consulta el estado global y no pide red. Por eso se
 * puede probar entero sin navegador.
 */

import { normalizeWorkflowStatus } from '../core/order-workflow.js';
import { PAYMENT_RECOVERY_STATES, paymentRecoveryState } from '../payments/payment-recovery.js';

/**
 * Los umbrales del servidor, en minutos. Ver el encabezado: cada uno tiene su
 * cláusula equivalente en la migración y una prueba que las ata.
 */
export const TRAY_DELAY_RULES = Object.freeze({
  /** `ORDER_NOT_ACCEPTED`: entró un pedido y nadie lo aceptó. */
  notAcceptedAfterMinutes: 10,
  /** `ORDER_STALLED`: el margen que se le suma al tiempo prometido. */
  stalledGraceMinutes: 30,
  /** `ORDER_STALLED`: el tiempo prometido cuando el pedido no declara uno. */
  defaultPreparationMinutes: 30,
  /** `ORDER_READY_WITHOUT_RIDER`: listo para despachar y sin nadie que lo lleve. */
  readyWithoutRiderAfterMinutes: 15,
});

const MINUTE_MS = 60_000;

/**
 * Los códigos de atención. Se nombran como el contrato del que salen para que
 * soporte pueda cruzarlos con la alerta del servidor sin una tabla de traducción.
 *
 * El texto es de mostrador, no técnico (Fase D): lo lee alguien que está
 * atendiendo, no alguien que está depurando.
 */
export const TRAY_ATTENTION = Object.freeze({
  ORDER_NOT_ACCEPTED: Object.freeze({
    code: 'ORDER_NOT_ACCEPTED',
    label: 'Pedido sin aceptar',
    detail: 'El cliente está esperando una respuesta.',
    weight: 0,
  }),
  ORDER_STALLED: Object.freeze({
    code: 'ORDER_STALLED',
    label: 'Pedido demorado',
    detail: 'Pasó bastante del tiempo prometido.',
    weight: 1,
  }),
  ORDER_READY_WITHOUT_RIDER: Object.freeze({
    code: 'ORDER_READY_WITHOUT_RIDER',
    label: 'Listo sin repartidor',
    detail: 'Está listo hace rato y nadie lo lleva.',
    weight: 2,
  }),
  RIDER_OFFER_REJECTED: Object.freeze({
    code: 'RIDER_OFFER_REJECTED',
    label: 'Rechazado por el repartidor',
    detail: 'Hay que ofrecérselo a otro.',
    weight: 3,
  }),
  PAYMENT_REFUNDED: Object.freeze({
    code: 'PAYMENT_REFUNDED',
    label: 'Pago devuelto',
    detail: 'El pedido ya no avanza: se devolvió la plata.',
    weight: 4,
  }),
  PAYMENT_REFUND_IN_PROGRESS: Object.freeze({
    code: 'PAYMENT_REFUND_IN_PROGRESS',
    label: 'Devolución en curso',
    detail: 'No lo entregues hasta que la devolución cierre.',
    weight: 5,
  }),
});

/**
 * Las secciones de la bandeja, en el orden en que se atienden.
 *
 * `atencion` va primera y se lleva al pedido de su sección natural: un pedido no
 * aparece dos veces. Es lo contrario a un filtro —un filtro esconde el resto—:
 * acá se reordena, y las demás secciones siguen abajo con su recuento.
 */
export const TRAY_SECTIONS = Object.freeze([
  Object.freeze({ id: 'atencion', title: 'Requieren atención', hint: 'Resolver primero' }),
  Object.freeze({ id: 'nuevos', title: 'Pedidos nuevos', hint: 'Aceptar o cancelar' }),
  Object.freeze({ id: 'preparando', title: 'En preparación', hint: 'Armando el pedido' }),
  Object.freeze({ id: 'listos', title: 'Listos', hint: 'Para retirar o despachar' }),
  Object.freeze({ id: 'entrega', title: 'En entrega', hint: 'Con el repartidor' }),
]);

const SECTION_BY_STATUS = Object.freeze({
  submitted: 'nuevos',
  accepted: 'preparando',
  preparing: 'preparando',
  ready: 'listos',
  assigned: 'entrega',
  picked_up: 'entrega',
  on_the_way: 'entrega',
  arrived: 'entrega',
});

export function trayStatus(order = {}) {
  return normalizeWorkflowStatus(order.workflowStatus || order.status, 'submitted');
}

/** La sección a la que pertenece un pedido por su estado, sin mirar urgencia. */
export function trayFlowSection(order = {}) {
  return SECTION_BY_STATUS[trayStatus(order)] || 'nuevos';
}

function millis(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Minutos transcurridos, o `null` si la marca de tiempo no es utilizable. */
export function elapsedMinutes(value, now = Date.now()) {
  const at = millis(value);
  if (at === null) return null;
  return Math.max(0, Math.floor((now - at) / MINUTE_MS));
}

/**
 * «recién», «hace 9 min», «hace 1 h 40 min».
 *
 * Es lo que reemplaza a la hora absoluta en la cabecera de la tarjeta. «Hora
 * 28/8, 02:26 a. m.» obliga a restar mentalmente; «hace 9 min» es la respuesta
 * que se estaba buscando. La hora exacta no se pierde: vive en el detalle, con
 * la zona del comercio declarada.
 */
export function elapsedLabel(value, now = Date.now()) {
  const minutes = elapsedMinutes(value, now);
  if (minutes === null) return 'sin hora';
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `hace ${hours} h ${rest} min` : `hace ${hours} h`;
}

/** Los pagos que el servidor ató a este pedido. */
export function linkedOrderPayments(order = {}, payments = []) {
  const ids = new Set([order.id, order.backendId, order.code].filter(Boolean).map(String));
  if (!ids.size || !Array.isArray(payments)) return [];
  return payments.filter((payment) => ids.has(String(payment?.order_id || '')));
}

/**
 * ¿La plata de este pedido volvió?
 *
 * Vivía en `production-operations.js`. Se mudó acá sin cambiarle una línea
 * porque ahora la necesitan dos consumidores: las compuertas de avance y
 * cancelación —que ya la usaban— y la bandeja, que tiene que poder DECIR por
 * qué un pedido se quedó sin botón. Antes el Panel le sacaba la acción y no
 * explicaba nada: una tarjeta muda con la que no se podía hacer nada.
 *
 * `production-operations.js` la sigue exportando con el mismo nombre.
 */
export function isProductionOrderPaymentReversed(order, payments = []) {
  const linked = linkedOrderPayments(order, payments);
  if (!linked.length) return false;
  const isFullRefund = (payment) => (
    String(payment?.internal_status || '').toLowerCase() === 'refunded'
    && Number(payment?.refunded_amount || 0) >= Number(payment?.amount || 0)
    && Number(payment?.amount || 0) > 0
  );
  const isReversed = (payment) => (
    isFullRefund(payment)
    || String(payment?.internal_status || '').toLowerCase() === 'charged_back'
  );
  const safelyClosed = new Set(['rejected', 'cancelled', 'canceled', 'expired', 'failed']);
  return linked.some(isReversed) && linked.every((payment) => (
    isReversed(payment)
    || safelyClosed.has(String(payment?.internal_status || '').toLowerCase())
  ));
}

/**
 * Lo que este pedido necesita de una persona, ahora.
 *
 * Devuelve una lista ordenada por gravedad. Vacía = el pedido está en su carril
 * normal y no hay nada que decidir todavía.
 *
 * `offer` es la oferta viva al repartidor, si la hay: llega desde el Panel
 * porque el pedido no la trae adentro.
 */
export function orderAttentionSignals(order = {}, {
  now = Date.now(),
  payments = [],
  offer = null,
} = {}) {
  const status = trayStatus(order);
  const signals = [];

  // 1 · Entró y nadie lo aceptó. Misma cláusula que ORDER_NOT_ACCEPTED.
  if (status === 'submitted' && !order.acknowledgedAt) {
    const waited = elapsedMinutes(order.createdAt, now);
    if (waited !== null && waited >= TRAY_DELAY_RULES.notAcceptedAfterMinutes) {
      signals.push(TRAY_ATTENTION.ORDER_NOT_ACCEPTED);
    }
  }

  // 2 · Aceptado y dejó de avanzar. Misma cláusula que ORDER_STALLED.
  if (status === 'accepted' || status === 'preparing') {
    const since = elapsedMinutes(order.acknowledgedAt || order.createdAt, now);
    const promised = Number.isFinite(Number(order.preparationEstimateMinutes))
      && Number(order.preparationEstimateMinutes) > 0
      ? Number(order.preparationEstimateMinutes)
      : TRAY_DELAY_RULES.defaultPreparationMinutes;
    if (since !== null && since > promised + TRAY_DELAY_RULES.stalledGraceMinutes) {
      signals.push(TRAY_ATTENTION.ORDER_STALLED);
    }
  }

  // 3 · Listo, es delivery, y no hay quién lo lleve. Misma cláusula que
  //     ORDER_READY_WITHOUT_RIDER.
  if (status === 'ready' && order.deliveryMode === 'delivery' && !order.assignedRiderId) {
    const ready = elapsedMinutes(order.readyAt || order.updatedAt, now);
    if (ready !== null && ready >= TRAY_DELAY_RULES.readyWithoutRiderAfterMinutes) {
      signals.push(TRAY_ATTENTION.ORDER_READY_WITHOUT_RIDER);
    }
  }

  // 4 · El repartidor dijo que no. El pedido queda parado hasta que alguien
  //     elija a otro, y hasta ahora eso sólo se veía abriendo la tarjeta.
  if (offer?.status === 'rejected') signals.push(TRAY_ATTENTION.RIDER_OFFER_REJECTED);

  // 5 · La plata. Dos condiciones distintas y las dos cambian lo que se puede
  //     hacer con el pedido, así que las dos se dicen.
  const linked = linkedOrderPayments(order, payments);
  if (linked.length) {
    if (isProductionOrderPaymentReversed(order, payments)) {
      signals.push(TRAY_ATTENTION.PAYMENT_REFUNDED);
    } else if (linked.some((payment) => (
      paymentRecoveryState(payment) === PAYMENT_RECOVERY_STATES.REFUND_PROCESSING
    ))) {
      signals.push(TRAY_ATTENTION.PAYMENT_REFUND_IN_PROGRESS);
    }
  }

  return signals.sort((a, b) => a.weight - b.weight);
}

/**
 * La bandeja completa: secciones con sus pedidos y sus recuentos.
 *
 * El orden DENTRO de cada sección es el que ya traía el coordinador de
 * recepción —estado y después antigüedad, el que espera hace más tiempo
 * primero— y no se recalcula acá: la lista llega ordenada y este módulo sólo la
 * reparte. Reordenarla otra vez sería una segunda autoridad sobre lo mismo.
 */
export function buildOrderTray(orders = [], {
  now = Date.now(),
  payments = [],
  offers = new Map(),
} = {}) {
  const buckets = new Map(TRAY_SECTIONS.map((section) => [section.id, []]));
  const attentionByOrder = new Map();
  const list = Array.isArray(orders) ? orders : [];

  for (const order of list) {
    if (!order) continue;
    const offer = typeof offers?.get === 'function' ? offers.get(orderKey(order)) : null;
    const signals = orderAttentionSignals(order, { now, payments, offer });
    attentionByOrder.set(orderKey(order), signals);
    const target = signals.length ? 'atencion' : trayFlowSection(order);
    buckets.get(target).push(order);
  }

  // La sección de atención se ordena por gravedad de la señal más grave, y a
  // igual gravedad conserva el orden de llegada (el más viejo primero).
  buckets.get('atencion').sort((a, b) => {
    const gravity = (order) => attentionByOrder.get(orderKey(order))?.[0]?.weight ?? 99;
    return gravity(a) - gravity(b);
  });

  const sections = TRAY_SECTIONS
    .map((section) => ({
      ...section,
      orders: buckets.get(section.id),
      count: buckets.get(section.id).length,
    }))
    .filter((section) => section.count > 0);

  return {
    sections,
    attentionByOrder,
    total: list.filter(Boolean).length,
    counts: Object.fromEntries(TRAY_SECTIONS.map((s) => [s.id, buckets.get(s.id).length])),
  };
}

/** La identidad con la que la bandeja indexa un pedido. La misma del coordinador. */
export function orderKey(order = {}) {
  return String(order.backendId || order.id || order.code || '');
}

/**
 * Una línea que dice cómo viene el turno, para anunciarla y para leerla de un
 * vistazo: «2 nuevos · 1 requiere atención · 3 en curso».
 *
 * Existe además por accesibilidad: el `aria-live` estaba en la lista ENTERA de
 * pedidos, así que cada repintado le leía el tablero completo a quien usa lector
 * de pantalla. El anuncio es esta línea; la lista deja de anunciarse.
 */
export function trayHeadline(tray) {
  const partes = [];
  const { counts = {} } = tray || {};
  if (counts.atencion) {
    partes.push(counts.atencion === 1 ? '1 requiere atención' : `${counts.atencion} requieren atención`);
  }
  // «2 nuevos» y no «2 pedidos nuevos»: la línea comparte renglón con el
  // interruptor del timbre y a 390px las tres palabras extra la partían en dos,
  // que son 40px de tablero para no decir nada más.
  if (counts.nuevos) partes.push(counts.nuevos === 1 ? '1 nuevo' : `${counts.nuevos} nuevos`);
  const enCurso = (counts.preparando || 0) + (counts.listos || 0) + (counts.entrega || 0);
  if (enCurso) partes.push(enCurso === 1 ? '1 en curso' : `${enCurso} en curso`);
  return partes.length ? partes.join(' · ') : 'Sin pedidos activos';
}

/**
 * EL TELÉFONO, MARCABLE. Y WHATSAPP.
 * ---------------------------------------------------------------------------
 * En el Panel de producción el teléfono del cliente era TEXTO PLANO. Llamar
 * —lo primero que hace un local cuando falta una aclaración, cuando el timbre no
 * anda o cuando se acabó un producto— significaba leerlo, memorizarlo, salir de
 * la aplicación y tipearlo. El panel de demostración ya tenía los dos enlaces
 * desde hacía tiempo; el que usa el comercio, no.
 *
 * `tel:` va con el número TAL COMO SE GUARDÓ: es lo que marca un teléfono en el
 * país donde está el mostrador, y no hay nada que adivinar.
 *
 * `wa.me` necesita el número internacional completo, y ahí sí hay que
 * componerlo. La regla es la de Argentina —país 54 + el 9 de celular— porque es
 * el único país donde este producto opera: la facturación es ARCA, la moneda es
 * ARS y el domicilio del comercio es Neuquén.
 *
 * Cuando el número no permite armar algo plausible NO se inventa un enlace: se
 * devuelve `whatsapp: ''` y la tarjeta muestra sólo «Llamar». Un enlace de
 * WhatsApp a un número mal compuesto abre la aplicación con un error, que es
 * peor que no ofrecerlo.
 */
export function whatsappDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  // Un 0 de larga distancia adelante no viaja al formato internacional.
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.startsWith('54')) {
    const rest = digits.slice(2);
    // 54 + 10 dígitos es un número argentino sin el 9 de celular: WhatsApp lo
    // necesita. 54 + 9 + 10 ya viene completo.
    digits = rest.startsWith('9') ? digits : `549${rest}`;
  } else {
    digits = `549${digits}`;
  }
  return digits.length >= 12 && digits.length <= 14 ? digits : '';
}

/** Lo que la tarjeta necesita para dibujar la fila de contacto. */
export function orderContactLinks(order = {}) {
  const display = String(order.customerPhone || '').trim();
  if (!display) return { display: '', tel: '', whatsapp: '' };
  const digits = whatsappDigits(display);
  return {
    display,
    tel: `tel:${display.replace(/[^\d+]/g, '')}`,
    whatsapp: digits ? `https://wa.me/${digits}` : '',
  };
}

/**
 * «4 × Cerveza Patagonia +2 más». Una línea para saber qué es el pedido sin
 * abrirlo, que es lo que decide si se acepta.
 */
export function orderItemsSummary(order = {}, { maxNamed = 1 } = {}) {
  const items = Array.isArray(order.items) ? order.items.filter(Boolean) : [];
  if (!items.length) return '';
  const named = items.slice(0, maxNamed)
    .map((item) => `${Number(item.quantity || 0)} × ${String(item.name || 'Producto')}`)
    .join(' · ');
  const rest = items.length - maxNamed;
  return rest > 0 ? `${named} +${rest} más` : named;
}

/** Cuántas unidades lleva el pedido en total. */
export function orderItemCount(order = {}) {
  return (Array.isArray(order.items) ? order.items : [])
    .reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
}
