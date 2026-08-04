// Mercado Pago visto desde el mostrador: un asistente para dejarlo listo y una lista de pagos del día.
// No reimplementa el cobro: lee el estado que ya publica el servidor y lo cuenta en castellano.
// El Access Token nunca llega al panel; acá sólo se ve si el servidor lo tiene cargado y funcionando.

import { humanizeFailure } from './business-operation-language.js';

export const MERCADOPAGO_STEPS = Object.freeze([
  'authorize', 'seller', 'test-credentials', 'notifications', 'test-payment', 'order-and-stock', 'ready',
]);

const STEP_COPY = Object.freeze({
  authorize: {
    title: 'Entrar y autorizar la cuenta',
    why: 'Mercado Pago tiene que saber que este negocio puede cobrar.',
    todo: 'Entrá a tu cuenta de Mercado Pago desde el navegador y autorizá a TABA como aplicación.',
    pendingHint: 'Todavía no llegó la autorización de la cuenta.',
  },
  seller: {
    title: 'Confirmar que es tu cuenta de vendedor',
    why: 'Para que el dinero caiga en la cuenta correcta y no en otra.',
    todo: 'Revisá que el número de vendedor y el de aplicación sean los de tu cuenta.',
    pendingHint: 'Falta identificar la cuenta que va a recibir el dinero.',
  },
  'test-credentials': {
    title: 'Cargar las claves de prueba',
    why: 'Se prueba todo con dinero falso antes de cobrarle a un cliente real.',
    todo: 'Pasale al soporte las claves de prueba de Mercado Pago. Se guardan en el servidor, nunca en esta pantalla.',
    pendingHint: 'El servidor todavía no tiene claves de prueba cargadas.',
  },
  notifications: {
    title: 'Comprobar que llegan los avisos',
    why: 'Sin avisos, un pago aprobado puede no convertirse en pedido.',
    todo: 'Hacé una compra de prueba: si el aviso llega firmado, este paso se marca solo.',
    pendingHint: 'Todavía no llegó ningún aviso firmado de Mercado Pago.',
  },
  'test-payment': {
    title: 'Hacer un pago de prueba',
    why: 'Es la única forma de saber que el circuito completo funciona.',
    todo: 'Desde la web del negocio, comprá algo con una tarjeta de prueba de Mercado Pago.',
    pendingHint: 'Todavía no se registró ningún pago de prueba.',
  },
  'order-and-stock': {
    title: 'Ver que se armó el pedido y bajó el stock',
    why: 'Un pago que no genera pedido deja al cliente esperando y al stock mal contado.',
    todo: 'Cuando el pago de prueba se apruebe, revisá que aparezca el pedido y que el stock haya bajado.',
    pendingHint: 'El pago de prueba todavía no generó un pedido con stock reservado.',
  },
  ready: {
    title: 'Mercado Pago listo',
    why: 'Con esto podés cobrar por la web sin sorpresas.',
    todo: 'No hace falta nada más. Si cambiás de cuenta, repetí el asistente.',
    pendingHint: 'Falta completar alguno de los pasos anteriores.',
  },
});

export const PAYMENT_STATES = Object.freeze([
  'checking', 'approved', 'rejected', 'pending', 'refunded', 'in-review', 'approved-without-order',
]);

const PAYMENT_STATE_COPY = Object.freeze({
  checking: { label: 'Verificando', tone: 'info', detail: 'Estamos confirmando el resultado con Mercado Pago.' },
  approved: { label: 'Aprobado', tone: 'success', detail: 'El dinero está acreditado y el pedido quedó armado.' },
  rejected: { label: 'Rechazado', tone: 'danger', detail: 'Mercado Pago no aceptó el pago. No se cobró nada.' },
  pending: { label: 'Pendiente', tone: 'warning', detail: 'El cliente todavía no terminó de pagar.' },
  refunded: { label: 'Reembolsado', tone: 'info', detail: 'Se le devolvió el dinero al cliente, total o en parte.' },
  'in-review': { label: 'En revisión', tone: 'warning', detail: 'Mercado Pago lo está revisando por seguridad. No entregues todavía.' },
  'approved-without-order': { label: 'Aprobado sin pedido', tone: 'danger', detail: 'Cobraste, pero no hay pedido armado. Resolvelo antes de seguir.' },
});

