const APPROVED_STATUSES = new Set(['approved', 'approved_order_pending', 'finalizing_order']);
const TERMINAL_ORDER_STATUSES = new Set(['completed', 'refunded', 'partially_refunded']);
const REJECTED_STATUSES = new Set(['rejected', 'cancelled', 'canceled', 'expired', 'failed']);
const SECURITY_STATUSES = new Set(['security_review_required', 'ambiguous']);

export const PAYMENT_RECOVERY_STATES = Object.freeze({
  VERIFYING: 'verifying',
  PAYMENT_APPROVED: 'payment_approved',
  CONFIRMING_ORDER: 'confirming_order',
  ORDER_CONFIRMED: 'order_confirmed',
  REJECTED: 'rejected',
  PENDING: 'pending',
  NEEDS_REVIEW: 'needs_review',
  RESERVATION_REVIEW: 'reservation_review',
  REFUND_PROCESSING: 'refund_processing',
  REFUND_CONFIRMED: 'refund_confirmed',
  NEEDS_OWNER_INTERVENTION: 'needs_owner_intervention',
});

const STATE_COPY = Object.freeze({
  [PAYMENT_RECOVERY_STATES.VERIFYING]: {
    label: 'Verificando el pago',
    title: 'Verificando el pago',
    message: 'Estamos consultando el estado del pago de forma segura.',
  },
  [PAYMENT_RECOVERY_STATES.PAYMENT_APPROVED]: {
    label: 'Pago aprobado',
    title: 'Pago aprobado, pedido pendiente',
    message: 'El dinero está registrado y no se perdió. Estamos intentando completar el pedido de forma segura.',
  },
  [PAYMENT_RECOVERY_STATES.CONFIRMING_ORDER]: {
    label: 'Confirmando tu pedido',
    title: 'Confirmando tu pedido',
    message: 'El pago fue aprobado. Estamos creando el pedido sin duplicarlo.',
  },
  [PAYMENT_RECOVERY_STATES.ORDER_CONFIRMED]: {
    label: 'Pedido confirmado',
    title: 'Pedido confirmado',
    message: 'El pago y el pedido quedaron registrados.',
  },
  [PAYMENT_RECOVERY_STATES.REJECTED]: {
    label: 'Pago rechazado',
    title: 'Pago rechazado',
    message: 'Mercado Pago no aprobó este pago. Podés intentar nuevamente.',
  },
  [PAYMENT_RECOVERY_STATES.PENDING]: {
    label: 'Pago pendiente',
    title: 'Pago pendiente',
    message: 'Todavía no tenemos una confirmación final. No hace falta pagar otra vez.',
  },
  [PAYMENT_RECOVERY_STATES.NEEDS_REVIEW]: {
    label: 'Necesitamos revisar este pago',
    title: 'Pago en revisión de seguridad',
    message: 'No vamos a crear el pedido ni tocar el stock hasta confirmar qué ocurrió.',
  },
  [PAYMENT_RECOVERY_STATES.RESERVATION_REVIEW]: {
    label: 'Pago recibido, stock por revisar',
    title: 'Pago recibido, stock por revisar',
    message: 'El pago fue recibido, pero la reserva de stock venció. Revisá la disponibilidad antes de confirmar un pedido o preparar una devolución.',
  },
  [PAYMENT_RECOVERY_STATES.REFUND_PROCESSING]: {
    label: 'Reembolso en proceso',
    title: 'Reembolso en proceso',
    message: 'El resultado de la devolución todavía se está verificando. No la envíes otra vez.',
  },
  [PAYMENT_RECOVERY_STATES.REFUND_CONFIRMED]: {
    label: 'Reembolso confirmado',
    title: 'Reembolso confirmado',
    message: 'La devolución fue registrada correctamente.',
  },
  [PAYMENT_RECOVERY_STATES.NEEDS_OWNER_INTERVENTION]: {
    label: 'Se necesita intervención del responsable',
    title: 'Se necesita intervención del responsable',
    message: 'El pago requiere una decisión manual antes de continuar.',
  },
});

