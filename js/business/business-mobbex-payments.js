// Panel › Mobbex: los cobros que entraron por Mobbex, sus devoluciones y lo que hay que mirar.
// ---------------------------------------------------------------------------
// Mobbex es OTRO medio de pago, con su propia cuenta y su propio libro de movimientos. Esta pantalla no reutiliza la de
// Mercado Pago: las operaciones, los estados y las devoluciones son distintos y no se mezclan.
//
// Qué hace y qué NO hace:
//   * lee la lista que publica el servidor (`mobbex_list_business_payments`). No calcula importes ni decide estados.
//   * «Consultar a Mobbex» pide una relectura. No cambia ningún estado: lo que Mobbex confirme lo asienta el servidor.
//   * «Devolver el dinero» pide una devolución total o parcial. Es irreversible: pide motivo, importe visible y escribir
//     DEVOLVER. La clave de idempotencia se conserva mientras la devolución no tenga respuesta definitiva, así que
//     reintentar después de una respuesta perdida NO crea una segunda devolución.
//   * una devolución dudosa NUNCA se ofrece de nuevo ni se da por hecha: se muestra «verificando» hasta que Mobbex confirme.
//
// Los botones sólo se ofrecen si el servidor levantó la bandera (`can_*`); cada acción vuelve a exigir el permiso acá y el
// servidor lo exige otra vez. El markup se puede falsificar; la base no.
import { escapeHtml } from '../ui.js';
import { can } from './business-capabilities.js';
import { humanizeFailure } from './business-operation-language.js';

export const MOBBEX_REFUND_PHRASE = 'DEVOLVER';
// Lo que exige la Edge `mobbex-refund`; la persona confirma con la palabra de arriba.
export const MOBBEX_REFUND_SERVER_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MOBBEX_REFUND';

export const MOBBEX_PAYMENT_STATES = Object.freeze([
  'checking', 'building-order', 'approved', 'rejected', 'closed', 'refunded', 'partially-refunded', 'in-review', 'approved-without-order', 'money-unresolved',
]);

const STATE_COPY = Object.freeze({
  checking: { label: 'Verificando', tone: 'info', detail: 'Estamos confirmando el resultado con Mobbex. No entregues hasta que figure aprobado.' },
  'building-order': { label: 'Armando el pedido', tone: 'info', detail: 'Mobbex confirmó el cobro y estamos armando el pedido. Si en unos minutos no aparece, te avisamos acá.' },
  approved: { label: 'Aprobado', tone: 'success', detail: 'Mobbex confirmó el cobro y el pedido quedó armado.' },
  rejected: { label: 'Rechazado', tone: 'danger', detail: 'Mobbex no aceptó el pago. No se cobró nada.' },
  closed: { label: 'Cerrado sin cobro', tone: 'neutral', detail: 'El pago venció o se canceló. No se cobró nada y el stock volvió.' },
  refunded: { label: 'Devuelto', tone: 'info', detail: 'Se le devolvió todo el dinero al cliente.' },
  'partially-refunded': { label: 'Devuelto en parte', tone: 'info', detail: 'Se devolvió una parte. Queda un saldo que se puede devolver.' },
  'in-review': { label: 'En revisión', tone: 'warning', detail: 'Hay algo que no coincide. No entregues todavía.' },
  'approved-without-order': { label: 'Cobrado sin pedido', tone: 'danger', detail: 'Cobraste, pero no hay pedido armado. Resolvelo antes de seguir.' },
  'money-unresolved': { label: 'Dinero sin resolver', tone: 'danger', detail: 'Hay una devolución que Mobbex todavía no confirmó o un dato que no coincide. No armes ni entregues hasta resolverlo.' },
});

const REASON_COPY = Object.freeze({
  amount_mismatch: 'El importe que informó Mobbex no coincide con el del pedido.',
  currency_mismatch: 'La moneda que informó Mobbex no coincide con la del pedido.',
  reference_mismatch: 'La referencia que informó Mobbex no coincide con este pedido.',
  entity_mismatch: 'El pago pertenece a otra cuenta de Mobbex.',
  payment_id_missing: 'Mobbex no informó el número de operación.',
  payment_bound_to_other_checkout: 'Esa operación de Mobbex ya está asociada a otra compra.',
  unknown_status_class: 'Mobbex informó un estado que no reconocemos.',
  test_operation_in_production: 'Llegó una operación de prueba a una cuenta de dinero real. No se armó ningún pedido.',
  approved_after_reservation_expired: 'Cobraste después de que venciera la reserva del stock. Podés armar el pedido si hay stock, o devolver el dinero.',
  finalization_without_active_reservation: 'Cobraste y la reserva del stock ya no estaba. Podés armar el pedido si hay stock, o devolver el dinero.',
  partial_refund_without_seen_approval: 'Mobbex informó una devolución parcial sobre un cobro que no vimos aprobarse.',
  partial_refund_amount_unknown: 'Mobbex informó una devolución parcial sin decir cuánto. Confirmá el importe en el panel de Mobbex.',
  duplicate_approved_payment: 'Hay dos cobros aprobados para la misma compra. Hay que devolver uno desde el panel de Mobbex.',
  multiple_approved_operations: 'Mobbex informó más de un cobro aprobado para esta compra. Hay que devolver el repetido desde el panel de Mobbex.',
  refund_in_progress: 'Hay una devolución en curso.',
});