const CHECKING_STATUSES = new Set(['preference_creating', 'preference_created', 'redirected', 'reconciling']);
const PENDING_STATUSES = new Set(['created', 'pending', 'in_process']);
const REVIEW_STATUSES = new Set(['ambiguous', 'security_review_required']);
const REJECTED_STATUSES = new Set(['rejected', 'cancelled', 'canceled', 'expired', 'failed']);
const REFUND_STATUSES = new Set(['refunded', 'partially_refunded', 'charged_back']);
const APPROVED_STATUSES = new Set(['approved', 'completed']);

export function evaluateMercadoPagoSetup(snapshot = {}) {
  const status = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const outcomes = {
    authorize: Boolean(status.settings_present),
    seller: Boolean(status.collector_configured && status.application_configured),
    'test-credentials': Boolean(status.credentials_loaded) && String(status.environment || '') === 'test',
    notifications: Boolean(status.signed_notice_at),
    'test-payment': Boolean(status.test_payment_at),
    'order-and-stock': Boolean(status.test_payment_order_created && status.test_payment_stock_applied),
  };
  const steps = [];
  let blockedFrom = null;
  for (const id of MERCADOPAGO_STEPS) {
    if (id === 'ready') break;
    const done = outcomes[id] === true;
    const state = done ? 'done' : blockedFrom === null ? 'current' : 'waiting';
    if (!done && blockedFrom === null) blockedFrom = id;
    steps.push(buildStep(id, state, status));
  }
  const allDone = steps.every((step) => step.state === 'done');
  const enabled = Boolean(status.enabled);
  steps.push(buildStep('ready', allDone && enabled ? 'done' : 'waiting', status));

  return Object.freeze({
    steps: Object.freeze(steps),
    ready: allDone && enabled,
    currentStep: blockedFrom || (enabled ? 'ready' : 'ready'),
    environment: environmentLabel(status.environment),
    productionBlocked: String(status.environment || 'test') !== 'production',
    headline: allDone && enabled
      ? 'Mercado Pago está listo para cobrar'
      : allDone
        ? 'Falta activar el cobro con Mercado Pago'
        : 'Mercado Pago todavía no está listo',
    warnings: Object.freeze(buildWarnings(status)),
  });
}

export function classifyBusinessPayment(payment = {}) {
  const internal = String(payment.internal_status || '').toLowerCase();
  const hasOrder = Boolean(payment.order_public_code);
  let state = 'checking';
  if (REFUND_STATUSES.has(internal) || Number(payment.refunded_amount || 0) > 0) state = 'refunded';
  else if (internal === 'approved_order_pending' || (APPROVED_STATUSES.has(internal) && !hasOrder)) state = 'approved-without-order';
  else if (REVIEW_STATUSES.has(internal)) state = 'in-review';
  else if (APPROVED_STATUSES.has(internal)) state = 'approved';
  else if (REJECTED_STATUSES.has(internal)) state = 'rejected';
  else if (PENDING_STATUSES.has(internal)) state = 'pending';
  else if (CHECKING_STATUSES.has(internal)) state = 'checking';

  const copy = PAYMENT_STATE_COPY[state];
  return Object.freeze({
    state,
    label: copy.label,
    tone: copy.tone,
    detail: copy.detail,
    orderLabel: hasOrder ? String(payment.order_public_code) : 'Sin pedido armado',
    blocksDelivery: ['in-review', 'approved-without-order', 'pending', 'checking'].includes(state),
  });
}

// Las acciones se ofrecen sólo si el servidor las permite y el rol alcanza.
export function paymentActionsFor(payment = {}, { elevated = false } = {}) {
  const classification = classifyBusinessPayment(payment);
  const actions = [
    {
      id: 'refresh',
      label: 'Actualizar desde Mercado Pago',
      kind: 'safe',
      available: Boolean(payment.can_reconcile),
      hint: 'Vuelve a preguntar el resultado. No cambia el dinero.',
    },
    {
      id: 'reconcile',
      label: 'Conciliar con el pedido',
      kind: 'elevated',
      available: Boolean(payment.can_reconcile) && ['approved-without-order', 'in-review'].includes(classification.state),
      hint: 'Compara importe y referencia y deja el pedido en su lugar.',
    },
    {
      id: 'diagnostic',
      label: 'Preparar diagnóstico',
      kind: 'safe',
      available: true,
      hint: 'Arma un resumen sin datos personales para pasarle a soporte.',
    },
    {
      id: 'refund',
      label: 'Devolver el dinero',
      kind: 'elevated',
      available: Boolean(payment.can_refund),
      hint: 'Es irreversible. Pide confirmación escrita antes de ejecutarse.',
      requiresConfirmation: true,
    },
  ];
  return Object.freeze(actions
    .filter((action) => action.available && (action.kind !== 'elevated' || elevated))
    .map((action) => Object.freeze({ ...action })));
}

