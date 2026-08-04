// Traduce el estado autoritativo de la operación al lenguaje que usa el mostrador.
// Regla dura: ninguna cadena visible puede nombrar la plomería interna (ver FORBIDDEN_OPERATOR_VOCABULARY).
// El identificador técnico existe, pero vive detrás de "Detalle para soporte" y nunca se muestra solo.

export const FORBIDDEN_OPERATOR_VOCABULARY = Object.freeze([
  'rpc', 'webhook', 'outbox', 'cas', 'service_role', 'service role',
  'stack trace', 'stacktrace', 'traceback', 'postgres', 'postgresql', 'supabase',
  'null', 'undefined', 'exception', 'errcode',
]);

const SEVERITY_ORDER = Object.freeze({ CRITICAL: 0, ACTION_REQUIRED: 1, WARNING: 2, INFO: 3 });

export const SEVERITY_LABELS = Object.freeze({
  CRITICAL: 'Frená y resolvé ahora',
  ACTION_REQUIRED: 'Necesita una acción',
  WARNING: 'Mirá cuando puedas',
  INFO: 'Para tu información',
});

// Referencia estable que el soporte puede buscar sin exponer el vocabulario interno.
// La tabla de equivalencias vive en docs/panel-negocio-operacion.md.
const ALERT_LIBRARY = Object.freeze({
  PAYMENT_APPROVED_WITHOUT_ORDER: {
    support: 'TABA-PAGO-01',
    happened: 'Entró un pago aprobado que todavía no tiene pedido armado.',
    preserved: 'El dinero está acreditado y queda registrado con su importe y su referencia. No se pierde.',
    risk: 'Si cobrás de nuevo o el cliente reclama, quedás sin respaldo de qué se entregó.',
    recommendation: 'Abrí Pagos, compará importe y referencia, y generá el pedido desde ese mismo pago.',
    action: { label: 'Ir a Pagos', view: 'payments' },
  },
  PAYMENT_RECONCILIATION_REQUIRED: {
    support: 'TABA-PAGO-02',
    happened: 'Un pago quedó con resultado dudoso o en revisión de seguridad.',
    preserved: 'El importe, la moneda y la referencia del pago quedan guardados tal como llegaron.',
    risk: 'Entregar sin confirmar puede dejarte sin cobrar; rechazar sin mirar puede perder una venta buena.',
    recommendation: 'Abrí Pagos y pedí "Actualizar desde Mercado Pago" antes de entregar o cancelar.',
    action: { label: 'Ir a Pagos', view: 'payments' },
  },
  PAYMENT_OUTBOX_STALLED: {
    support: 'TABA-PAGO-03',
    happened: 'Los avisos de este pago no terminaron de procesarse y quedaron esperando.',
    preserved: 'El pago y su referencia quedan intactos. Nada se cobró dos veces.',
    risk: 'Mientras no se procese, el pedido puede quedar sin aparecer o sin descontar stock.',
    recommendation: 'Revisá que haya internet y pedí "Actualizar desde Mercado Pago" en Pagos.',
    action: { label: 'Ir a Pagos', view: 'payments' },
  },
  FISCAL_AUTHORIZATION_AMBIGUOUS: {
    support: 'TABA-ARCA-01',
    happened: 'No se pudo confirmar si ARCA autorizó el comprobante.',
    preserved: 'El número reservado y los datos del comprobante quedan guardados. No se emite otro por las dudas.',
    risk: 'Volver a emitir a ciegas puede duplicar el comprobante y complicar la declaración.',
    recommendation: 'Abrí Comprobantes y consultá el estado en ARCA por tipo, punto de venta y número antes de reintentar.',
    action: { label: 'Ir a Comprobantes', view: 'fiscal-status' },
  },
  FISCAL_OUTBOX_STALLED: {
    support: 'TABA-ARCA-02',
    happened: 'Los comprobantes pendientes dejaron de avanzar.',
    preserved: 'Cada comprobante conserva su número reservado y sus importes. Nada se emite dos veces.',
    risk: 'El cliente se queda sin factura y la venta queda sin respaldo fiscal.',
    recommendation: 'Verificá internet y el estado de ARCA; si sigue igual, preparás un diagnóstico para soporte.',
    action: { label: 'Ir a ARCA', view: 'fiscal-setup' },
  },
  FISCAL_ARTIFACT_STALLED: {
    support: 'TABA-ARCA-03',
    happened: 'El comprobante está autorizado, pero su PDF todavía no está disponible.',
    preserved: 'La autorización de ARCA es válida y no se toca. Sólo falta el archivo para imprimir o enviar.',
    risk: 'No vas a poder imprimir ni mandar el comprobante hasta que el archivo esté listo.',
    recommendation: 'Abrí Comprobantes y pedí "Regenerar PDF"; la autorización se mantiene igual.',
    action: { label: 'Ir a Comprobantes', view: 'fiscal-status' },
  },
  PRINT_JOB_FAILED: {
    support: 'TABA-IMP-01',
    happened: 'Una impresión falló o no se pudo verificar que haya salido.',
    preserved: 'El comprobante y su PDF quedan disponibles para reimprimir cuando quieras.',
    risk: 'Reimprimir sin mirar la impresora puede dejar copias de más sobre el mostrador.',
    recommendation: 'Mirá papel y conexión en Dispositivos, y recién ahí reimprimí desde Comprobantes.',
    action: { label: 'Probar dispositivos', view: 'devices' },
  },
  RIDER_SIGNAL_STALE: {
    support: 'TABA-ENVIO-01',
    happened: 'Un envío activo lleva varios minutos sin señal del repartidor.',
    preserved: 'El pedido, su dirección y su última posición conocida quedan guardados.',
    risk: 'Si le decís al cliente una ubicación que no tenés, perdés credibilidad cuando no coincida.',
    recommendation: 'Llamá al repartidor y confirmá dónde está; no inventes una posición en el seguimiento.',
    action: { label: 'Ir a Pedidos', view: 'orders' },
  },
});