const REFUND_STATUS_COPY = Object.freeze({
  requested: ['Pedida', 'warning'],
  processing: ['Enviada, verificando', 'warning'],
  ambiguous: ['Sin confirmar', 'danger'],
  approved: ['Devuelta', 'success'],
  rejected: ['Rechazada', 'danger'],
  failed: ['No salió', 'neutral'],
});

const PROCESSING_COPY = Object.freeze({
  checking: 'El sistema está consultando a Mobbex.',
  delayed: 'La consulta automática viene demorada. Podés pedirla de nuevo.',
  stuck: 'La consulta automática se trabó. Pedila de nuevo y, si sigue igual, avisá a soporte.',
});

const REFUND_CODE_COPY = Object.freeze({
  EXPLICIT_REFUND_CONFIRMATION_REQUIRED: 'Falta la confirmación explícita de la devolución.',
  REFUND_ENVIRONMENT_MISMATCH: 'Este cobro es de otro entorno de Mobbex: no se envió nada.',
  PAYMENTS_NOT_ENABLED: 'Mobbex no está habilitado en este entorno: no se envió nada.',
  REFUND_NOT_AVAILABLE: 'Este cobro ya no se puede devolver en su estado actual. Actualizá la lista.',
  REFUND_REJECTED: 'Mobbex rechazó la devolución. No se movió dinero.',
  REFUND_RECONCILING: 'Estamos verificando la devolución con Mobbex. No la repitas: el estado se actualiza solo.',
  REFUND_NOT_SENT: 'No pudimos registrar la devolución, así que no se envió nada a Mobbex. Probá de nuevo en unos minutos.',
  INVALID_AMOUNT: 'El importe a devolver no es válido.',
});

// Respuestas tras las cuales la misma clave ya no sirve: el pedido quedó cerrado, hace falta uno nuevo para reintentar.
const DEFINITIVE_REFUND_CODES = new Set(['REFUND_REJECTED', 'REFUND_NOT_AVAILABLE', 'REFUND_ENVIRONMENT_MISMATCH', 'PAYMENTS_NOT_ENABLED', 'INVALID_AMOUNT', 'EXPLICIT_REFUND_CONFIRMATION_REQUIRED']);

function approvedRecently(payment, now = Date.now()) {
  const at = Date.parse(payment.approved_at || '');
  return Number.isFinite(at) && now - at < 10 * 60 * 1000 && now - at > -60 * 1000;
}

/** Cómo se lee un cobro en el mostrador. El servidor manda el estado; acá sólo se lo cuenta. */
export function classifyMobbexPayment(payment = {}) {
  const internal = String(payment.internal_status || '').toLowerCase();
  const hasOrder = Boolean(payment.order_public_code);
  const refundDoubtful = ['processing', 'ambiguous'].includes(String(payment.latest_refund_status || '')) || payment.refund_in_flight === true;
  let state = 'checking';
  const attentionOpen = payment.attention_reason && payment.attention_reason !== 'refund_in_progress' && payment.attention_acknowledged !== true;
  if (refundDoubtful || attentionOpen) state = 'money-unresolved';
  else if (internal === 'refunded') state = 'refunded';
  else if (internal === 'partially_refunded' || (Number(payment.refunded_amount || 0) > 0 && internal === 'completed')) state = 'partially-refunded';
  else if (internal === 'approved_order_pending' && approvedRecently(payment)) state = 'building-order';
  else if (internal === 'approved_order_pending' || (internal === 'completed' && !hasOrder)
    || (internal === 'security_review_required' && !hasOrder && Number(payment.paid_amount || 0) > 0)) state = 'approved-without-order';
  else if (internal === 'security_review_required' || internal === 'ambiguous') state = 'in-review';
  else if (internal === 'completed') state = 'approved';
  else if (internal === 'rejected' || internal === 'failed') state = 'rejected';
  else if (internal === 'expired' || internal === 'cancelled') state = 'closed';
  const copy = STATE_COPY[state];
  const reason = payment.review_reason || payment.attention_reason || '';
  return Object.freeze({
    state,
    label: copy.label,
    tone: copy.tone,
    detail: copy.detail,
    reasonText: reason ? (REASON_COPY[reason] || 'Hay un dato que no coincide. Pedí una consulta o avisá a soporte.') : '',
    acknowledged: payment.attention_acknowledged === true,
    orderLabel: hasOrder ? String(payment.order_public_code) : 'Sin pedido armado',
    environmentLabel: String(payment.environment || '') === 'production' ? 'Dinero real' : 'Prueba',
    isTest: String(payment.environment || 'test') !== 'production',
    blocksDelivery: ['checking', 'building-order', 'in-review', 'approved-without-order', 'money-unresolved'].includes(state),
  });
}