export const REFUND_CONFIRMATION_PHRASE = 'DEVOLVER';

export function validateRefundRequest({ amount, reason, confirmation, maximum } = {}) {
  const trimmedReason = String(reason || '').trim();
  if (trimmedReason.length < 5) {
    return Object.freeze({ ok: false, message: 'Escribí por qué devolvés el dinero. Queda en el historial.' });
  }
  if (String(confirmation || '').trim().toUpperCase() !== REFUND_CONFIRMATION_PHRASE) {
    return Object.freeze({ ok: false, message: `Escribí ${REFUND_CONFIRMATION_PHRASE} para confirmar. Es irreversible.` });
  }
  if (amount === null || amount === undefined || String(amount).trim() === '') {
    return Object.freeze({ ok: true, amount: null, reason: trimmedReason });
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return Object.freeze({ ok: false, message: 'El importe a devolver tiene que ser mayor a cero.' });
  }
  const limit = Number(maximum);
  if (Number.isFinite(limit) && limit > 0 && value > limit) {
    return Object.freeze({ ok: false, message: 'No podés devolver más de lo que se cobró.' });
  }
  return Object.freeze({ ok: true, amount: Math.round(value * 100) / 100, reason: trimmedReason });
}

// Resumen para soporte: sin datos del cliente, sin importes ligados a una persona.
export function buildPaymentDiagnostic(payment = {}) {
  const classification = classifyBusinessPayment(payment);
  return Object.freeze({
    state: classification.state,
    stateLabel: classification.label,
    hasOrder: Boolean(payment.order_public_code),
    currency: String(payment.currency || 'ARS'),
    reference: String(payment.payment_id_short || '').slice(-6),
    providerNote: humanizeFailure(payment.provider_status_detail, ''),
    updatedAt: String(payment.approved_at || payment.created_at || ''),
  });
}

function buildStep(id, state, status) {
  const copy = STEP_COPY[id];
  return Object.freeze({
    id,
    index: MERCADOPAGO_STEPS.indexOf(id) + 1,
    title: copy.title,
    why: copy.why,
    todo: copy.todo,
    state,
    detail: state === 'done' ? doneDetail(id, status) : copy.pendingHint,
  });
}

function doneDetail(id, status) {
  switch (id) {
    case 'authorize': return 'La cuenta autorizó a TABA.';
    case 'seller': return `Vendedor ${maskIdentifier(status.collector_id_short)} · aplicación ${maskIdentifier(status.application_id_short)}.`;
    case 'test-credentials': return 'El servidor tiene cargadas las claves de prueba.';
    case 'notifications': return 'Llegó un aviso firmado y verificado.';
    case 'test-payment': return 'Se registró un pago de prueba.';
    case 'order-and-stock': return 'El pago de prueba armó el pedido y descontó el stock.';
    case 'ready': return 'Podés cobrar por la web.';
    default: return '';
  }
}

function buildWarnings(status) {
  const warnings = [];
  if (Number(status.rejected_notices_recent || 0) > 0) {
    warnings.push('Llegaron avisos que no se pudieron verificar. Si se repite, avisá a soporte.');
  }
  if (status.settings_present && !status.reserve_stock) {
    warnings.push('El stock no se reserva al iniciar el pago. Podés vender algo que ya no tenés.');
  }
  if (String(status.environment || '') === 'production' && String(status.production_review_status || '') !== 'approved') {
    warnings.push('Está apuntando a dinero real sin la revisión aprobada. No cobres hasta resolverlo.');
  }
  if (status.settings_present && !status.storefront_ready) {
    warnings.push('La web del negocio todavía no acepta pedidos, así que nadie puede pagar.');
  }
  return warnings;
}

function environmentLabel(value) {
  return String(value || 'test') === 'production' ? 'Dinero real' : 'Prueba';
}

function maskIdentifier(value) {
  const text = String(value || '').trim();
  return text ? `••••${text.slice(-4)}` : 'sin identificar';
}