export const PAYMENT_ACTION_OUTCOMES = Object.freeze({
  RETRYING: 'Reintentando…',
  PAYMENT_CONFIRMED_CREATING: 'Pago confirmado. Estamos creando el pedido.',
  ORDER_ALREADY_CREATED: 'El pedido ya había sido creado.',
  ORDER_CREATED: 'Pedido creado correctamente.',
  PAYMENT_PENDING: 'El pago todavía está pendiente.',
  AUTOMATION_FAILED: 'No pudimos completar el pedido automáticamente.',
  OWNER_REVIEW: 'Se necesita revisión del responsable.',
});

export const PAYMENT_WORKER_STATES = Object.freeze({
  NORMAL: 'Procesamiento normal',
  DELAYED: 'Procesamiento demorado',
  SCHEDULED: 'Reintento programado',
  ATTENTION: 'Requiere atención',
  NO_PROGRESS: 'Sin progreso',
});

export function paymentRecoveryState(payment = {}) {
  const refundStatus = String(payment.latest_refund_status || '').toLowerCase();
  if (refundStatus === 'approved' && ['refunded', 'security_review_required'].includes(String(payment.internal_status || ''))) {
    return PAYMENT_RECOVERY_STATES.REFUND_CONFIRMED;
  }
  if (['requested', 'processing', 'ambiguous'].includes(refundStatus)) {
    return PAYMENT_RECOVERY_STATES.REFUND_PROCESSING;
  }

  const internalStatus = String(payment.internal_status || '').toLowerCase();
  const providerStatus = String(payment.provider_status || '').toLowerCase();
  if (isExpiredReservationPayment(payment)) return PAYMENT_RECOVERY_STATES.RESERVATION_REVIEW;
  if (TERMINAL_ORDER_STATUSES.has(internalStatus) || payment.order_id || payment.order_public_code) {
    return PAYMENT_RECOVERY_STATES.ORDER_CONFIRMED;
  }
  if (internalStatus === 'finalizing_order') return PAYMENT_RECOVERY_STATES.CONFIRMING_ORDER;
  if (internalStatus === 'approved_order_pending') return PAYMENT_RECOVERY_STATES.PAYMENT_APPROVED;
  if (internalStatus === 'approved' && !payment.order_id) return PAYMENT_RECOVERY_STATES.PAYMENT_APPROVED;
  if (['pending', 'in_process'].includes(internalStatus) || ['pending', 'in_process'].includes(providerStatus)) {
    return PAYMENT_RECOVERY_STATES.PENDING;
  }
  if (SECURITY_STATUSES.has(internalStatus)) return PAYMENT_RECOVERY_STATES.NEEDS_REVIEW;
  if (REJECTED_STATUSES.has(internalStatus) || REJECTED_STATUSES.has(providerStatus)) {
    return PAYMENT_RECOVERY_STATES.REJECTED;
  }
  if (payment.dispute_type && !/resolved|closed/i.test(String(payment.dispute_status || ''))) {
    return PAYMENT_RECOVERY_STATES.NEEDS_OWNER_INTERVENTION;
  }
  return PAYMENT_RECOVERY_STATES.VERIFYING;
}

export function paymentRecoveryCopy(payment = {}) {
  return STATE_COPY[paymentRecoveryState(payment)] || STATE_COPY[PAYMENT_RECOVERY_STATES.VERIFYING];
}

export function isApprovedWithoutOrder(payment = {}) {
  return APPROVED_STATUSES.has(String(payment.internal_status || '').toLowerCase())
    && !payment.order_id
    && !payment.order_public_code;
}