/** Qué se ofrece. Sólo lo que el servidor habilitó y sólo a dueño o encargado. */
export function mobbexActionsFor(payment = {}, { elevated = false } = {}) {
  const actions = [
    { id: 'reconcile', label: 'Consultar a Mobbex', available: Boolean(payment.can_reconcile),
      hint: 'Le pregunta a Mobbex cómo quedó este cobro. No cambia nada por sí sola.' },
    { id: 'recover-order', label: 'Armar el pedido de este cobro', available: Boolean(payment.can_recover_order),
      hint: 'Vuelve a tomar el stock y arma el pedido. Si ya no hay stock, te avisa qué falta.' },
    { id: 'acknowledge', label: 'Ya lo resolví (reconocer)', available: Boolean(payment.can_acknowledge), requiresConfirmation: true,
      hint: 'Apaga la alarma por 14 días con un motivo escrito. No cambia el cobro ni mueve dinero.' },
    { id: 'refund', label: 'Devolver el dinero', available: Boolean(payment.can_refund), requiresConfirmation: true,
      hint: 'Es irreversible. Pide motivo y confirmación escrita antes de enviarse.' },
  ];
  return Object.freeze(actions.filter((action) => action.available && elevated).map((action) => Object.freeze({ ...action })));
}

/** Valida el formulario de devolución antes de mandarlo. El servidor valida lo mismo, y más. */
export function validateMobbexRefund({ amount, reason, confirmation, refundable } = {}) {
  const trimmedReason = String(reason || '').trim();
  if (trimmedReason.length < 5) return Object.freeze({ ok: false, message: 'Escribí por qué devolvés el dinero. Queda en el historial.' });
  if (String(confirmation || '').trim().toUpperCase() !== MOBBEX_REFUND_PHRASE) {
    return Object.freeze({ ok: false, message: `Escribí ${MOBBEX_REFUND_PHRASE} para confirmar. Es irreversible.` });
  }
  const limit = Math.round(Number(refundable) * 100) / 100;
  if (!Number.isFinite(limit) || limit <= 0) return Object.freeze({ ok: false, message: 'Este cobro no tiene saldo para devolver.' });
  // Importe vacío = todo lo que falta devolver. Se manda SIEMPRE explícito: el servidor decide si es un total o un parcial.
  const blank = amount === null || amount === undefined || String(amount).trim() === '';
  if (blank) return Object.freeze({ ok: true, amount: limit, full: true, reason: trimmedReason });
  const text = String(amount).trim().replace(',', '.');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return Object.freeze({ ok: false, message: 'Escribí el importe con hasta dos decimales, por ejemplo 1500 o 1500,50.' });
  const value = Number(text);
  if (!(value > 0)) return Object.freeze({ ok: false, message: 'El importe a devolver tiene que ser mayor a cero.' });
  if (value > limit) return Object.freeze({ ok: false, message: 'No podés devolver más de lo que falta devolver.' });
  return Object.freeze({ ok: true, amount: Math.round(value * 100) / 100, full: value === limit, reason: trimmedReason });
}

/** Cuántos cobros piden atención: lo que el comercio mira primero. */
export function summarizeMobbexPayments(payments = []) {
  const rows = Array.isArray(payments) ? payments : [];
  const summary = { total: rows.length, attention: 0, awaiting: 0, refundsOpen: 0, approvedToday: 0 };
  for (const payment of rows) {
    const { state } = classifyMobbexPayment(payment);
    if (['in-review', 'approved-without-order', 'money-unresolved'].includes(state) || payment.processing_state === 'stuck') summary.attention += 1;
    if (state === 'checking') summary.awaiting += 1;
    if (payment.refund_in_flight) summary.refundsOpen += 1;
  }
  return Object.freeze(summary);
}

