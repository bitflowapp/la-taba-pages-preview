// Estado fiscal de un pedido, en palabras del mostrador.
//
// La VERDAD vive en la base: get_order_fiscal_states devuelve, por pedido, la evaluación
// única del servidor (READY/BLOCKED con razones) o el comprobante real (estado del core,
// PDF vigente, impresiones). Este módulo solo lo presenta: no decide si un pedido se
// factura ni repite reglas contables. Nunca muestra SQL, SOAP, XML, PGRST, stacks ni
// token/sign: cada texto sale de un código conocido.

const DOCUMENT_STATES = Object.freeze({
  queued: { code: 'PENDING', tone: 'warning', label: 'Pendiente' },
  retry_wait: { code: 'PENDING', tone: 'warning', label: 'Pendiente' },
  authorizing: { code: 'ISSUING', tone: 'warning', label: 'Emitiendo…' },
  ambiguous: { code: 'VERIFYING', tone: 'warning', label: 'Verificando con ARCA…' },
  authorized: { code: 'ISSUED', tone: 'success', label: 'Factura emitida' },
  credited: { code: 'CREDITED', tone: 'info', label: 'Factura emitida · con nota de crédito' },
  manual_review: { code: 'REVIEW', tone: 'danger', label: 'Requiere revisión' },
  failed: { code: 'REVIEW', tone: 'danger', label: 'Requiere revisión' },
  rejected: { code: 'REJECTED', tone: 'danger', label: 'Rechazada' },
});

const REASON_TEXT = Object.freeze({
  ACCOUNTING_POLICY_REQUIRED: 'Configuración fiscal pendiente',
  FISCAL_PROFILE_DISABLED: 'La facturación está desactivada',
  HOMOLOGATION_NOT_AUTHORIZED: 'Falta autorizar la homologación con ARCA',
  PRODUCTION_BLOCKED: 'La facturación real todavía no está habilitada',
  ORDER_CANCELLED: 'Pedido cancelado: no se factura',
  QA_ORDER_NOT_BILLABLE: 'Pedido de prueba: no se factura',
  PAYMENT_REQUIRED: 'Falta confirmar el pago',
  PAYMENT_METHOD_NOT_INVOICEABLE: 'La configuración fiscal no factura este medio de pago',
  ORDER_NOT_BILLABLE_YET: 'Todavía no corresponde facturarlo',
  INVALID_TOTAL: 'Los importes del pedido no se pueden facturar exactos',
  INVALID_PRODUCT_REFERENCE: 'Hay un producto que no se puede identificar',
  MISSING_TAX_CLASSIFICATION: 'Falta la clasificación impositiva de un producto',
  DISCOUNT_NOT_INVOICEABLE: 'La configuración fiscal no factura descuentos',
  DELIVERY_NOT_INVOICEABLE: 'La configuración fiscal no factura el envío',
  FISCAL_PARAMETERS_REQUIRED: 'Faltan las tablas actualizadas de ARCA',
  RECIPIENT_DATA_REQUIRED: 'Por el monto, hay que identificar al consumidor',
});

const MOMENT_TEXT = Object.freeze({
  after_payment_confirmed: 'Se factura cuando el pago esté confirmado',
  after_delivered: 'Se factura cuando el pedido se entregue',
  after_accepted: 'Se factura cuando el pedido se acepte',
});

const PAYMENT_TEXT = Object.freeze({
  pending: 'Falta confirmar el pago',
  refunded: 'El pago fue devuelto',
  reversed: 'El cobro fue revertido',
  unknown: 'No se pudo verificar el pago',
});

const PRINT_STATES = Object.freeze({
  queued: { code: 'PRINT_PENDING', tone: 'warning', label: 'Impresión pendiente' },
  claimed: { code: 'PRINT_PENDING', tone: 'warning', label: 'Impresión pendiente' },
  printing: { code: 'PRINTING', tone: 'warning', label: 'Imprimiendo…' },
  printed: { code: 'PRINTED', tone: 'success', label: 'Impreso' },
  needs_review: { code: 'PRINT_REVIEW', tone: 'danger', label: 'Impresión a revisar' },
  failed: { code: 'PRINT_FAILED', tone: 'danger', label: 'La impresión falló' },
  cancelled: { code: 'PRINT_CANCELLED', tone: 'neutral', label: 'Impresión cancelada' },
});