const SERVICE_HEALTH_FALLBACK = Object.freeze({
  support: 'TABA-SERV-01',
  happened: 'Un servicio del negocio avisó que está funcionando a medias.',
  preserved: 'Todo lo que ya se registró sigue guardado. No se borra nada por esta alerta.',
  risk: 'Algunas operaciones pueden tardar más o quedar esperando sin que lo notes.',
  recommendation: 'Corré "Abrir negocio" para ver qué parte está afectada antes de seguir vendiendo.',
  action: { label: 'Abrir negocio', view: 'day-open' },
});

const UNKNOWN_ALERT = Object.freeze({
  support: 'TABA-GEN-01',
  happened: 'El sistema detectó algo que necesita que una persona lo mire.',
  preserved: 'No se cambió ni se borró nada por esta alerta.',
  risk: 'Sin revisarlo, no sabemos si afecta pedidos, cobros o comprobantes.',
  recommendation: 'Preparás un diagnóstico y se lo pasás a soporte con la referencia de abajo.',
  action: { label: 'Ir al centro de operación', view: 'operation-center' },
});

export const METRIC_LIBRARY = Object.freeze([
  { key: 'new_orders', label: 'Pedidos nuevos', hint: 'Entraron y esperan que los aceptes.', view: 'orders', attentionAbove: 0, tone: 'attention' },
  { key: 'delayed_orders', label: 'Pedidos demorados', hint: 'Pasaron del tiempo que prometiste.', view: 'orders', attentionAbove: 0, tone: 'critical' },
  { key: 'pending_payments', label: 'Pagos en camino', hint: 'El cliente todavía no terminó de pagar.', view: 'payments', attentionAbove: 0, tone: 'info' },
  { key: 'payments_in_review', label: 'Pagos a revisar', hint: 'Quedaron dudosos o sin pedido.', view: 'payments', attentionAbove: 0, tone: 'critical' },
  { key: 'orders_without_stock', label: 'Pedidos sin stock', hint: 'Falta mercadería para completarlos.', view: 'inventory-receive', attentionAbove: 0, tone: 'critical' },
  { key: 'packing_incomplete', label: 'Preparaciones abiertas', hint: 'Empezaron y todavía no se cerraron.', view: 'packing', attentionAbove: 0, tone: 'attention' },
  { key: 'active_deliveries', label: 'Envíos en la calle', hint: 'Están en camino ahora mismo.', view: 'orders', attentionAbove: null, tone: 'info' },
  { key: 'riders_without_signal', label: 'Repartidores sin señal', hint: 'Hace rato que no reportan posición.', view: 'orders', attentionAbove: 0, tone: 'attention' },
  { key: 'fiscal_documents_pending', label: 'Comprobantes pendientes', hint: 'Todavía no están autorizados o sin PDF.', view: 'fiscal-status', attentionAbove: 0, tone: 'attention' },
  { key: 'failed_prints', label: 'Impresiones con problema', hint: 'No salieron o no se pudieron verificar.', view: 'devices', attentionAbove: 0, tone: 'attention' },
  { key: 'pending_credit_notes', label: 'Notas de crédito pendientes', hint: 'Falta autorizarlas o generar su PDF.', view: 'fiscal-status', attentionAbove: 0, tone: 'attention' },
  { key: 'blocked_outboxes', label: 'Envíos internos trabados', hint: 'Quedaron esperando y no avanzan solos.', view: 'operation-center', attentionAbove: 0, tone: 'critical' },
  { key: 'reconciliations_required', label: 'Para conciliar', hint: 'Hay que compararlos antes del cierre.', view: 'day-close', attentionAbove: 0, tone: 'critical' },
]);