// ── Estado ───────────────────────────────────────────────────────────────────
let payments = [];
let status = { phase: 'idle', message: '' };
let loadStarted = false;
let loadedAt = 0;
let lastGoodAt = 0;
let generation = 0;
let busy = false;
let refundTarget = '';
let ackTarget = '';
let refundOperation = null;
let expanded = '';
let feedback = '';
let hasMore = false;
let attentionTotal = 0;
const PAGE = 50;
const MAX_RELOAD = 200;

export function resetMobbexPayments() {
  generation += 1;
  payments = [];
  status = { phase: 'idle', message: '' };
  loadStarted = false;
  busy = false;
  refundTarget = '';
  ackTarget = '';
  refundOperation = null;
  expanded = '';
  feedback = '';
  hasMore = false;
  attentionTotal = 0;
  loadedAt = 0;
  lastGoodAt = 0;
}

export function activateMobbexPayments(context) {
  // Reabrir la pantalla después de un minuto vuelve a leer: una lista vieja puede mostrar «Verificando» de algo ya resuelto.
  if (loadStarted && Date.now() - loadedAt < 60_000) return null;
  loadStarted = true;
  loadedAt = Date.now();
  return refreshMobbexPayments(context);
}

// Recarga conservando lo ya mostrado (hasta MAX_RELOAD filas): una acción no devuelve a la persona a la primera página.
// Los cobros que piden atención vienen PRIMERO desde el servidor, así que nunca quedan detrás de «Cargar más».
export async function refreshMobbexPayments(context, message = '', { more = false } = {}) {
  const current = generation;
  status = { phase: 'loading', message };
  context?.onChange?.();
  const page = more
    ? { offset: payments.length, limit: PAGE }
    : { offset: 0, limit: Math.min(Math.max(payments.length, PAGE), MAX_RELOAD) };
  const response = await (context?.listMobbexPayments?.(page) ?? { ok: false });
  if (current !== generation) return { ok: false, staleContext: true };
  if (response?.ok) {
    const rows = Array.isArray(response.data) ? response.data : [];
    payments = more ? [...payments, ...rows.filter((row) => !payments.some((known) => known.payment_intent_id === row.payment_intent_id))] : rows;
    hasMore = rows.length >= page.limit;
    attentionTotal = Number(rows[0]?.attention_total ?? (more ? attentionTotal : 0)) || 0;
    status = { phase: 'ready', message };
    lastGoodAt = Date.now();
  } else {
    status = { phase: 'error', message: humanizeFailure(response?.message, 'No pudimos leer los cobros de Mobbex.') };
  }
  context?.onChange?.();
  return { ok: Boolean(response?.ok) };
}

function done(ok, message) { feedback = message; return { handled: true, ok, message }; }

function findPayment(id) {
  return payments.find((candidate) => String(candidate.payment_intent_id) === String(id));
}

function guardElevated(context, capability) {
  if (can(context?.role, capability)) return null;
  return done(false, 'Esta acción la confirma el dueño o el encargado.');
}