export function isExpiredReservationPayment(payment = {}) {
  const reason = String(payment.security_review_reason || '').toLowerCase();
  const approvedReservationReason = ['approved_after_reservation_expired', 'finalization_without_active_reservation'].includes(reason);
  return !payment.order_id
    && (approvedReservationReason
      || (!reason && String(payment.reservation_state || '').toLowerCase() === 'expired'))
    && (String(payment.provider_status || '').toLowerCase() === 'approved'
      || String(payment.internal_status || '').toLowerCase() === 'security_review_required');
}

export function paymentWorkerState(payment = {}, now = Date.now()) {
  const rawStatus = String(payment.worker_status || '').toLowerCase();
  const nextAttemptAt = Date.parse(payment.worker_next_attempt_at || '');
  const leaseExpiresAt = Date.parse(payment.worker_lease_expires_at || '');
  const lastUpdateAt = Date.parse(payment.last_update_at || payment.updated_at || '');
  const nowMs = Number.isFinite(now) ? now : Date.now();

  if (['failed', 'dead_letter'].includes(rawStatus)) return PAYMENT_WORKER_STATES.ATTENTION;
  if (['claimed', 'processing'].includes(rawStatus) && Number.isFinite(leaseExpiresAt) && leaseExpiresAt < nowMs) {
    return PAYMENT_WORKER_STATES.NO_PROGRESS;
  }
  if (['pending', 'retry_wait'].includes(rawStatus) && Number.isFinite(nextAttemptAt) && nextAttemptAt > nowMs) {
    return PAYMENT_WORKER_STATES.SCHEDULED;
  }
  if (['pending', 'retry_wait'].includes(rawStatus) && Number.isFinite(nextAttemptAt) && nextAttemptAt <= nowMs) {
    return PAYMENT_WORKER_STATES.DELAYED;
  }
  if (['claimed', 'processing'].includes(rawStatus)) return PAYMENT_WORKER_STATES.NORMAL;
  if (Number.isFinite(lastUpdateAt) && lastUpdateAt < nowMs - 15 * 60 * 1000
    && !['completed', 'refunded', 'rejected', 'cancelled', 'expired', 'charged_back'].includes(String(payment.internal_status || '').toLowerCase())) {
    return PAYMENT_WORKER_STATES.NO_PROGRESS;
  }
  return PAYMENT_WORKER_STATES.NORMAL;
}

export function paymentRecoveryActions(payment = {}) {
  if (isApprovedWithoutOrder(payment)) {
    return [
      { kind: 'reconcile', label: 'Reintentar ahora', primary: true },
      { kind: 'refresh', label: 'Actualizar estado' },
      { kind: 'support', label: 'Contactar soporte' },
    ];
  }
  if (isExpiredReservationPayment(payment)) {
    return [
      { kind: 'reconcile', label: 'Revisar stock', primary: true },
      ...(payment.can_refund ? [{ kind: 'refund', label: 'Preparar devolución' }] : []),
      { kind: 'view', label: 'Ver pago' },
      { kind: 'support', label: 'Preparar diagnóstico para soporte' },
    ];
  }
  if (paymentRecoveryState(payment) === PAYMENT_RECOVERY_STATES.NEEDS_REVIEW) {
    return [
      { kind: 'view', label: 'Ver pago', primary: true },
      { kind: 'support', label: 'Preparar diagnóstico para soporte' },
    ];
  }
  const worker = payment.processing_state || paymentWorkerState(payment);
  if ([PAYMENT_WORKER_STATES.DELAYED, PAYMENT_WORKER_STATES.ATTENTION, PAYMENT_WORKER_STATES.NO_PROGRESS].includes(worker)) {
    return [
      { kind: 'reactivate', label: 'Reactivar procesamiento', primary: true },
      { kind: 'refresh', label: 'Actualizar estado' },
      { kind: 'support', label: 'Preparar diagnóstico para soporte' },
    ];
  }
  if (paymentRecoveryState(payment) === PAYMENT_RECOVERY_STATES.PENDING) {
    return [{ kind: 'refresh', label: 'Actualizar estado', primary: true }];
  }
  if (payment.can_refund) return [{ kind: 'refund', label: 'Preparar devolución', primary: true }];
  if (payment.can_cancel) return [{ kind: 'cancel', label: 'Cancelar pago', primary: true }];
  if (payment.can_reconcile) return [{ kind: 'refresh', label: 'Actualizar estado', primary: true }];
  return [];
}