const DOCUMENT_LETTER = Object.freeze({ 1: ['Factura', 'A'], 6: ['Factura', 'B'], 11: ['Factura', 'C'], 3: ['Nota de crédito', 'A'], 8: ['Nota de crédito', 'B'], 13: ['Nota de crédito', 'C'] });

// Rastros de lo que nunca se muestra: SQL, SOAP/XML, PostgREST, stacks, credenciales.
const UNSAFE = /PGRST|SQLSTATE|schema cache|could not find|violates|constraint|relation\s|function\s+[\w.]+\(|<\/?[a-z:]+>|soap|xml|stack|\b\w*Error:|(?:file|https?):\/\/\S+:\d+|\bat\s+\S+\.(?:js|ts|mjs|cjs):\d|token|sign\b|service.?role|jwt|bearer|select\s|insert\s|update\s|delete\s|errcode|P0001|42501|23505|22023/i;

const GENERIC_FAILURE = 'No se pudo completar la operación. Probá de nuevo.';

/** Texto de un error del servidor, sin jerga ni secretos. */
export function sanitizeFiscalMessage(message, fallback = GENERIC_FAILURE) {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return !text || UNSAFE.test(text) ? fallback : text;
}

function reasonText(reason) {
  const code = String(reason?.code || '');
  if (code === 'ORDER_NOT_BILLABLE_YET' && MOMENT_TEXT[reason?.billing_moment]) return MOMENT_TEXT[reason.billing_moment];
  if (code === 'PAYMENT_REQUIRED' && PAYMENT_TEXT[reason?.payment_state]) return PAYMENT_TEXT[reason.payment_state];
  const base = REASON_TEXT[code];
  if (!base) return 'Revisión fiscal necesaria';
  const item = typeof reason?.item === 'string' ? reason.item.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return item && ['MISSING_TAX_CLASSIFICATION', 'INVALID_PRODUCT_REFERENCE'].includes(code) ? `${base}: ${item}` : base;
}

/** Razones del servidor → textos, sin repetir. */
export function presentFiscalReasons(reasons = []) {
  return [...new Set((Array.isArray(reasons) ? reasons : []).map(reasonText))];
}

function documentLabel(document) {
  const [kind, letter] = DOCUMENT_LETTER[Number(document?.document_type)] || ['Comprobante', ''];
  const pos = Number(document?.point_of_sale);
  const number = Number(document?.document_number);
  if (!Number.isInteger(pos) || !Number.isInteger(number) || number < 1) return null;
  return `${kind}${letter ? ` ${letter}` : ''} ${String(pos).padStart(5, '0')}-${String(number).padStart(8, '0')}`;
}

function presentPrint(print, documentState, agent) {
  if (!print) return null;
  const job = print.latest_job;
  if (!job) {
    if (print.request_error) return { code: 'PRINT_ERROR', tone: 'danger', label: 'No se pudo mandar a imprimir' };
    if (print.requested) {
      return ['authorized', 'credited'].includes(documentState)
        ? { code: 'PRINT_PENDING', tone: 'warning', label: 'Impresión pendiente' }
        : { code: 'PRINT_ON_ISSUE', tone: 'neutral', label: 'Se imprime al emitirse' };
    }
    return null;
  }
  const base = PRINT_STATES[job.status] || { code: 'PRINT_REVIEW', tone: 'danger', label: 'Impresión a revisar' };
  if (base.code === 'PRINT_PENDING') {
    if (agent === 'NOT_REGISTERED') return { ...base, label: 'Impresión pendiente · no hay una PC de impresión vinculada' };
    if (agent === 'OFFLINE') return { ...base, label: 'Impresión pendiente · la PC de impresión está sin conexión' };
  }
  return base;
}

/**
 * @param state fila de get_order_fiscal_states ({ readiness, document, print }) o null si no se leyó.
 * @param options.agent 'ONLINE' | 'OFFLINE' | 'NOT_REGISTERED' (get_local_print_status)
 * @param options.inFlight hay una operación fiscal en curso para este pedido
 */
export function presentOrderFiscalState(state, { agent = null, inFlight = false } = {}) {
  if (!state || !state.readiness) {
    return Object.freeze({ code: 'UNKNOWN', tone: 'neutral', label: 'Estado fiscal no disponible', reasons: [], actions: Object.freeze({}), print: null, homologation: false });
  }
  const document = state.document || null;
  if (!document) {
    const blocked = state.readiness.status !== 'READY';
    const reasons = presentFiscalReasons(state.readiness.reasons);
    const policyMissing = (state.readiness.reasons || []).some((reason) => reason?.code === 'ACCOUNTING_POLICY_REQUIRED');
    return Object.freeze({
      code: blocked ? (policyMissing ? 'POLICY_REQUIRED' : 'BLOCKED') : 'READY',
      tone: blocked ? (policyMissing ? 'warning' : 'neutral') : 'info',
      label: blocked ? (policyMissing ? 'Configuración fiscal pendiente' : 'No se puede facturar todavía') : 'Listo para facturar',
      reasons,
      actions: Object.freeze({ invoice: !blocked && !inFlight, invoiceAndPrint: !blocked && !inFlight }),
      print: null,
      homologation: false,
    });
  }
  const base = DOCUMENT_STATES[document.state] || { code: 'REVIEW', tone: 'danger', label: 'Requiere revisión' };
  const authorized = ['authorized', 'credited'].includes(document.state) && /^\d{14}$/.test(String(document.cae || ''));
  const homologation = document.environment !== 'production';
  const print = presentPrint(state.print, document.state, agent);
  const latestJob = state.print?.latest_job || null;
  return Object.freeze({
    code: authorized || !['authorized', 'credited'].includes(document.state) ? base.code : 'REVIEW',
    tone: authorized || !['authorized', 'credited'].includes(document.state) ? base.tone : 'danger',
    label: authorized || !['authorized', 'credited'].includes(document.state) ? base.label : 'Requiere revisión',
    number: authorized ? documentLabel(document) : null,
    cae: authorized ? String(document.cae) : null,
    caeLabel: authorized ? (homologation ? 'CAE de homologación' : 'CAE') : null,
    // En homologación (o con el doble de ARCA) el comprobante NO es fiscal: se dice siempre.
    homologation,
    simulationLabel: homologation ? 'HOMOLOGACIÓN · sin validez fiscal' : null,
    reasons: [],
    print,
    actions: Object.freeze({
      viewPdf: authorized && Boolean(document.artifact_id),
      print: authorized && !latestJob && !state.print?.requested && !inFlight,
      reprint: authorized && Boolean(latestJob) && ['printed', 'failed', 'needs_review', 'cancelled'].includes(latestJob.status) && !inFlight,
    }),
  });
}

/**
 * Resultado de una operación fiscal (pedir factura, reimprimir, ver el PDF) → texto. Cada texto sale de un
 * código conocido: el mensaje del servidor NO se muestra (puede traer SQL, PGRST o inglés).
 */
export function presentOrderFiscalActionResult(result, { print = false, action = 'invoice' } = {}) {
  if (result?.ok) {
    if (action === 'reprint') return 'Reimpresión enviada a la PC de impresión.';
    return print ? 'Factura pedida. Se imprime cuando ARCA la autorice.' : 'Factura pedida. Queda pendiente hasta que ARCA la autorice.';
  }
  if (result?.code === 'ORDER_NOT_FISCALLY_READY') {
    const reasons = presentFiscalReasons(result.reasons);
    return reasons.length ? `No se puede facturar todavía: ${reasons.join(' · ')}` : 'No se puede facturar todavía.';
  }
  if (result?.code === 'SESSION_EXPIRED') return 'La sesión venció. Volvé a iniciar sesión.';
  if (result?.code === 'FORBIDDEN') {
    return { reprint: 'Tu usuario no puede reimprimir en este negocio.', pdf: 'Tu usuario no puede ver este comprobante.' }[action]
      || 'Tu usuario no puede facturar en este negocio.';
  }
  if (action === 'pdf' && ['ARTIFACT_ACCESS_UNAVAILABLE', 'ARTIFACT_ACCESS_INVALID'].includes(result?.code)) return 'El PDF todavía no está disponible.';
  if (result?.code === 'REVISION_CONFLICT') return 'Otra operación está en curso. Esperá un momento y volvé a intentar.';
  if (result?.code === 'NOT_FOUND') return 'El pedido ya no está disponible. Actualizá la bandeja.';
  // La reimpresión solo se niega con P0001 si la impresión anterior no terminó.
  if (action === 'reprint' && result?.code === 'P0001') return 'La impresión anterior todavía está en curso. Esperá a que termine para reimprimir.';
  if (result?.retryable) return 'No hubo respuesta del servidor. Probá de nuevo en unos segundos.';
  return GENERIC_FAILURE;
}