export async function handleMobbexAction(target, context) {
  if (!target?.closest) return null;
  if (target.closest('[data-mobbex-refresh]')) {
    const response = await refreshMobbexPayments(context);
    return done(Boolean(response.ok), response.ok ? 'Cobros de Mobbex actualizados.' : status.message);
  }
  if (target.closest('[data-mobbex-more]')) {
    if (busy || status.phase === 'loading') return done(false, 'Ya hay algo en curso.');
    const response = await refreshMobbexPayments(context, '', { more: true });
    return done(Boolean(response.ok), response.ok ? '' : status.message);
  }
  const toggle = target.closest('[data-mobbex-toggle]');
  if (toggle) {
    const id = toggle.dataset.mobbexToggle;
    expanded = expanded === id ? '' : id;
    context?.onChange?.();
    return { handled: true, ok: true, message: '' };
  }
  const reconcile = target.closest('[data-mobbex-reconcile]');
  if (reconcile) {
    const denied = guardElevated(context, 'payments.reconcile');
    if (denied) return denied;
    if (busy) return done(false, 'Ya hay algo en curso.');
    const id = reconcile.dataset.mobbexReconcile;
    if (!findPayment(id)?.can_reconcile) return done(false, 'Este cobro no admite una consulta ahora. Actualizá la lista.');
    busy = true;
    const response = await context.requestMobbexReconcile(id);
    busy = false;
    const message = response?.ok
      ? humanizeFailure(response.message, 'Consulta pedida. En unos minutos el estado se actualiza solo.')
      : humanizeFailure(response?.message, 'No pudimos pedir la consulta a Mobbex.');
    await refreshMobbexPayments(context);
    return done(Boolean(response?.ok), message);
  }
  const recover = target.closest('[data-mobbex-recover]');
  if (recover) {
    const denied = guardElevated(context, 'payments.reconcile');
    if (denied) return denied;
    if (busy) return done(false, 'Ya hay algo en curso.');
    const id = recover.dataset.mobbexRecover;
    if (!findPayment(id)?.can_recover_order) return done(false, 'Este cobro no se puede rearmar como pedido. Actualizá la lista.');
    busy = true;
    const response = await context.recoverMobbexPaidOrder(id);
    busy = false;
    const message = response?.ok
      ? humanizeFailure(response.message, 'Listo: el pedido de este cobro quedó armado.')
      : humanizeFailure(response?.message, 'No pudimos armar el pedido de este cobro.');
    await refreshMobbexPayments(context);
    return done(Boolean(response?.ok), message);
  }
  const ackOpen = target.closest('[data-mobbex-ack-open]');
  if (ackOpen) {
    const denied = guardElevated(context, 'payments.reconcile');
    if (denied) return denied;
    const id = ackOpen.dataset.mobbexAckOpen;
    if (!findPayment(id)?.can_acknowledge) return done(false, 'Este cobro no admite reconocer la incidencia ahora. Actualizá la lista.');
    ackTarget = id;
    expanded = id;
    feedback = '';
    context?.onChange?.();
    return { handled: true, ok: true, message: '' };
  }
  if (target.closest('[data-mobbex-ack-cancel]')) {
    ackTarget = '';
    context?.onChange?.();
    return done(true, 'No se reconoció nada: la alarma sigue.');
  }
  const ackConfirm = target.closest('[data-mobbex-ack-confirm]');
  if (ackConfirm) {
    const denied = guardElevated(context, 'payments.reconcile');
    if (denied) return denied;
    const id = String(ackConfirm.dataset.mobbexAckConfirm || '');
    if (!findPayment(id)?.can_acknowledge) return done(false, 'Este cobro no admite reconocer la incidencia ahora. Actualizá la lista.');
    const note = String(ackConfirm.closest('[data-mobbex-ack-form]')?.querySelector('[name="mobbexAckNote"]')?.value || '').trim();
    if (note.length < 10) return done(false, 'Escribí qué verificaste y qué se resolvió (al menos 10 caracteres). Queda en el historial.');
    if (busy) return done(false, 'Ya hay algo en curso.');
    busy = true;
    context?.onChange?.();
    const response = await context.acknowledgeMobbexAttention(id, note);
    busy = false;
    const message = response?.ok
      ? 'Incidencia reconocida por 14 días. Si no se resuelve, vuelve a avisar sola.'
      : humanizeFailure(response?.message, 'No se pudo reconocer la incidencia.');
    if (response?.ok) ackTarget = '';
    await refreshMobbexPayments(context);
    return done(Boolean(response?.ok), message);
  }
  const refundOpen = target.closest('[data-mobbex-refund-open]');
  if (refundOpen) {
    const denied = guardElevated(context, 'payments.refund');
    if (denied) return denied;
    const id = refundOpen.dataset.mobbexRefundOpen;
    if (!findPayment(id)?.can_refund) return done(false, 'Este cobro no se puede devolver ahora. Actualizá la lista.');
    refundTarget = id;
    expanded = id;
    feedback = '';
    context?.onChange?.();
    return { handled: true, ok: true, message: '' };
  }
  if (target.closest('[data-mobbex-refund-cancel]')) {
    refundTarget = '';
    refundOperation = null;
    context?.onChange?.();
    return done(true, 'Devolución cancelada. No se movió dinero.');
  }
  const refundConfirm = target.closest('[data-mobbex-refund-confirm]');
  if (refundConfirm) return confirmRefund(refundConfirm, context);
  return null;
}