export function paymentActionOutcome(payment = {}) {
  const state = paymentRecoveryState(payment);
  if (state === PAYMENT_RECOVERY_STATES.ORDER_CONFIRMED) {
    return payment.order_was_existing ? PAYMENT_ACTION_OUTCOMES.ORDER_ALREADY_CREATED : PAYMENT_ACTION_OUTCOMES.ORDER_CREATED;
  }
  if ([PAYMENT_RECOVERY_STATES.PAYMENT_APPROVED, PAYMENT_RECOVERY_STATES.CONFIRMING_ORDER].includes(state)) {
    return PAYMENT_ACTION_OUTCOMES.PAYMENT_CONFIRMED_CREATING;
  }
  if (state === PAYMENT_RECOVERY_STATES.PENDING) return PAYMENT_ACTION_OUTCOMES.PAYMENT_PENDING;
  if ([PAYMENT_RECOVERY_STATES.NEEDS_REVIEW, PAYMENT_RECOVERY_STATES.RESERVATION_REVIEW, PAYMENT_RECOVERY_STATES.NEEDS_OWNER_INTERVENTION].includes(state)) {
    return PAYMENT_ACTION_OUTCOMES.OWNER_REVIEW;
  }
  if (state === PAYMENT_RECOVERY_STATES.REJECTED) return PAYMENT_ACTION_OUTCOMES.AUTOMATION_FAILED;
  return PAYMENT_ACTION_OUTCOMES.RETRYING;
}

export function buildPaymentSupportDiagnostic(payment = {}) {
  return {
    version: 'taba2-payment-recovery-p0',
    payment_intent_id: nullable(payment.payment_intent_id),
    checkout_session_id: nullable(payment.checkout_session_id),
    order_id: nullable(payment.order_id),
    internal_status: nullable(payment.internal_status),
    provider_status: nullable(payment.provider_status),
    provider_status_detail: sanitizeDiagnosticValue(payment.provider_status_detail),
    created_at: nullable(payment.created_at),
    approved_at: nullable(payment.approved_at),
    last_update_at: nullable(payment.last_update_at || payment.updated_at),
    attempt_count: Number.isFinite(Number(payment.attempt_count)) ? Number(payment.attempt_count) : 0,
    correlation_id: nullable(payment.correlation_id),
    processing_state: nullable(payment.processing_state || paymentWorkerState(payment)),
    worker_status: nullable(payment.worker_status),
    worker_attempts: Number.isFinite(Number(payment.worker_attempts)) ? Number(payment.worker_attempts) : 0,
    sanitized_error: sanitizeDiagnosticValue(payment.worker_last_error),
  };
}

export function serializePaymentSupportDiagnostic(payment = {}) {
  return JSON.stringify(buildPaymentSupportDiagnostic(payment), null, 2);
}

export function sanitizeDiagnosticValue(value) {
  if (value == null) return null;
  const text = String(value)
    .replace(
      /((?:authorization|access[_ -]?token|api[_ -]?key|secret|card|cvv|raw[_ -]?payload))\s*[:=]\s*(?:(?:bearer|basic)\s+)?[^\s,;]+/gi,
      (_match, key) => /raw[_ -]?payload/i.test(key) ? '[oculto]' : `${key}=[oculto]`,
    )
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+/gi, '[oculto]')
    .replace(/\btoken\s*[:=]\s*[^\s,;]+/gi, 'token=[oculto]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 200) : null;
}

function nullable(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}