export function describeOperationalAlert(alert = {}) {
  const code = String(alert.code || alert.alert_code || '').toUpperCase();
  const copy = ALERT_LIBRARY[code]
    || (String(alert.subject_type || '') === 'service_health' ? SERVICE_HEALTH_FALLBACK : UNKNOWN_ALERT);
  const severity = normalizeSeverity(alert.severity);
  const occurrences = Number.isSafeInteger(Number(alert.occurrence_count)) ? Number(alert.occurrence_count) : 1;
  return Object.freeze({
    id: String(alert.id || ''),
    severity,
    severityLabel: SEVERITY_LABELS[severity],
    happened: copy.happened,
    preserved: copy.preserved,
    risk: copy.risk,
    recommendation: copy.recommendation,
    action: Object.freeze({ ...copy.action }),
    status: normalizeAlertStatus(alert.status),
    statusLabel: alertStatusLabel(normalizeAlertStatus(alert.status)),
    repeated: occurrences > 1 ? `Se repitió ${occurrences} veces.` : '',
    support: Object.freeze({
      reference: copy.support,
      trace: shortTrace(alert.correlation_id),
      seenAt: String(alert.last_seen_at || ''),
    }),
  });
}

export function sortAlertsByUrgency(alerts = []) {
  return [...(Array.isArray(alerts) ? alerts : [])].sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[normalizeSeverity(left?.severity)] - SEVERITY_ORDER[normalizeSeverity(right?.severity)];
    if (bySeverity !== 0) return bySeverity;
    return String(right?.last_seen_at || '').localeCompare(String(left?.last_seen_at || ''));
  });
}

export function describeMetrics(metrics = {}) {
  return METRIC_LIBRARY.map((entry) => {
    const value = safeCount(metrics[entry.key]);
    const needsAttention = entry.attentionAbove !== null && value > entry.attentionAbove;
    return Object.freeze({
      key: entry.key,
      label: entry.label,
      hint: entry.hint,
      view: entry.view,
      value,
      needsAttention,
      tone: needsAttention ? entry.tone : 'calm',
    });
  });
}

export function summarizeOperation(snapshot = {}) {
  const alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];
  const critical = alerts.filter((alert) => normalizeSeverity(alert?.severity) === 'CRITICAL').length;
  const actionable = alerts.filter((alert) => normalizeSeverity(alert?.severity) === 'ACTION_REQUIRED').length;
  if (critical > 0) {
    return Object.freeze({
      tone: 'critical',
      headline: critical === 1 ? 'Hay 1 cosa para frenar y resolver' : `Hay ${critical} cosas para frenar y resolver`,
      detail: 'Resolvelas antes de seguir cobrando o entregando.',
    });
  }
  if (actionable > 0) {
    return Object.freeze({
      tone: 'attention',
      headline: actionable === 1 ? 'Hay 1 cosa esperando una acción' : `Hay ${actionable} cosas esperando una acción`,
      detail: 'Podés seguir vendiendo mientras las resolvés.',
    });
  }
  return Object.freeze({
    tone: 'calm',
    headline: 'La operación está al día',
    detail: 'No hay nada pendiente que necesite una persona ahora mismo.',
  });
}

// Convierte cualquier mensaje de error en algo que se pueda leer en el mostrador.
export function humanizeFailure(message, fallback = 'No se pudo completar la acción. Volvé a intentar en un momento.') {
  const raw = String(message || '').replace(/\s+/g, ' ').trim();
  if (!raw) return fallback;
  if (raw.length > 240) return fallback;
  if (/\b(?:at\s+\w+[.:]|:\d+:\d+|\bfunction\b|\bselect\b|\binsert\b|\bupdate\b)/i.test(raw)) return fallback;
  const lower = raw.toLowerCase();
  if (FORBIDDEN_OPERATOR_VOCABULARY.some((term) => lower.includes(term))) return fallback;
  return raw;
}

export function containsForbiddenVocabulary(text) {
  const lower = String(text || '').toLowerCase();
  return FORBIDDEN_OPERATOR_VOCABULARY.filter((term) => new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(term)}(?:[^a-z0-9_]|$)`, 'i').test(lower));
}

export function alertLibrarySnapshot() {
  return Object.entries(ALERT_LIBRARY).map(([code, copy]) => Object.freeze({ code, support: copy.support }));
}

function normalizeSeverity(value) {
  const severity = String(value || 'INFO').toUpperCase();
  return Object.hasOwn(SEVERITY_ORDER, severity) ? severity : 'INFO';
}

function normalizeAlertStatus(value) {
  const status = String(value || 'open').toLowerCase();
  return ['open', 'acknowledged', 'resolved'].includes(status) ? status : 'open';
}

function alertStatusLabel(status) {
  return ({ open: 'Sin mirar', acknowledged: 'Vista, sin resolver', resolved: 'Resuelta' })[status] || 'Sin mirar';
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function shortTrace(value) {
  const trace = String(value || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trace) ? trace.slice(0, 8).toUpperCase() : '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