async function confirmRefund(button, context) {
  const denied = guardElevated(context, 'payments.refund');
  if (denied) return denied;
  const id = String(button.dataset.mobbexRefundConfirm || '');
  const payment = findPayment(id);
  // El servidor decide si se puede; acá se vuelve a mirar la bandera de la lista que se está viendo.
  if (!payment?.can_refund) return done(false, 'Este cobro no se puede devolver ahora. Actualizá la lista.');
  const form = button.closest('[data-mobbex-refund-form]');
  const validation = validateMobbexRefund({
    amount: form?.querySelector('[name="mobbexRefundAmount"]')?.value,
    reason: form?.querySelector('[name="mobbexRefundReason"]')?.value,
    confirmation: form?.querySelector('[name="mobbexRefundConfirmation"]')?.value,
    refundable: Number(payment.refundable_amount),
  });
  if (!validation.ok) return done(false, validation.message);
  if (busy) return done(false, 'Ya hay algo en curso.');
  // Misma clave mientras no haya respuesta definitiva para el mismo cobro e importe: es lo que impide la segunda devolución.
  if (refundOperation?.intent !== id || refundOperation.amount !== validation.amount) {
    refundOperation = { intent: id, amount: validation.amount, key: globalThis.crypto?.randomUUID?.() || '' };
  }
  if (!refundOperation.key) return done(false, 'No pudimos generar una solicitud de devolución segura.');
  busy = true;
  context?.onChange?.();
  const response = await context.requestMobbexRefund({
    paymentIntentId: id,
    amount: validation.amount,
    reason: validation.reason,
    confirmation: MOBBEX_REFUND_SERVER_CONFIRMATION,
    idempotencyKey: refundOperation.key,
  });
  busy = false;
  const code = String(response?.code || '');
  let message;
  if (response?.ok) {
    message = 'Devolución enviada. Cuando Mobbex la confirme, se ve acá.';
    refundTarget = '';
    refundOperation = null;
  } else if (code === 'REFUND_RECONCILING') {
    // Salió o pudo haber salido: la misma clave queda guardada y el formulario se cierra para que nadie la repita.
    message = REFUND_CODE_COPY.REFUND_RECONCILING;
    refundTarget = '';
  } else {
    message = REFUND_CODE_COPY[code] || humanizeFailure(response?.message, 'No se pudo pedir la devolución. Si dudás de si salió, mirá la lista antes de reintentar.');
    if (DEFINITIVE_REFUND_CODES.has(code)) refundOperation = null;
  }
  await refreshMobbexPayments(context);
  return done(Boolean(response?.ok), message);
}

// ── Pantalla ─────────────────────────────────────────────────────────────────
export function renderMobbexSurface({ role = '', state = status, list = payments, working = busy, target = refundTarget, open = expanded, notice = feedback, more = hasMore, attention = attentionTotal } = {}) {
  if (!can(role, 'payments.view')) {
    return panelShell('<p class="form-hint">Tu rol no incluye la consulta de pagos.</p>');
  }
  const elevated = can(role, 'payments.refund');
  const summary = summarizeMobbexPayments(list);
  const cards = list.length
    ? list.map((payment) => renderCard(payment, { elevated, working, target, open, notice })).join('')
    : `<p class="form-hint">${state.phase === 'loading' ? 'Leyendo los cobros…' : state.phase === 'error' ? '' : 'Todavía no hay cobros por Mobbex.'}</p>`;
  const needReview = Math.max(summary.attention, attention);
  const summaryLine = summary.total
    ? `<p class="form-hint" data-mobbex-summary>${needReview ? `<strong>${needReview} para revisar</strong> (van primero). ` : ''}${summary.awaiting ? `${summary.awaiting} verificándose. ` : ''}${summary.refundsOpen ? `${summary.refundsOpen} devolución(es) sin confirmar. ` : ''}Se muestran ${summary.total} cobro(s)${more ? '; hay más' : ''}.</p>`
    : '';
  return panelShell(`
    ${state.phase === 'error' ? `<p class="production-intake-error" role="alert">${escapeHtml(state.message)}${list.length && lastGoodAt ? ` Lo que ves es de las ${escapeHtml(formatClock(lastGoodAt))}: puede estar desactualizado.` : ''}</p>` : ''}
    ${state.phase === 'ready' && lastGoodAt ? `<p class="form-hint" data-mobbex-updated>Actualizado a las ${escapeHtml(formatClock(lastGoodAt))}.</p>` : ''}
    <div role="status" aria-live="polite" data-mobbex-live>${notice ? `<p class="business-ops-feedback" data-mobbex-feedback>${escapeHtml(notice)}</p>` : ''}</div>
    ${summaryLine}
    <div class="production-payment-list" data-mobbex-list aria-busy="${state.phase === 'loading' ? 'true' : 'false'}">${cards}</div>
    <div class="button-row"><button class="secondary-button compact" type="button" data-mobbex-refresh ${state.phase === 'loading' || working ? 'disabled' : ''}>Actualizar</button>
      ${more ? `<button class="ghost-button compact" type="button" data-mobbex-more ${state.phase === 'loading' || working ? 'disabled' : ''}>Cargar más cobros</button>` : ''}</div>
    <p class="form-hint">Mercado Pago tiene su propia pantalla («Pagos»): las operaciones de un medio no aparecen en el otro.</p>`);
}

function panelShell(body) {
  return `<section class="business-ops-panel business-mobbex" data-mobbex-payments>
    <header><div><p class="eyebrow">Panel del negocio</p><h2>Cobros Mobbex</h2>
      <p>Lo que cobraste con Mobbex, sus devoluciones y lo que hay que mirar. El pedido sólo se entrega con el cobro aprobado.</p></div></header>
    ${body}
  </section>`;
}

function renderCard(payment, { elevated, working, target, open, notice = '' }) {
  const id = String(payment.payment_intent_id || '');
  const classified = classifyMobbexPayment(payment);
  const actions = mobbexActionsFor(payment, { elevated });
  const expandedNow = open === id || target === id;
  const buttons = actions.map((action) => {
    if (action.id === 'acknowledge') {
      return `<button class="ghost-button compact" type="button" data-mobbex-ack-open="${escapeHtml(id)}" ${working ? 'disabled' : ''} aria-label="${escapeHtml(`${action.label}: ${classified.orderLabel}`)}" aria-describedby="mbx-hint-${escapeHtml(id)}" title="${escapeHtml(action.hint)}">${escapeHtml(action.label)}</button>`;
    }
    if (action.id === 'refund') {
      return `<button class="secondary-button compact" type="button" data-mobbex-refund-open="${escapeHtml(id)}" ${working ? 'disabled' : ''} aria-label="${escapeHtml(`${action.label}: ${classified.orderLabel}`)}" aria-describedby="mbx-hint-${escapeHtml(id)}" title="${escapeHtml(action.hint)}">${escapeHtml(action.label)}</button>`;
    }
    const attr = action.id === 'reconcile' ? 'data-mobbex-reconcile' : 'data-mobbex-recover';
    return `<button class="ghost-button compact" type="button" ${attr}="${escapeHtml(id)}" ${working ? 'disabled' : ''} aria-label="${escapeHtml(`${action.label}: ${classified.orderLabel}`)}" aria-describedby="mbx-hint-${escapeHtml(id)}" title="${escapeHtml(action.hint)}">${escapeHtml(action.label)}</button>`;
  }).join('');
  const processing = PROCESSING_COPY[payment.processing_state] || '';
  const refunded = Number(payment.refunded_amount || 0);
  const form = target === id && payment.can_refund ? renderRefundForm(id, payment, working) : '';
  const ackForm = ackTarget === id && payment.can_acknowledge ? renderAckForm(id, working) : '';
  return `<article class="production-payment-card tone-${escapeHtml(classified.tone)}" data-mobbex-card="${escapeHtml(id)}" data-mobbex-state="${escapeHtml(classified.state)}">
    <header>
      <div><strong>${escapeHtml(classified.orderLabel)}</strong>
        <span class="status-pill ${escapeHtml(classified.tone)}">${escapeHtml(classified.label)}</span>
        <span class="status-pill ${classified.isTest ? 'warning' : 'neutral'}" data-mobbex-environment>${escapeHtml(classified.environmentLabel)}</span></div>
      <span class="status-pill ${escapeHtml(classified.tone)}" ${payment.paid_amount === null || payment.paid_amount === undefined ? 'data-mobbex-unpaid title="Todavía no se cobró: es el importe a cobrar"' : ''}>${escapeHtml(formatMoney(payment.amount, payment.currency))}${payment.paid_amount === null || payment.paid_amount === undefined ? ' a cobrar' : ''}</span>
    </header>
    <p>${escapeHtml(classified.detail)}</p>
    ${classified.reasonText ? `<p class="production-intake-error" data-mobbex-reason>${escapeHtml(classified.reasonText)}</p>` : ''}
    ${classified.isTest ? '<p class="form-hint" data-mobbex-test-note>Cobro de prueba: no es dinero real.</p>' : ''}
    ${processing ? `<p class="form-hint" data-mobbex-processing>${escapeHtml(processing)}</p>` : ''}
    <dl class="access-request-facts">
      <div><dt>${payment.approved_at ? 'Cobrado el' : 'Iniciado el'}</dt><dd>${escapeHtml(formatTimestamp(payment.approved_at || payment.created_at))}</dd></div>
      <div><dt>Devuelto</dt><dd>${escapeHtml(refunded > 0 ? formatMoney(refunded, payment.currency) : 'Nada')}</dd></div>
      <div><dt>Falta devolver</dt><dd>${escapeHtml(Number(payment.refundable_amount || 0) > 0 && ['completed', 'partially_refunded'].includes(payment.internal_status) ? formatMoney(payment.refundable_amount, payment.currency) : '—')}</dd></div>
      <div><dt>Referencia</dt><dd>••••${escapeHtml(String(payment.reference_short || ''))}</dd></div>
    </dl>
    ${buttons ? `<div class="button-row">${buttons}</div><p class="form-hint" id="mbx-hint-${escapeHtml(id)}" data-mobbex-hints>${escapeHtml(actions.map((action) => `${action.label}: ${action.hint}`).join(' '))}</p>` : ''}
    ${form}
    ${ackForm}
    ${(form || ackForm) && notice ? `<p class="business-ops-feedback" role="alert" data-mobbex-card-feedback>${escapeHtml(notice)}</p>` : ''}
    ${classified.acknowledged ? '<p class="form-hint" data-mobbex-acknowledged>Incidencia reconocida por una persona. Si sigue sin resolverse, vuelve a avisar a los 14 días.</p>' : ''}
    <button class="text-button" type="button" data-mobbex-toggle="${escapeHtml(id)}" aria-expanded="${expandedNow ? 'true' : 'false'}">${expandedNow ? 'Ocultar historial' : 'Ver historial'}</button>
    ${expandedNow ? renderHistory(payment) : ''}
  </article>`;
}

function renderAckForm(id, working) {
  return `<div class="business-ops-form" data-mobbex-ack-form="${escapeHtml(id)}">
    <p><strong>Reconocer la incidencia.</strong> Usalo cuando ya verificaste este cobro en el panel de Mobbex (por ejemplo, devolviste un cobro repetido desde ahí). Apaga la alarma por 14 días; no cambia el cobro ni mueve dinero, y el pedido no se entrega por esto.</p>
    <label>Qué verificaste y qué se resolvió<input type="text" name="mobbexAckNote" maxlength="300" autocomplete="off"></label>
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-mobbex-ack-confirm="${escapeHtml(id)}" ${working ? 'disabled' : ''}>Reconocer</button>
      <button class="ghost-button compact" type="button" data-mobbex-ack-cancel>Mejor no</button>
    </div>
  </div>`;
}

function renderRefundForm(id, payment, working) {
  const refundable = Number(payment.refundable_amount || 0);
  return `<div class="business-ops-form payment-refund-form" data-mobbex-refund-form="${escapeHtml(id)}">
    <p><strong>Devolver dinero por Mobbex.</strong> Falta devolver ${escapeHtml(formatMoney(refundable, payment.currency))}. Es irreversible.</p>
    <label>Importe a devolver (vacío = todo lo que falta)<input type="text" inputmode="decimal" name="mobbexRefundAmount" maxlength="12" autocomplete="off" placeholder="${escapeHtml(String(refundable))}"></label>
    <label>Por qué se devuelve<input type="text" name="mobbexRefundReason" maxlength="300" autocomplete="off"></label>
    <label>Escribí ${MOBBEX_REFUND_PHRASE} para confirmar<input type="text" name="mobbexRefundConfirmation" maxlength="12" autocomplete="off"></label>
    <div class="button-row">
      <button class="secondary-button compact" type="button" data-mobbex-refund-confirm="${escapeHtml(id)}" ${working ? 'disabled' : ''}>Devolver el dinero</button>
      <button class="ghost-button compact" type="button" data-mobbex-refund-cancel>Mejor no</button>
    </div>
    <p class="form-hint">Si Mobbex no contesta, la devolución queda «verificando» y no se puede repetir: el estado se actualiza solo cuando Mobbex la confirma.</p>
  </div>`;
}

function renderHistory(payment) {
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  const refundRows = refunds.length
    ? refunds.map((refund) => {
      const [label, tone] = REFUND_STATUS_COPY[refund.status] || ['Sin estado', 'neutral'];
      const amount = refund.full ? 'Total' : formatMoney(refund.amount, payment.currency);
      return `<li data-mobbex-refund="${escapeHtml(refund.refund_id || '')}"><span class="status-pill ${tone}">${escapeHtml(label)}</span> ${escapeHtml(amount)} · ${escapeHtml(formatTimestamp(refund.requested_at))}${refund.reason ? ` · ${escapeHtml(refund.reason)}` : ''}</li>`;
    }).join('')
    : '<li>Sin devoluciones.</li>';
  return `<section class="business-config-block" data-mobbex-history>
    <h4>Devoluciones</h4><ul>${refundRows}</ul>
    <p class="form-hint">Última consulta a Mobbex: ${escapeHtml(formatTimestamp(payment.last_reconciled_at))}${payment.payment_id_short ? ` · operación ••••${escapeHtml(payment.payment_id_short)}` : ''}</p>
  </section>`;
}

function formatClock(ms) {
  try {
    return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });
  } catch (_) {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

function formatMoney(value, currency = 'ARS') {
  const amount = Number(value);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency || 'ARS' }).format(Number.isFinite(amount) ? amount : 0);
}

function formatTimestamp(value) {
  const date = new Date(value || 0);
  if (!value || Number.isNaN(date.getTime())) return 'sin hora confirmada';
  try {
    return date.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
    });
  } catch (_) {
    return date.toLocaleString('es-AR', { hourCycle: 'h23' });
  }
}
