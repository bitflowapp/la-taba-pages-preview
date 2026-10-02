// Conciliación de pagos: La Taba contra Mercado Pago. LÓGICA PURA.
//
// POR QUÉ EXISTE
// --------------
// El estado local de un pago se arma con lo que el worker alcanzó a leer del
// proveedor. Si una notificación se pierde, queda en dead-letter o llega para un
// pago ya cerrado, nada vuelve a mirar ese pago (auditoría PAY-06): el intent
// sigue «completed» aunque la plata se haya devuelto o esté en disputa. Este
// módulo compara lo que dice la base con lo que dice el proveedor y nombra cada
// diferencia con un código estable.
//
// QUÉ NO HACE, A PROPÓSITO
// ------------------------
//   · no lee ni escribe nada: recibe filas ya cargadas y devuelve un informe;
//   · no decide correcciones: un hallazgo es una pregunta para una persona;
//   · no deja pasar datos personales: de cada fila toma SÓLO una lista blanca de
//     campos, así que nombre, teléfono, e-mail, dirección o tarjeta no pueden
//     llegar al informe aunque la fuente los traiga;
//   · no da por conciliado lo que no pudo comparar: eso sale como
//     UNVERIFIED_AGAINST_PROVIDER y se cuenta aparte. «No pudo comparar»
//     incluye dos casos que parecen comparados y no lo están: el grupo de
//     pagos de una referencia que puede estar incompleto (Checkout Pro deja
//     pagar varias veces una preferencia) y el pago del proveedor al que le
//     falta un dato (moneda, reembolsos).

export const FINDING_CODES = Object.freeze([
  'PAYMENT_MISSING_LOCAL',
  'PAYMENT_MISSING_PROVIDER',
  'STATUS_MISMATCH',
  'AMOUNT_MISMATCH',
  'ORDER_PAYMENT_MISMATCH',
  'REFUND_MISMATCH',
]);
export const UNVERIFIED_CODE = 'UNVERIFIED_AGAINST_PROVIDER';
export const ALL_CODES = Object.freeze([...FINDING_CODES, UNVERIFIED_CODE]);
export const SEVERITIES = Object.freeze(['critical', 'warning', 'info']);

// El mismo formato que exige el CHECK `payment_intents_external_reference_format`.
// Un pago del vendedor con otra referencia (otro canal, otra integración) no es
// de esta conciliación y no puede faltar «localmente».
export const INTEGRATION_REFERENCE = /^taba2:checkout:[0-9a-f-]{36}$/;

// Copia de `payment_internal_status_rank`. El estado interno sólo sube de rango
// (trigger `payment_intents_zz_monotonic_status`), y eso explica varios estados
// «adelantados» que no son un error.
export const INTERNAL_STATUS_RANK = Object.freeze({
  created: 10,
  preference_creating: 20,
  ambiguous: 25,
  preference_created: 30,
  redirected: 40,
  pending: 50,
  in_process: 60,
  rejected: 70,
  cancelled: 75,
  expired: 80,
  failed: 85,
  approved: 100,
  approved_order_pending: 105,
  completed: 110,
  partially_refunded: 120,
  refunded: 130,
  charged_back: 140,
  security_review_required: 150,
});

const PRE_PAYMENT = Object.freeze(['created', 'preference_creating', 'ambiguous', 'preference_created', 'redirected']);
const IN_FLIGHT = Object.freeze(['pending', 'in_process']);
const NO_MONEY = Object.freeze(['rejected', 'cancelled', 'expired', 'failed']);
const PAID = Object.freeze(['approved', 'approved_order_pending', 'completed']);
const REFUND_STATES = Object.freeze(['partially_refunded', 'refunded']);
const REVIEW = 'security_review_required';

function localClass(status) {
  if (PRE_PAYMENT.includes(status)) return 'pre';
  if (IN_FLIGHT.includes(status)) return 'flight';
  if (NO_MONEY.includes(status)) return 'dead';
  if (PAID.includes(status)) return 'paid';
  if (REFUND_STATES.includes(status)) return 'refund';
  if (status === 'charged_back') return 'charged_back';
  if (status === REVIEW) return 'review';
  return 'unknown';
}

// TABLA DE MAPEO: estado del proveedor → estado interno.
//
// Sale de la definición viva de `record_mercadopago_payment_snapshot`:
//   · `writes` es lo que esa función escribe para ese estado;
//   · `consistent` son los estados internos legítimos con ese estado enfrente
//     (lo que escribe el snapshot más lo que escriben después finalize, release
//     y el barrido de vencimientos);
//   · `money` dice dónde está la plata, que es lo que decide la gravedad.
//
// Tres casos que la tabla sola no cuenta y están resueltos en `statusVerdict`:
//   · `approved` con reembolsos: el snapshot escribe `partially_refunded` o
//     `refunded` según el total reembolsado;
//   · `in_mediation` no está en la lista de estados aceptados del snapshot: cae
//     en `unknown_provider_status` y deja el intent en revisión (PAY-05);
//   · `security_review_required` es el sumidero «falla cerrada»: ningún snapshot
//     lo baja (rango 150), así que el ESTADO no dice nada y se juzga por dónde
//     está la plata y si hay pedido. Coherente con cualquier estado NO quiere
//     decir conciliado: un contracargo, una devolución o un rechazo sobre un
//     intent en revisión con pedido es justo el caso que nadie más mira
//     (PAY-05/PAY-06), y sale como hallazgo.
export const PROVIDER_STATUS_MAP = Object.freeze({
  approved: Object.freeze({ writes: 'approved_order_pending', consistent: PAID, money: 'held' }),
  authorized: Object.freeze({ writes: 'in_process', consistent: Object.freeze(['in_process']), money: 'in_flight' }),
  in_process: Object.freeze({ writes: 'in_process', consistent: Object.freeze(['in_process']), money: 'in_flight' }),
  pending: Object.freeze({ writes: 'pending', consistent: IN_FLIGHT, money: 'in_flight' }),
  rejected: Object.freeze({ writes: 'rejected', consistent: NO_MONEY, money: 'none' }),
  cancelled: Object.freeze({ writes: 'cancelled', consistent: NO_MONEY, money: 'none' }),
  expired: Object.freeze({ writes: 'expired', consistent: NO_MONEY, money: 'none' }),
  refunded: Object.freeze({ writes: 'refunded', consistent: Object.freeze(['refunded']), money: 'returned' }),
  charged_back: Object.freeze({ writes: 'charged_back', consistent: Object.freeze(['charged_back']), money: 'returned' }),
  in_mediation: Object.freeze({ writes: REVIEW, consistent: Object.freeze([REVIEW, 'charged_back']), money: 'held' }),
});

// Estados del proveedor en los que la plata del cliente está HOY en la cuenta
// del vendedor. Dos de estos sobre una misma referencia es un doble cobro.
const MONEY_HELD = Object.freeze(['approved', 'in_mediation']);
const ORDER_CLOSED = Object.freeze(['cancelled', 'canceled', 'rejected']);
const REFUND_OPEN = Object.freeze(['requested', 'processing', 'ambiguous']);

export const DEFAULT_LAG_MINUTES = 30;
export const DEFAULT_REFUND_STUCK_MINUTES = 30;
// La preferencia vence con la sesión (`expiration_date_to`). El margen cubre la
// diferencia de relojes entre la base y Mercado Pago al fechar un pago hecho en
// el último segundo.
export const PREFERENCE_LIFE_MARGIN_MINUTES = 10;

// ── Utilidades ───────────────────────────────────────────────────────────────
const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const text = (value) => (value === null || value === undefined ? '' : String(value).trim());
const textOrNull = (value) => text(value) || null;
const lower = (value) => text(value).toLowerCase();

/** Importe a centavos enteros. `numeric(12,2)` llega como texto o como número. */
export function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
const amount = (cents) => (cents === null || cents === undefined ? null : cents / 100);

function toMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}
const iso = (value) => {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
};
const minutesBetween = (fromMs, toMs_) => (fromMs === null || toMs_ === null ? null : Math.round((toMs_ - fromMs) / 60000));

// ── Normalización: LISTA BLANCA de campos ────────────────────────────────────
/**
 * Un pago de Mercado Pago (recurso de pago o resultado de búsqueda) reducido a
 * lo que la conciliación necesita. Todo lo demás —`payer`, `card`,
 * `additional_info`, `description`, `metadata`— se descarta acá y no vuelve.
 */
export function normalizeProviderPayment(raw) {
  const payment = obj(raw);
  if (payment.provider_payment_id !== undefined && payment.transaction_amount_cents !== undefined) {
    return pickNormalizedPayment(payment);
  }
  const detail = Array.isArray(payment.refunds) ? payment.refunds : null;
  const refunds = (detail || []).map((entry) => {
    const refund = obj(entry);
    return {
      provider_refund_id: text(refund.id),
      amount_cents: toCents(refund.amount),
      status: lower(refund.status),
      date_created: iso(refund.date_created),
    };
  });
  const status = lower(payment.status) === 'canceled' ? 'cancelled' : lower(payment.status);
  const transaction = toCents(payment.transaction_amount);
  let refunded = toCents(payment.transaction_amount_refunded);
  if (refunded === null && detail) refunded = sumEffectiveRefunds(refunds);
  // Un pago «refunded» sin detalle ni total declarado está devuelto entero: es
  // lo que significa el estado.
  if (refunded === null && status === 'refunded') refunded = transaction;
  return {
    provider_payment_id: text(payment.id),
    external_reference: text(payment.external_reference),
    status,
    status_detail: lower(payment.status_detail),
    currency: text(payment.currency_id).toUpperCase(),
    transaction_amount_cents: transaction,
    refunded_total_cents: refunded,
    refund_detail_available: Boolean(detail),
    refunds,
    date_created: iso(payment.date_created),
    date_approved: iso(payment.date_approved),
    date_last_updated: iso(payment.date_last_updated),
    collector_id: text(payment.collector_id) || text(obj(payment.collector).id),
    live_mode: typeof payment.live_mode === 'boolean' ? payment.live_mode : null,
  };
}

function pickNormalizedPayment(payment) {
  return {
    provider_payment_id: text(payment.provider_payment_id),
    external_reference: text(payment.external_reference),
    status: lower(payment.status),
    status_detail: lower(payment.status_detail),
    currency: text(payment.currency).toUpperCase(),
    transaction_amount_cents: Number.isSafeInteger(payment.transaction_amount_cents) ? payment.transaction_amount_cents : null,
    refunded_total_cents: Number.isSafeInteger(payment.refunded_total_cents) ? payment.refunded_total_cents : null,
    refund_detail_available: Boolean(payment.refund_detail_available),
    refunds: (Array.isArray(payment.refunds) ? payment.refunds : []).map((refund) => ({
      provider_refund_id: text(obj(refund).provider_refund_id),
      amount_cents: Number.isSafeInteger(obj(refund).amount_cents) ? obj(refund).amount_cents : null,
      status: lower(obj(refund).status),
      date_created: iso(obj(refund).date_created),
    })),
    date_created: iso(payment.date_created),
    date_approved: iso(payment.date_approved),
    date_last_updated: iso(payment.date_last_updated),
    collector_id: text(payment.collector_id),
    live_mode: typeof payment.live_mode === 'boolean' ? payment.live_mode : null,
  };
}

// Un reembolso cuenta si el proveedor lo aprobó. Sin estado declarado se toma
// como aprobado: es lo que hace `paymentSnapshot` en el Edge al sumarlos.
const refundCounts = (refund) => refund.status === 'approved' || refund.status === '';
const sumEffectiveRefunds = (refunds) => refunds.filter(refundCounts).reduce((sum, refund) => sum + (refund.amount_cents || 0), 0);

function normalizeIntent(raw) {
  const row = obj(raw);
  return {
    payment_intent_id: text(row.payment_intent_id || row.id),
    checkout_session_id: textOrNull(row.checkout_session_id),
    business_id: text(row.business_id),
    order_id: textOrNull(row.order_id),
    environment: textOrNull(row.environment),
    external_reference: text(row.external_reference),
    provider_payment_id: textOrNull(row.provider_payment_id),
    provider_status: lower(row.provider_status) || null,
    provider_status_detail: lower(row.provider_status_detail) || null,
    internal_status: lower(row.internal_status),
    currency: text(row.currency).toUpperCase() || null,
    expected_cents: toCents(row.expected_amount),
    paid_cents: toCents(row.paid_amount),
    refunded_cents: toCents(row.refunded_amount) ?? 0,
    approved_at: iso(row.approved_at),
    provider_event_at: iso(row.provider_event_at),
    security_review_reason: textOrNull(row.security_review_reason),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    in_window: row.in_window !== false,
    session_status: textOrNull(row.session_status),
    session_total_cents: toCents(row.session_total),
    session_completed_order_id: textOrNull(row.session_completed_order_id),
    session_expires_at: iso(row.session_expires_at),
    approved_provider_payment_ids: uniqueTexts(row.approved_provider_payment_ids),
    request_order_ids: uniqueTexts(row.request_order_ids),
  };
}

function normalizeOrder(raw) {
  const row = obj(raw);
  return {
    order_id: text(row.order_id || row.id),
    business_id: text(row.business_id),
    public_code: textOrNull(row.public_code),
    status: lower(row.status),
    payment_method: lower(row.payment_method),
    total_cents: toCents(row.total),
    origin: textOrNull(row.origin),
    created_at: iso(row.created_at),
    in_window: row.in_window !== false,
  };
}

function normalizeRefund(raw) {
  const row = obj(raw);
  return {
    refund_id: text(row.refund_id || row.id),
    payment_intent_id: text(row.payment_intent_id),
    provider_refund_id: textOrNull(row.provider_refund_id),
    amount_cents: toCents(row.amount),
    status: lower(row.status),
    requested_at: iso(row.requested_at),
    completed_at: iso(row.completed_at),
  };
}

function normalizeDispute(raw) {
  const row = obj(raw);
  return {
    payment_intent_id: text(row.payment_intent_id),
    dispute_type: lower(row.dispute_type),
    status: lower(row.status),
    resolved_at: iso(row.resolved_at),
  };
}

const uniqueTexts = (value) => [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
const list = (value) => (Array.isArray(value) ? value : []);

function normalizeLocalRows(localRows) {
  const rows = obj(localRows);
  return {
    business_id: text(rows.business_id) || null,
    server_time: iso(rows.server_time),
    collector_id: text(obj(rows.settings).collector_id) || null,
    intents: list(rows.intents).map(normalizeIntent),
    orders: list(rows.orders).map(normalizeOrder),
    refunds: list(rows.refunds).map(normalizeRefund),
    disputes: list(rows.disputes).map(normalizeDispute),
    looked_up_references: new Set(uniqueTexts(rows.looked_up_references)),
  };
}

function normalizeProviderRows(providerRows) {
  if (providerRows === null || providerRows === undefined) return null;
  const rows = Array.isArray(providerRows) ? { payments: providerRows } : obj(providerRows);
  const coverage = obj(rows.coverage);
  const range = obj(coverage.range);
  const from = toMs(range.from);
  const to = toMs(range.to);
  return {
    payments: list(rows.payments).map(normalizeProviderPayment),
    coverage: {
      mode: text(coverage.mode) || 'unknown',
      // Sin declaración explícita de completitud, la AUSENCIA de un pago no
      // prueba nada: un resultado truncado se vería igual.
      complete: coverage.complete === true,
      range: from !== null && to !== null ? { from, to, source: text(range.source) || 'declared' } : null,
      queried_references: new Set(uniqueTexts(coverage.queriedReferences || coverage.queried_references)),
    },
  };
}

// ── Reglas ───────────────────────────────────────────────────────────────────
function moneyWeight(payment) {
  if (MONEY_HELD.includes(payment.status)) return 4;
  if (payment.status === 'refunded' || payment.status === 'charged_back') return 3;
  if (PROVIDER_STATUS_MAP[payment.status]?.money === 'in_flight') return 2;
  return 1;
}

/**
 * De todos los pagos de una referencia, el que manda. Checkout Pro deja pagar
 * varias veces la misma preferencia (PAY-01, PAY-04), así que «el último» no
 * alcanza: manda el que tiene la plata; entre iguales, el que la base ya conoce;
 * y recién después el más nuevo.
 */
export function pickAuthoritativePayment(payments, knownPaymentId = null) {
  return [...payments].sort((a, b) => {
    const weight = moneyWeight(b) - moneyWeight(a);
    if (weight) return weight;
    const known = Number(b.provider_payment_id === knownPaymentId) - Number(a.provider_payment_id === knownPaymentId);
    if (known) return known;
    return (toMs(b.date_created) ?? 0) - (toMs(a.date_created) ?? 0);
  })[0] || null;
}

// Desde cuándo el proveedor está en ese ESTADO: de ahí se mide el atraso.
// `date_last_updated` se mueve por cosas que no son el estado (la liberación de
// la plata, por ejemplo) y haría pasar por «reciente» un cobro de hace tres
// días; para un aprobado manda `date_approved`.
const providerClock = (payment) => (payment.status === 'approved'
  ? toMs(payment.date_approved) ?? toMs(payment.date_created) ?? toMs(payment.date_last_updated)
  : toMs(payment.date_last_updated) ?? toMs(payment.date_approved) ?? toMs(payment.date_created));

/**
 * Dónde está la plata de UN pago, según el proveedor.
 * `held` la tiene el vendedor · `returned` volvió al cliente (reembolso total o
 * contracargo) · `in_flight` todavía no se cobró · `none` no se cobró ni se va a
 * cobrar · `unknown` el estado no dice.
 */
export function providerMoneyPosition(payment) {
  if (payment.status === 'charged_back') return { state: 'returned', via: 'chargeback' };
  if (payment.status === 'refunded') return { state: 'returned', via: 'refund' };
  if (MONEY_HELD.includes(payment.status)) {
    const total = payment.transaction_amount_cents;
    const refunded = payment.refunded_total_cents ?? 0;
    // «approved» con todo devuelto: el estado no cambió, la plata sí.
    if (total !== null && total > 0 && refunded >= total) return { state: 'returned', via: 'refund' };
    return { state: 'held', via: null };
  }
  const money = PROVIDER_STATUS_MAP[payment.status]?.money;
  if (money === 'in_flight' || money === 'none') return { state: money, via: null };
  return { state: 'unknown', via: null };
}

function expectedInternalStatuses(payment) {
  const entry = PROVIDER_STATUS_MAP[payment.status];
  if (!entry) return [REVIEW];
  if (payment.status === 'approved') {
    const refunded = payment.refunded_total_cents ?? 0;
    if (refunded > 0 && payment.transaction_amount_cents !== null && refunded >= payment.transaction_amount_cents) return ['refunded'];
    if (refunded > 0) return ['partially_refunded'];
  }
  return [...entry.consistent];
}

/**
 * Compara el estado del proveedor con el interno.
 * Devuelve `consistent`, `lag` (atraso legítimo, todavía dentro del margen),
 * `deferred` (la diferencia la explica un reembolso y la informa
 * REFUND_MISMATCH) o `mismatch` con su motivo y gravedad.
 *
 * `hasLiveOrder`: el intent tiene un pedido que no está cancelado. Sólo cambia
 * la gravedad del contracargo sobre un intent en revisión.
 */
export function statusVerdict(intent, payment, { nowMs, lagMs, hasOpenDispute = false, hasLiveOrder = false } = {}) {
  const local = intent.internal_status;
  const expected = expectedInternalStatuses(payment);
  if (local === REVIEW) {
    // Revisión no puede pasar a `charged_back` (el rango sólo sube): la base
    // queda mostrando «en revisión» sobre plata que ya se fue. Los demás
    // estados se juzgan por la plata y el pedido, en `localChecks`.
    if (payment.status === 'charged_back') {
      return { kind: 'mismatch', severity: hasLiveOrder ? 'critical' : 'warning', reason: 'provider_charged_back_local_in_review', expected };
    }
    // Un estado que la tabla no conoce no dice dónde está la plata: que el
    // intent ya esté en revisión no lo vuelve coherente, lo deja sin mirar.
    if (!PROVIDER_STATUS_MAP[payment.status]) return { kind: 'mismatch', severity: 'warning', reason: 'unknown_provider_status', expected };
    return { kind: 'consistent', expected };
  }
  if (!PROVIDER_STATUS_MAP[payment.status]) {
    return { kind: 'mismatch', severity: 'warning', reason: 'unknown_provider_status', expected };
  }
  if (expected.includes(local)) return { kind: 'consistent', expected };

  const klass = localClass(local);
  const reference = providerClock(payment);
  const recent = reference !== null && Number.isFinite(nowMs) && nowMs - reference <= lagMs;
  const lagOr = (severity, reason) => (recent ? { kind: 'lag', expected } : { kind: 'mismatch', severity, reason, expected });
  const money = PROVIDER_STATUS_MAP[payment.status].money;
  const providerRefunded = payment.refunded_total_cents ?? 0;
  const localKnowsMoney = ['paid', 'refund', 'charged_back'].includes(klass);

  if (payment.status === 'in_mediation') {
    if (hasOpenDispute) return { kind: 'consistent', expected };
    return { kind: 'mismatch', severity: 'critical', reason: 'provider_in_mediation_local_unaware', expected };
  }
  if (payment.status === 'charged_back') {
    return { kind: 'mismatch', severity: 'critical', reason: 'provider_charged_back_local_not', expected };
  }
  if (money === 'in_flight') {
    if (klass === 'flight') {
      // `pending` enfrente e `in_process` adentro es el rango monotónico
      // haciendo su trabajo; al revés es un snapshot que todavía no llegó.
      return INTERNAL_STATUS_RANK[local] >= INTERNAL_STATUS_RANK[PROVIDER_STATUS_MAP[payment.status].writes]
        ? { kind: 'consistent', expected }
        : lagOr('warning', 'provider_in_flight_local_not_updated');
    }
    if (klass === 'pre') return lagOr('warning', 'provider_in_flight_local_not_updated');
    if (klass === 'dead') return { kind: 'mismatch', severity: 'warning', reason: 'provider_in_flight_local_closed', expected };
    return { kind: 'mismatch', severity: 'critical', reason: 'local_paid_provider_not_approved', expected };
  }
  if (money === 'none') {
    if (klass === 'pre' || klass === 'flight') return lagOr('warning', 'provider_closed_local_open');
    return { kind: 'mismatch', severity: 'critical', reason: 'local_paid_provider_not_approved', expected };
  }
  // De acá en más el proveedor dice `approved` o `refunded`.
  if (localKnowsMoney && payment.refunded_total_cents === null) {
    // Sin total de reembolsos del proveedor, REFUND_MISMATCH no puede comparar
    // nada: delegarle la diferencia sería callarla.
    return klass === 'charged_back'
      ? { kind: 'mismatch', severity: 'warning', reason: 'local_charged_back_provider_approved', expected }
      : { kind: 'mismatch', severity: 'warning', reason: 'refund_state_not_confirmed', expected };
  }
  if (localKnowsMoney && intent.refunded_cents !== providerRefunded) return { kind: 'deferred', expected };
  if (payment.status === 'refunded') {
    if (localKnowsMoney) return { kind: 'mismatch', severity: 'warning', reason: 'refund_state_differs', expected };
    return { kind: 'mismatch', severity: 'warning', reason: 'provider_refunded_local_not_paid', expected };
  }
  if (klass === 'charged_back') return { kind: 'mismatch', severity: 'warning', reason: 'local_charged_back_provider_approved', expected };
  if (klass === 'paid' || klass === 'refund') return { kind: 'mismatch', severity: 'warning', reason: 'refund_state_differs', expected };
  return lagOr('critical', 'provider_approved_local_not_paid');
}

const claimsProviderPayment = (intent) => Boolean(intent.provider_payment_id || intent.provider_status
  || intent.paid_cents !== null || intent.approved_provider_payment_ids.length
  || ['paid', 'refund', 'charged_back'].includes(localClass(intent.internal_status)));

const baseCents = (intent) => intent.paid_cents ?? intent.expected_cents;

/**
 * Dónde está la plata según lo que la base misma registró. Es lo único que hay
 * cuando no se comparó contra el proveedor; con proveedor manda
 * `providerMoneyPosition`.
 */
function localMoneyPosition(intent) {
  const klass = localClass(intent.internal_status);
  if (klass === 'charged_back') return { state: 'returned', via: 'chargeback' };
  // Antes de un cobro no hay plata que ubicar: esos estados los juzgan otras reglas.
  if (!['paid', 'refund', 'review'].includes(klass)) return { state: 'unknown', via: null };
  const stored = intent.provider_status === 'canceled' ? 'cancelled' : intent.provider_status;
  const base = baseCents(intent) ?? 0;
  if (klass === 'review' && stored === 'charged_back') return { state: 'returned', via: 'chargeback' };
  if (base > 0 && intent.refunded_cents >= base) return { state: 'returned', via: 'refund' };
  if (klass !== 'review') return { state: 'held', via: null };
  // En revisión el estado interno no dice nada: queda lo último que se guardó
  // del proveedor.
  if (stored === 'refunded') return { state: 'returned', via: 'refund' };
  if (MONEY_HELD.includes(stored) || (intent.paid_cents !== null && intent.paid_cents > 0)) return { state: 'held', via: null };
  const money = PROVIDER_STATUS_MAP[stored]?.money;
  if (money === 'in_flight' || money === 'none') return { state: money, via: null };
  return { state: 'unknown', via: null };
}

/**
 * La posición de la plata con la mejor evidencia disponible.
 * Si el grupo de pagos del proveedor no está completo, el pago visible sólo
 * prueba lo que prueba por sí mismo —que tiene la plata—: «se devolvió» o
 * «nunca se cobró» podría desmentirlo otro pago de la misma referencia que no
 * se llegó a ver.
 */
function moneyPosition(intent, compared) {
  if (!compared) return { ...localMoneyPosition(intent), evidence: 'local' };
  const position = providerMoneyPosition(compared.payment);
  if (compared.complete || position.state === 'held') return { ...position, evidence: 'provider' };
  return { state: 'unknown', via: null, evidence: 'provider' };
}

/**
 * ¿Se conoce TODO lo que el proveedor tiene para la referencia de este intent?
 * Sólo si se le preguntó por esa referencia, o si el resultado es completo y
 * cubre toda la vida de la preferencia (de la creación del intent al
 * vencimiento de la sesión: después de eso Mercado Pago no deja pagar).
 *
 * De esto dependen dos afirmaciones: que un pago NO existe, y que los pagos
 * vistos son todos. Checkout Pro deja pagar varias veces una preferencia
 * (PAY-01, PAY-04): un grupo con un pago de cada lado del borde de la ventana
 * muestra un rechazo donde hubo un cobro, o un cobro donde hubo dos.
 */
function referenceCovered(intent, coverage) {
  if (coverage.queried_references.has(intent.external_reference)) return { ok: true, by: 'reference_query' };
  if (!coverage.complete) return { ok: false, reason: 'provider_result_incomplete' };
  if (!coverage.range) return { ok: false, reason: 'provider_range_unknown' };
  const start = toMs(intent.created_at);
  const end = toMs(intent.session_expires_at) ?? toMs(intent.updated_at);
  if (start === null || end === null) return { ok: false, reason: 'local_timestamps_missing' };
  if (start >= coverage.range.from && end + PREFERENCE_LIFE_MARGIN_MINUTES * 60000 <= coverage.range.to) return { ok: true, by: 'range' };
  return { ok: false, reason: 'outside_provider_range' };
}

/**
 * Referencias que el adaptador del proveedor tiene que consultar una por una:
 * las que una búsqueda por rango `[from, to]` no alcanza a cubrir y las de
 * intents que dicen tener un pago.
 *
 * El orden importa porque el adaptador tiene un tope de consultas:
 *   1. dicen tener un pago y el rango no cubre su preferencia: sin la consulta
 *      el grupo de pagos queda incompleto y el intent no se puede conciliar;
 *   2. sin pago, fuera del rango: sin la consulta no puede afirmarse que no lo hay;
 *   3. dicen tener un pago y el rango los cubre: la consulta es una segunda
 *      confirmación, no la única.
 */
export function referencesNeedingExplicitLookup(localRows, { from, to } = {}) {
  const local = normalizeLocalRows(localRows);
  const range = { from: toMs(from), to: toMs(to) };
  const coverage = { complete: range.from !== null && range.to !== null, range, queried_references: new Set() };
  const claimedUncovered = [];
  const uncovered = [];
  const claimedCovered = [];
  for (const intent of local.intents) {
    if (!INTEGRATION_REFERENCE.test(intent.external_reference)) continue;
    const covered = referenceCovered(intent, coverage).ok;
    if (claimsProviderPayment(intent)) (covered ? claimedCovered : claimedUncovered).push(intent.external_reference);
    else if (!covered) uncovered.push(intent.external_reference);
  }
  return [...new Set([...claimedUncovered, ...uncovered, ...claimedCovered])];
}

// ── Clasificación ────────────────────────────────────────────────────────────
/**
 * @param localRows    filas locales normalizadas (ver `sources.mjs`)
 * @param providerRows `null` (sin proveedor) o `{ payments, coverage }`
 * @param options      `{ businessId, now, lagMinutes, refundStuckMinutes, environment }`
 * @returns `{ findings, totals, coverage }`
 *
 * Tres cosas que esta función NO supone y quien la llame directo tiene que saber:
 *   · que los pagos entregados sean todos: lo dice `coverage` (`complete` con un
 *     `range`, o `queriedReferences`). Sin eso un intent se compara, a lo sumo,
 *     en parte, y nunca cuenta como conciliado;
 *   · que un pago del proveedor sin intent en `localRows` no exista en la base:
 *     PAYMENT_MISSING_LOCAL es crítico sólo para las referencias listadas en
 *     `localRows.looked_up_references` (las que se buscaron sin límite de
 *     fecha, como hace `reconcile()`); para el resto es una advertencia;
 *   · que un campo ausente coincida: sin moneda o sin datos de reembolsos del
 *     proveedor, el intent sale como UNVERIFIED_AGAINST_PROVIDER.
 */
export function classify(localRows, providerRows, options = {}) {
  const local = normalizeLocalRows(localRows);
  const provider = normalizeProviderRows(providerRows);
  const nowMs = toMs(options.now) ?? toMs(local.server_time) ?? Date.now();
  const ctx = {
    businessId: text(options.businessId) || local.business_id || null,
    nowMs,
    lagMinutes: positive(options.lagMinutes, DEFAULT_LAG_MINUTES),
    refundStuckMinutes: positive(options.refundStuckMinutes, DEFAULT_REFUND_STUCK_MINUTES),
    environment: textOrNull(options.environment),
  };
  ctx.lagMs = ctx.lagMinutes * 60000;
  ctx.stats = { refund_totals_not_comparable: 0 };
  ctx.refundStuckMs = ctx.refundStuckMinutes * 60000;

  const findings = [];
  const ordersById = new Map(local.orders.map((order) => [order.order_id, order]));
  const refundsByIntent = groupBy(local.refunds, (refund) => refund.payment_intent_id);
  const disputesByIntent = groupBy(local.disputes, (dispute) => dispute.payment_intent_id);
  const intentsByReference = new Map(local.intents.map((intent) => [intent.external_reference, intent]));
  const intentsByPaymentId = new Map(local.intents.filter((intent) => intent.provider_payment_id)
    .map((intent) => [intent.provider_payment_id, intent]));
  const intentsByOrder = new Map();
  for (const intent of local.intents) {
    for (const orderId of linkedOrderIds(intent)) {
      if (!intentsByOrder.has(orderId)) intentsByOrder.set(orderId, []);
      intentsByOrder.get(orderId).push(intent);
    }
  }

  const push = (entry) => findings.push(buildFinding(ctx, entry));

  // ── Pagos del proveedor: de quién es cada uno ──────────────────────────────
  const groups = new Map();
  const orphans = [];
  const providerStats = { total: 0, in_scope: 0, out_of_scope: 0, collector_mismatch: 0 };
  for (const payment of provider?.payments || []) {
    providerStats.total += 1;
    if (local.collector_id && payment.collector_id && payment.collector_id !== local.collector_id) providerStats.collector_mismatch += 1;
    const byReference = intentsByReference.get(payment.external_reference);
    const byId = intentsByPaymentId.get(payment.provider_payment_id);
    if (!byReference && byId) {
      // La base ató este pago a un intent cuya referencia es otra. El snapshot
      // lo habría rechazado (`external_reference_mismatch`): que exista es grave.
      providerStats.in_scope += 1;
      push({
        code: 'STATUS_MISMATCH', reason: 'external_reference_differs', severity: 'critical', intent: byId, payment,
        order: ordersById.get(byId.order_id),
        // La referencia del proveedor es texto libre de otra integración: sólo
        // se copia si tiene el formato de ésta.
        facts: { ...statusFacts(byId, payment), local_external_reference: byId.external_reference,
          provider_external_reference: INTEGRATION_REFERENCE.test(payment.external_reference) ? payment.external_reference : null,
          provider_external_reference_in_scope: INTEGRATION_REFERENCE.test(payment.external_reference) },
        explanation: 'El pago que la base asocia a este intent figura en Mercado Pago con otra referencia externa.',
      });
      // El pago existe y es el que la base conoce: se compara igual (estado,
      // importe, reembolsos) en vez de informarlo además como faltante.
      if (!groups.has(byId.external_reference)) groups.set(byId.external_reference, []);
      groups.get(byId.external_reference).push(payment);
      continue;
    }
    if (!INTEGRATION_REFERENCE.test(payment.external_reference)) { providerStats.out_of_scope += 1; continue; }
    providerStats.in_scope += 1;
    if (byReference) {
      if (!groups.has(payment.external_reference)) groups.set(payment.external_reference, []);
      groups.get(payment.external_reference).push(payment);
    } else {
      orphans.push(payment);
    }
  }

  // ── PAYMENT_MISSING_LOCAL ──────────────────────────────────────────────────
  for (const [reference, payments] of groupBy(orphans, (payment) => payment.external_reference)) {
    const lookedUp = local.looked_up_references.has(reference);
    for (const payment of payments) {
      const money = PROVIDER_STATUS_MAP[payment.status]?.money;
      if (money === 'none') continue; // un rechazo sin intent no movió plata ni stock
      const serious = MONEY_HELD.includes(payment.status) || payment.status === 'charged_back' || payment.status === 'authorized';
      push({
        code: 'PAYMENT_MISSING_LOCAL',
        reason: lookedUp ? 'no_local_intent' : 'no_local_intent_in_window',
        // Sin la búsqueda por referencia sólo se sabe que no está en la ventana.
        severity: serious && lookedUp ? 'critical' : 'warning',
        payment,
        facts: { ...providerFacts(payment), local_lookup: lookedUp ? 'by_reference' : 'window_only' },
        explanation: lookedUp
          ? `Mercado Pago tiene un pago «${payment.status}» con una referencia de esta integración y ningún intent de este negocio la usa.`
          : `Mercado Pago tiene un pago «${payment.status}» con una referencia de esta integración que no está entre los intents de la ventana consultada.`,
      });
    }
    const held = payments.filter((payment) => MONEY_HELD.includes(payment.status));
    if (held.length >= 2) {
      push({
        code: 'ORDER_PAYMENT_MISMATCH', reason: 'duplicate_approved_payment', severity: 'critical', payment: held[0],
        facts: { external_reference: reference, provider_payments: held.map(paymentBrief), evidence: 'provider' },
        explanation: `Hay ${held.length} pagos cobrados en Mercado Pago para una misma referencia: es un doble cobro.`,
      });
    }
  }

  // ── Cada intent local ──────────────────────────────────────────────────────
  const verification = new Map();
  const lagTolerated = new Set();
  for (const intent of local.intents) {
    const order = ordersById.get(intent.order_id) || ordersById.get(intent.session_completed_order_id)
      || ordersById.get(intent.request_order_ids[0]) || null;
    const refunds = refundsByIntent.get(intent.payment_intent_id) || [];
    const disputes = disputesByIntent.get(intent.payment_intent_id) || [];
    const group = provider ? groups.get(intent.external_reference) || [] : [];
    let compared = null;

    if (!provider) {
      verification.set(intent.payment_intent_id, { state: 'unverified', reason: 'no_provider_data' });
    } else if (ctx.environment && intent.environment && intent.environment !== ctx.environment) {
      // Un token de un ambiente no ve los pagos del otro: compararlos sería
      // fabricar PAYMENT_MISSING_PROVIDER.
      verification.set(intent.payment_intent_id, { state: 'unverified', reason: 'environment_not_covered' });
    } else if (group.length) {
      const covered = referenceCovered(intent, provider.coverage);
      const payment = pickAuthoritativePayment(group, intent.provider_payment_id);
      if (covered.ok) {
        compared = compareWithProvider({ ctx, intent, order, refunds, disputes, group, payment, complete: true, push, lagTolerated });
        // Un dato que el proveedor no trajo no es un dato que coincide: lo
        // comparado vale, pero el intent no queda conciliado.
        verification.set(intent.payment_intent_id, compared.gaps.length
          ? { state: 'unverified', reason: compared.gaps[0], reasons: compared.gaps, partial: true }
          : { state: 'compared' });
      } else {
        // Grupo incompleto: sólo se compara contra un pago que cobró (lo que
        // dice de sí mismo vale aunque haya otros). Un rechazo o un pendiente
        // a la vista no prueban nada mientras pueda haber un cobro sin ver.
        const anchored = moneyWeight(payment) >= 3;
        if (anchored) compared = compareWithProvider({ ctx, intent, order, refunds, disputes, group, payment, complete: false, push, lagTolerated });
        verification.set(intent.payment_intent_id, {
          state: 'unverified', reason: 'provider_group_incomplete', reasons: ['provider_group_incomplete', ...(compared?.gaps || [])],
          partial: anchored, detail: covered.reason,
        });
      }
    } else {
      const absence = referenceCovered(intent, provider.coverage);
      if (!absence.ok) {
        verification.set(intent.payment_intent_id, { state: 'unverified', reason: absence.reason });
      } else if (claimsProviderPayment(intent)) {
        verification.set(intent.payment_intent_id, { state: 'missing_at_provider' });
        const paidLocally = ['paid', 'refund', 'charged_back'].includes(localClass(intent.internal_status)) || localMoneyPosition(intent).state === 'held';
        push({
          code: 'PAYMENT_MISSING_PROVIDER', reason: 'no_provider_record', severity: paidLocally ? 'critical' : 'warning', intent, order,
          facts: { ...localFacts(intent), absence_established_by: absence.by },
          explanation: paidLocally
            ? 'La base da este pago por cobrado y Mercado Pago no devuelve ningún pago para su referencia.'
            : 'La base registra un pago del proveedor para este intent y Mercado Pago no devuelve ninguno para su referencia.',
        });
      } else {
        verification.set(intent.payment_intent_id, { state: 'no_payment_expected' });
      }
    }

    localChecks({ ctx, intent, order, refunds, compared, group: provider ? group : null, ordersById, push, lagTolerated });
  }

  // ── Pedidos: coherencia interna, no necesita al proveedor ──────────────────
  for (const order of local.orders) {
    if (order.payment_method !== 'mercadopago') continue;
    const linked = intentsByOrder.get(order.order_id) || [];
    const backing = linked.filter((intent) => ['paid', 'refund', 'charged_back', 'review'].includes(localClass(intent.internal_status)));
    if (!backing.length) {
      push({
        code: 'ORDER_PAYMENT_MISMATCH', reason: 'mercadopago_order_without_paid_intent', severity: 'critical', order, intent: linked[0],
        facts: { ...orderFacts(order), linked_intents: linked.map((intent) => ({ payment_intent_id: intent.payment_intent_id, internal_status: intent.internal_status })) },
        explanation: 'El pedido figura pagado con Mercado Pago y ningún intent aprobado lo respalda.',
      });
    }
    if (linked.length >= 2) {
      push({
        code: 'ORDER_PAYMENT_MISMATCH', reason: 'multiple_intents_for_one_order', severity: 'warning', order, intent: linked[0],
        facts: { ...orderFacts(order), payment_intent_ids: linked.map((intent) => intent.payment_intent_id) },
        explanation: 'Más de un intent de pago apunta al mismo pedido.',
      });
    }
  }

  // ── Lo que no se pudo comparar se dice, intent por intent ──────────────────
  for (const intent of local.intents) {
    const state = verification.get(intent.payment_intent_id);
    if (state.state !== 'unverified') continue;
    push({
      code: UNVERIFIED_CODE, reason: state.reason, severity: 'info', intent, order: ordersById.get(intent.order_id),
      facts: {
        ...localFacts(intent), unverified_reasons: state.reasons || [state.reason], partially_compared: Boolean(state.partial),
        ...(state.detail ? { provider_group_incomplete_because: state.detail } : {}),
      },
      explanation: UNVERIFIED_TEXT[state.reason] || 'Este pago no se comparó contra el proveedor.',
    });
  }

  const sorted = sortFindings(findings);
  return {
    findings: sorted,
    totals: buildTotals(local, providerStats, sorted),
    coverage: buildCoverage({ local, provider, verification, lagTolerated, findings: sorted, providerStats, stats: ctx.stats }),
  };
}

const UNVERIFIED_TEXT = Object.freeze({
  no_provider_data: 'No se entregaron datos del proveedor: este pago no se comparó contra Mercado Pago.',
  environment_not_covered: 'El intent es de otro ambiente que el consultado en el proveedor: no se comparó.',
  provider_result_incomplete: 'El resultado del proveedor está incompleto y no trae este pago: no puede afirmarse que falte.',
  provider_range_unknown: 'No se conoce el rango de fechas que cubre el resultado del proveedor: no puede afirmarse que el pago falte.',
  outside_provider_range: 'La vida de este checkout queda fuera del rango consultado al proveedor: no se comparó.',
  local_timestamps_missing: 'Faltan las fechas locales para ubicar este pago en el rango consultado: no se comparó.',
  provider_group_incomplete: 'No puede afirmarse que los pagos vistos del proveedor sean todos los de esta referencia (no se la consultó y el rango no cubre la vida de su preferencia): un segundo cobro o el cobro verdadero pueden haber quedado fuera. No se da por conciliado.',
  provider_refund_data_missing: 'El pago del proveedor no trae total ni detalle de reembolsos: estado e importe se compararon, los reembolsos no. No se da por conciliado.',
  provider_currency_missing: 'El pago del proveedor no trae la moneda: el importe se comparó sin poder confirmar que sea la misma moneda. No se da por conciliado.',
});

/**
 * Compara un intent con `payment`, el pago que manda dentro de `group`.
 * `complete` dice si `group` son TODOS los pagos de la referencia; si no, las
 * conclusiones que dependen de que no haya otro pago se omiten.
 */
function compareWithProvider({ ctx, intent, order, refunds, disputes, group, payment, complete, push, lagTolerated }) {
  const held = group.filter((candidate) => MONEY_HELD.includes(candidate.status));
  const result = { payment, complete, gaps: [], refundTotalKnown: true };

  if (held.length >= 2) {
    push({
      code: 'ORDER_PAYMENT_MISMATCH', reason: 'duplicate_approved_payment', severity: 'critical', intent, payment, order,
      facts: { external_reference: intent.external_reference, provider_payments: held.map(paymentBrief), evidence: 'provider' },
      explanation: `Hay ${held.length} pagos cobrados en Mercado Pago para la misma referencia: el cliente pagó más de una vez un solo pedido.`,
    });
  }

  // Identidad: qué pago cree la base que es el suyo.
  if (intent.provider_payment_id && intent.provider_payment_id !== payment.provider_payment_id) {
    const known = group.some((candidate) => candidate.provider_payment_id === intent.provider_payment_id);
    // Con el grupo incompleto, que el id no esté a la vista no dice que no exista.
    if (!known && complete) {
      push({
        code: 'PAYMENT_MISSING_PROVIDER', reason: 'claimed_payment_id_not_returned', severity: 'warning', intent, payment, order,
        facts: { ...statusFacts(intent, payment), local_provider_payment_id: intent.provider_payment_id, provider_payment_ids: group.map((candidate) => candidate.provider_payment_id) },
        explanation: 'El identificador de pago guardado en el intent no está entre los pagos que Mercado Pago devuelve para su referencia.',
      });
    } else if (known && moneyWeight(payment) >= 3) {
      // PAY-04: un segundo pago pisó la identidad. Los reembolsos del panel
      // saldrían contra el pago equivocado.
      push({
        code: 'STATUS_MISMATCH', reason: 'local_identity_not_authoritative', severity: 'warning', intent, payment, order,
        facts: { ...statusFacts(intent, payment), local_provider_payment_id: intent.provider_payment_id },
        explanation: 'El intent apunta a un pago que no es el que tiene la plata: un reembolso desde el panel saldría contra el pago equivocado.',
      });
    }
  }

  // Estado.
  const hasOpenDispute = disputes.some((dispute) => !dispute.resolved_at && !['closed', 'resolved', 'cancelled'].includes(dispute.status));
  const hasLiveOrder = Boolean(order) && !ORDER_CLOSED.includes(order.status);
  const verdict = statusVerdict(intent, payment, { nowMs: ctx.nowMs, lagMs: ctx.lagMs, hasOpenDispute, hasLiveOrder });
  if (verdict.kind === 'lag') lagTolerated.add(intent.payment_intent_id);
  if (verdict.kind === 'mismatch') {
    push({
      code: 'STATUS_MISMATCH', reason: verdict.reason, severity: verdict.severity, intent, payment, order,
      facts: {
        ...statusFacts(intent, payment),
        expected_internal_statuses: verdict.expected,
        minutes_since_provider_update: minutesBetween(providerClock(payment), ctx.nowMs),
        lag_minutes_allowed: ctx.lagMinutes,
      },
      explanation: STATUS_TEXT[verdict.reason](payment.status, intent.internal_status),
    });
  }

  // Lo que el proveedor NO trajo. Un campo ausente (export recortado, fila
  // armada a mano) no es un campo que coincide.
  if (!payment.currency) result.gaps.push('provider_currency_missing');
  result.refundTotalKnown = compareRefunds({ ctx, intent, order, refunds, group, payment, complete, push });
  if (!result.refundTotalKnown) result.gaps.push('provider_refund_data_missing');
  return result;
}

const STATUS_TEXT = Object.freeze({
  unknown_provider_status: (provider) => `Mercado Pago informa un estado que la base no conoce («${provider}»).`,
  provider_in_mediation_local_unaware: (provider, local) => `El pago está en mediación en Mercado Pago y la base sigue en «${local}» sin disputa abierta: hay plata en riesgo que el panel no muestra.`,
  provider_charged_back_local_not: (provider, local) => `Mercado Pago informa un contracargo y la base sigue en «${local}».`,
  provider_in_flight_local_not_updated: (provider, local) => `Mercado Pago tiene el pago en curso («${provider}») y la base no lo registró («${local}») pasado el margen de atraso.`,
  provider_in_flight_local_closed: (provider, local) => `Mercado Pago todavía tiene el pago en curso («${provider}») y la base ya cerró el checkout («${local}»): si se aprueba, cae en revisión manual.`,
  provider_closed_local_open: (provider, local) => `Mercado Pago cerró el pago sin cobrar («${provider}») y la base lo sigue esperando («${local}»).`,
  local_paid_provider_not_approved: (provider, local) => `La base da el pago por cobrado («${local}») y en Mercado Pago está «${provider}».`,
  provider_approved_local_not_paid: (provider, local) => `Mercado Pago cobró el pago y la base no lo registró («${local}») pasado el margen de atraso: cliente cobrado sin que el sistema lo sepa.`,
  provider_refunded_local_not_paid: (provider, local) => `Mercado Pago cobró y devolvió este pago, y la base nunca lo registró («${local}»).`,
  provider_charged_back_local_in_review: (provider, local) => `Mercado Pago informa un contracargo y el intent quedó en «${local}», que no puede reflejarlo: la plata ya no está y el panel sigue mostrando una revisión pendiente.`,
  refund_state_differs: (provider, local) => `Los importes reembolsados coinciden, pero el estado interno («${local}») no es el que corresponde al estado del proveedor («${provider}»).`,
  refund_state_not_confirmed: (provider, local) => `El estado interno («${local}») no es el que corresponde a «${provider}» y el pago del proveedor no trae datos de reembolsos con que explicarlo: la diferencia queda sin confirmar.`,
  local_charged_back_provider_approved: (provider, local) => `La base registra un contracargo («${local}») y en Mercado Pago el pago está «${provider}».`,
});

/**
 * Devuelve `false` cuando los reembolsos importaban y el proveedor no trajo con
 * qué compararlos: quien llama no puede dar ese intent por conciliado.
 */
function compareRefunds({ ctx, intent, order, refunds, group, payment, complete, push }) {
  const klass = localClass(intent.internal_status);
  const relevant = ['paid', 'refund', 'charged_back', 'review'].includes(klass) || refunds.length > 0;
  if (!relevant) return true;
  const providerRefunds = new Map();
  for (const candidate of group) {
    for (const refund of candidate.refunds) {
      if (refund.provider_refund_id) providerRefunds.set(refund.provider_refund_id, { ...refund, provider_payment_id: candidate.provider_payment_id });
    }
  }
  const detail = group.every((candidate) => candidate.refund_detail_available);
  const providerTotal = payment.refunded_total_cents;
  // Sin total ni detalle de reembolsos del lado del proveedor no hay nada que
  // comparar. Sólo importa en un pago que cobró: uno rechazado o pendiente no
  // tiene qué devolver.
  const comparable = providerTotal !== null || moneyWeight(payment) < 3;
  if (!comparable) ctx.stats.refund_totals_not_comparable += 1;
  const totalsAgree = providerTotal !== null && providerTotal === intent.refunded_cents;
  const localIds = new Set(refunds.map((refund) => refund.provider_refund_id).filter(Boolean));
  const base = { intent, payment, order };

  for (const refund of refunds) {
    const remote = refund.provider_refund_id ? providerRefunds.get(refund.provider_refund_id) : null;
    const facts = { ...refundFacts(refund), provider_refund: remote ? { amount: amount(remote.amount_cents), status: remote.status || null, date_created: remote.date_created } : null };
    if (refund.status === 'approved' && refund.provider_refund_id && detail) {
      if (!remote) {
        // Con el grupo incompleto el reembolso puede estar en un pago que no se vio.
        if (complete) {
          push({ ...base, code: 'REFUND_MISMATCH', reason: 'local_refund_missing_at_provider', severity: 'critical', facts,
            explanation: 'La base registra un reembolso aprobado que Mercado Pago no tiene en ese pago.' });
        }
      } else if (remote.amount_cents !== refund.amount_cents) {
        push({ ...base, code: 'REFUND_MISMATCH', reason: 'refund_amount_differs', severity: 'critical', facts,
          explanation: 'El reembolso existe en ambos lados con importes distintos.' });
      } else if (!refundCounts(remote)) {
        push({ ...base, code: 'REFUND_MISMATCH', reason: 'refund_status_differs', severity: remote.status === 'in_process' ? 'warning' : 'critical', facts,
          explanation: `La base da el reembolso por aprobado y en Mercado Pago está «${remote.status}».` });
      }
    } else if (remote && refundCounts(remote) && refund.status !== 'approved') {
      const young = REFUND_OPEN.includes(refund.status) && isYoung(refund.requested_at, ctx.nowMs, ctx.refundStuckMs);
      if (!young) {
        push({ ...base, code: 'REFUND_MISMATCH', reason: 'refund_status_differs', severity: 'critical', facts,
          explanation: `Mercado Pago aprobó el reembolso y la base lo tiene en «${refund.status}».` });
      }
    }
  }

  for (const [id, remote] of providerRefunds) {
    if (localIds.has(id) || !refundCounts(remote)) continue;
    push({
      ...base, code: 'REFUND_MISMATCH', reason: 'provider_refund_not_recorded_locally',
      // Un reembolso hecho en el panel de Mercado Pago no crea fila local: si el
      // total del intent ya lo refleja, es sólo un aviso.
      severity: totalsAgree ? 'info' : 'warning',
      facts: { provider_refund_id: id, provider_refund_payment_id: remote.provider_payment_id, amount: amount(remote.amount_cents), status: remote.status || null,
        date_created: remote.date_created, intent_refunded_total_matches: totalsAgree },
      explanation: 'Mercado Pago tiene un reembolso que no está en `payment_refunds` (por ejemplo, hecho desde el panel de Mercado Pago).',
    });
  }

  // Un contracargo devuelve la plata por otra vía: no es un reembolso y lo
  // informa STATUS_MISMATCH. Comparar totales ahí sería contar dos veces.
  // Con el grupo incompleto sólo vale la diferencia que el pago visible prueba
  // solo: que el proveedor devolvió MÁS de lo que la base sabe.
  const provable = complete || (providerTotal !== null && providerTotal > intent.refunded_cents);
  if (providerTotal !== null && !totalsAgree && payment.status !== 'charged_back' && provable) {
    push({
      ...base, code: 'REFUND_MISMATCH', reason: 'refunded_total_differs', severity: 'critical',
      facts: {
        provider_refunded_total: amount(providerTotal), local_intent_refunded_amount: amount(intent.refunded_cents),
        local_approved_refunds_total: amount(sumApprovedLocal(refunds)), provider_status: payment.status, local_internal_status: intent.internal_status,
        refund_detail_available: detail,
      },
      explanation: 'El total reembolsado en Mercado Pago no coincide con el que registra la base para este pago.',
    });
  }
  return comparable;
}

const sumApprovedLocal = (refunds) => refunds.filter((refund) => refund.status === 'approved').reduce((sum, refund) => sum + (refund.amount_cents || 0), 0);
const isYoung = (at, nowMs, windowMs) => { const ms = toMs(at); return ms !== null && nowMs - ms <= windowMs; };

/**
 * Coherencia del intent con su pedido, sus importes y sus reembolsos.
 * `compared` es la comparación contra el proveedor (o `null` si no hubo);
 * `group` son los pagos del proveedor vistos para la referencia (`null` si no
 * se entregaron datos del proveedor).
 */
function localChecks({ ctx, intent, order, refunds, compared, group, ordersById, push, lagTolerated }) {
  const klass = localClass(intent.internal_status);
  const payment = compared?.payment || null;
  const base = { intent, payment, order };
  const stored = intent.provider_status === 'canceled' ? 'cancelled' : intent.provider_status;
  const position = moneyPosition(intent, compared);

  // ── Importes: un solo hallazgo por intent, con todas las diferencias ───────
  const differences = [];
  if (payment) {
    if (payment.currency && intent.currency && payment.currency !== intent.currency) differences.push('currency');
    if (payment.transaction_amount_cents === null) differences.push('provider_amount_missing');
    else if (payment.transaction_amount_cents !== intent.expected_cents) differences.push('transaction_amount_vs_expected');
    if (moneyWeight(payment) >= 3 && intent.paid_cents !== null && payment.transaction_amount_cents !== null
      && intent.paid_cents !== payment.transaction_amount_cents) differences.push('paid_amount_vs_transaction');
  }
  const localPaidEvidence = intent.provider_status === 'approved' || ['paid', 'refund', 'charged_back'].includes(klass);
  if (localPaidEvidence && intent.paid_cents !== null && intent.paid_cents !== intent.expected_cents) differences.push('paid_amount_vs_expected');
  if (baseCents(intent) !== null && intent.refunded_cents > baseCents(intent)) differences.push('refunded_exceeds_paid');
  if (differences.length) {
    const moneyMoved = (payment && moneyWeight(payment) >= 3) || localPaidEvidence;
    const providerNet = payment && payment.transaction_amount_cents !== null ? payment.transaction_amount_cents - (payment.refunded_total_cents ?? 0) : null;
    push({
      ...base, code: 'AMOUNT_MISMATCH', reason: differences[0],
      severity: moneyMoved || differences.includes('currency') || differences.includes('refunded_exceeds_paid') ? 'critical' : 'warning',
      facts: {
        differences,
        provider_transaction_amount: payment ? amount(payment.transaction_amount_cents) : null,
        provider_currency: payment ? payment.currency || null : null,
        provider_refunded_total: payment ? amount(payment.refunded_total_cents) : null,
        provider_net_amount: amount(providerNet),
        local_expected_amount: amount(intent.expected_cents), local_paid_amount: amount(intent.paid_cents),
        local_refunded_amount: amount(intent.refunded_cents), local_currency: intent.currency,
        local_net_amount: baseCents(intent) === null ? null : amount(baseCents(intent) - intent.refunded_cents),
        provider_status: payment ? payment.status : null, local_internal_status: intent.internal_status,
      },
      explanation: `El importe o la moneda no coinciden (${differences.join(', ')}).`,
    });
  }

  // ── Estado guardado contra estado interno, cuando no hubo proveedor ────────
  if (!payment && klass === 'review' && stored === 'charged_back') {
    // El mismo caso que con proveedor, visto en lo que la base guardó: el
    // snapshot anotó el contracargo y el estado interno no pudo seguirlo.
    const live = Boolean(order) && !ORDER_CLOSED.includes(order.status);
    push({
      ...base, code: 'STATUS_MISMATCH', reason: 'provider_charged_back_local_in_review', severity: live ? 'critical' : 'warning',
      facts: { ...localFacts(intent), evidence: 'local_snapshot' },
      explanation: STATUS_TEXT.provider_charged_back_local_in_review(stored, intent.internal_status),
    });
  }
  if (!payment && intent.provider_status && klass !== 'review') {
    const money = PROVIDER_STATUS_MAP[stored]?.money;
    let contradiction = null;
    if (stored === 'approved' && ['pre', 'flight', 'dead'].includes(klass)) contradiction = 'critical';
    else if ((money === 'in_flight' || money === 'none') && ['paid', 'refund', 'charged_back'].includes(klass)) contradiction = 'warning';
    else if (stored === 'refunded' && klass === 'paid') contradiction = 'warning';
    else if (stored === 'charged_back' && klass !== 'charged_back') contradiction = 'warning';
    if (contradiction) {
      push({
        ...base, code: 'STATUS_MISMATCH', reason: 'local_snapshot_contradiction', severity: contradiction,
        facts: localFacts(intent),
        explanation: `El último estado del proveedor guardado en el intent («${stored}») contradice su estado interno («${intent.internal_status}»).`,
      });
    }
  }

  // ── Pago cobrado sin pedido ────────────────────────────────────────────────
  const linked = linkedOrderIds(intent);
  const held = position.state === 'held';
  if (!linked.length && held && ['paid', 'review'].includes(klass)) {
    // `approved_order_pending` dura lo que tarda finalize: recién pasado el
    // margen es un cobro sin pedido.
    const since = toMs(intent.approved_at) ?? toMs(intent.updated_at);
    const settling = intent.internal_status !== 'completed' && klass === 'paid' && since !== null && ctx.nowMs - since <= ctx.lagMs;
    if (settling) lagTolerated.add(intent.payment_intent_id);
    else {
      push({
        ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: klass === 'review' ? 'charged_without_order_in_review' : 'paid_intent_without_order',
        severity: 'critical',
        facts: { ...localFacts(intent), money_evidence: position.evidence,
          minutes_since_approval: minutesBetween(since, ctx.nowMs), lag_minutes_allowed: ctx.lagMinutes },
        explanation: klass === 'review'
          ? 'El cliente está cobrado, el intent quedó en revisión de seguridad y no hay pedido: hay que armar el pedido o devolver la plata.'
          : 'El intent figura cobrado y no tiene pedido asociado.',
      });
    }
  } else if (!linked.length && klass === 'review' && !payment && intent.refunded_cents === 0 && position.state !== 'returned') {
    push({
      ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'review_without_order_money_unknown', severity: 'warning',
      facts: localFacts(intent),
      explanation: 'El intent está en revisión de seguridad sin pedido y la base no guardó si el pago se cobró: hay que mirarlo en Mercado Pago.',
    });
  }

  // ── Vínculo intent ↔ pedido ────────────────────────────────────────────────
  if (linked.length >= 2) {
    push({
      ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'multiple_orders_for_one_intent', severity: 'critical',
      facts: { ...localFacts(intent), order_ids: linked, session_completed_order_id: intent.session_completed_order_id },
      explanation: 'Un mismo pago quedó asociado a más de un pedido.',
    });
  } else if (linked.length === 1 && !intent.order_id) {
    push({
      ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'order_not_linked_to_intent', severity: 'warning',
      order: ordersById.get(linked[0]) || order,
      facts: { ...localFacts(intent), order_ids: linked, session_completed_order_id: intent.session_completed_order_id },
      explanation: 'La sesión de checkout tiene un pedido que el intent de pago no referencia.',
    });
  }

  if (order) {
    const paid = baseCents(intent);
    if (order.total_cents !== null && paid !== null && order.total_cents !== paid) {
      push({
        ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'order_total_differs_from_payment', severity: 'critical',
        facts: { ...orderFacts(order), local_expected_amount: amount(intent.expected_cents), local_paid_amount: amount(intent.paid_cents) },
        explanation: 'El total del pedido no coincide con el importe del pago.',
      });
    }
    const closed = ORDER_CLOSED.includes(order.status);
    const delivered = order.status === 'delivered';
    const knowsMoney = ['paid', 'refund', 'charged_back', 'review'].includes(klass);
    const moneyFacts = { ...orderFacts(order), ...localFacts(intent), money_position: position.state, money_returned_via: position.via,
      money_evidence: position.evidence, provider_status: payment ? payment.status : null,
      provider_refunded_total: payment ? amount(payment.refunded_total_cents) : null };
    // PAY-05: un pago ya completado que cayó en revisión no tiene salida ni
    // reembolso desde el panel. Es un callejón interno: se avisa con o sin
    // datos del proveedor.
    if (klass === 'review' && held) {
      push({
        ...base, code: 'STATUS_MISMATCH', reason: 'captured_payment_in_review_with_order', severity: 'warning',
        facts: { ...(payment ? statusFacts(intent, payment) : localFacts(intent)), security_review_reason: intent.security_review_reason, money_evidence: position.evidence },
        explanation: 'El pago está cobrado y tiene pedido, pero el intent quedó en revisión de seguridad: desde el panel no se puede reembolsar ni cancelar.',
      });
    }
    // Pedido cancelado con la plata todavía en la cuenta del vendedor. Si el
    // proveedor ya muestra la devolución completa, la diferencia es de registro
    // local y la informa REFUND_MISMATCH.
    if (closed && held && knowsMoney) {
      push({
        ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'cancelled_order_payment_not_refunded', severity: 'critical',
        facts: moneyFacts,
        explanation: 'El pedido está cancelado o rechazado y el pago sigue cobrado sin devolución completa.',
      });
    }
    // Pedido vivo sobre plata que ya volvió al cliente. Se mira la PLATA
    // (importes y estado del proveedor), no el estado interno: un intent
    // «completed» o en revisión con todo devuelto es el mismo problema (PAY-02).
    if (!closed && knowsMoney && position.state === 'returned') {
      if (!delivered) {
        push({
          ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'active_order_payment_reversed', severity: 'critical',
          facts: moneyFacts,
          explanation: 'El pago está devuelto o con contracargo y el pedido sigue activo: puede entregarse mercadería sin cobro.',
        });
      } else if (klass === 'review' && position.via === 'refund') {
        // Entregado y devuelto con el estado bien registrado es un reembolso
        // posventa normal. En revisión no: la base no puede mostrarlo (el pago
        // del pedido figura «pendiente») y nadie más lo va a mirar. El
        // contracargo en revisión ya salió como STATUS_MISMATCH.
        push({
          ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'delivered_order_payment_reversed', severity: 'critical',
          facts: moneyFacts,
          explanation: 'El pedido se entregó, la plata se devolvió y el intent quedó en revisión de seguridad: la base no refleja la devolución.',
        });
      }
    }
    // En revisión con pedido vivo y un pago que nunca se cobró: el pedido no
    // tiene plata detrás. Fuera de revisión esto mismo lo informa STATUS_MISMATCH.
    if (!closed && klass === 'review' && (position.state === 'none' || position.state === 'in_flight')) {
      push({
        ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'order_payment_not_captured', severity: 'critical',
        facts: moneyFacts,
        explanation: 'El intent está en revisión de seguridad con un pedido vivo y el pago no está cobrado: el pedido no tiene plata detrás.',
      });
    }
  }

  // ── Doble cobro según los eventos locales ──────────────────────────────────
  // Los eventos `payment.approved` nombran cada pago que se aprobó para este
  // intent. Dos o más es un posible doble cobro (PAY-04a), y sólo lo desmiente
  // el proveedor mostrando TODOS esos pagos con, a lo sumo, uno reteniendo la
  // plata. Un grupo al que le falta uno no desmiente nada: comparar contra el
  // que se ve y callar era dar por conciliado un doble cobro.
  const approvedIds = intent.approved_provider_payment_ids;
  if (approvedIds.length >= 2) {
    const visible = group || [];
    const unaccounted = approvedIds.filter((id) => !visible.some((candidate) => candidate.provider_payment_id === id));
    const holding = visible.filter((candidate) => MONEY_HELD.includes(candidate.status)).length;
    // Con dos reteniendo la plata, el doble cobro ya salió con evidencia del proveedor.
    if (unaccounted.length && holding < 2) {
      push({
        ...base, code: 'ORDER_PAYMENT_MISMATCH', reason: 'duplicate_approved_payment', severity: 'critical',
        facts: { ...localFacts(intent), approved_provider_payment_ids: approvedIds, unaccounted_provider_payment_ids: unaccounted,
          provider_payment_ids_seen: visible.map((candidate) => candidate.provider_payment_id), evidence: 'local_events' },
        explanation: group
          ? 'Los eventos del intent registran más de un pago aprobado para la misma referencia y el proveedor no mostró todos: posible doble cobro, a confirmar en Mercado Pago.'
          : 'Los eventos del intent registran más de un pago aprobado para la misma referencia: posible doble cobro, a confirmar en Mercado Pago.',
      });
    }
  }

  // ── Reembolsos: coherencia interna ─────────────────────────────────────────
  for (const refund of refunds) {
    if (REFUND_OPEN.includes(refund.status) && !isYoung(refund.requested_at, ctx.nowMs, ctx.refundStuckMs)) {
      // PAY-07: mientras esta fila siga abierta, el pago no admite otro reembolso.
      push({
        ...base, code: 'REFUND_MISMATCH', reason: 'refund_stuck', severity: 'warning',
        facts: { ...refundFacts(refund), minutes_open: minutesBetween(toMs(refund.requested_at), ctx.nowMs), stuck_minutes_allowed: ctx.refundStuckMinutes },
        explanation: `Hay un reembolso en «${refund.status}» hace más de ${ctx.refundStuckMinutes} minutos: bloquea cualquier otro reembolso de ese pago.`,
      });
    }
    if (refund.status === 'approved' && !refund.provider_refund_id) {
      push({
        ...base, code: 'REFUND_MISMATCH', reason: 'approved_refund_without_provider_identity', severity: 'warning',
        facts: refundFacts(refund),
        explanation: 'Un reembolso figura aprobado sin el identificador del proveedor que lo respalda.',
      });
    }
  }
  const approvedLocal = sumApprovedLocal(refunds);
  // Sin total del proveedor contra el que comparar (no hubo proveedor, o su
  // pago no trae reembolsos), queda la coherencia interna.
  if ((!payment || compared.refundTotalKnown === false) && intent.refunded_cents !== approvedLocal) {
    const below = intent.refunded_cents < approvedLocal;
    push({
      ...base, code: 'REFUND_MISMATCH', reason: below ? 'intent_refunded_below_local_refunds' : 'intent_refunded_above_local_refunds',
      severity: below ? 'critical' : 'warning',
      facts: { local_intent_refunded_amount: amount(intent.refunded_cents), local_approved_refunds_total: amount(approvedLocal), local_internal_status: intent.internal_status },
      explanation: below
        ? 'El intent registra menos reembolsado que la suma de sus reembolsos aprobados.'
        : 'El intent registra más reembolsado que sus reembolsos locales aprobados (puede ser un reembolso hecho en el panel de Mercado Pago): a confirmar contra el proveedor.',
    });
  }
  const paidBase = baseCents(intent) ?? 0;
  const statusAmountOff = (intent.internal_status === 'refunded' && intent.refunded_cents < paidBase)
    || (intent.internal_status === 'partially_refunded' && (intent.refunded_cents === 0 || intent.refunded_cents >= paidBase))
    || (klass === 'paid' && intent.refunded_cents > 0);
  if (statusAmountOff) {
    push({
      ...base, code: 'REFUND_MISMATCH', reason: 'refund_status_amount_inconsistent', severity: 'warning',
      facts: { local_internal_status: intent.internal_status, local_refunded_amount: amount(intent.refunded_cents), local_paid_amount: amount(intent.paid_cents), local_expected_amount: amount(intent.expected_cents) },
      explanation: `El estado interno («${intent.internal_status}») no corresponde al importe reembolsado que registra el intent.`,
    });
  }
}

// ── Hechos compactos: sólo estados, importes, fechas e identificadores ───────
const linkedOrderIds = (intent) => [...new Set([intent.order_id, intent.session_completed_order_id, ...intent.request_order_ids].filter(Boolean))];

function localFacts(intent) {
  return {
    external_reference: intent.external_reference,
    environment: intent.environment,
    local_internal_status: intent.internal_status,
    local_provider_status: intent.provider_status,
    local_expected_amount: amount(intent.expected_cents),
    local_paid_amount: amount(intent.paid_cents),
    local_refunded_amount: amount(intent.refunded_cents),
    local_currency: intent.currency,
    local_session_status: intent.session_status,
    security_review_reason: intent.security_review_reason,
    local_created_at: intent.created_at,
    local_updated_at: intent.updated_at,
    local_approved_at: intent.approved_at,
    session_expires_at: intent.session_expires_at,
    in_window: intent.in_window,
  };
}

function providerFacts(payment) {
  return {
    external_reference: payment.external_reference,
    provider_status: payment.status,
    provider_status_detail: payment.status_detail || null,
    provider_transaction_amount: amount(payment.transaction_amount_cents),
    provider_refunded_total: amount(payment.refunded_total_cents),
    provider_currency: payment.currency || null,
    provider_date_created: payment.date_created,
    provider_date_approved: payment.date_approved,
    provider_date_last_updated: payment.date_last_updated,
  };
}

const statusFacts = (intent, payment) => ({ ...providerFacts(payment), ...localFacts(intent) });

const paymentBrief = (payment) => ({
  provider_payment_id: payment.provider_payment_id, status: payment.status,
  transaction_amount: amount(payment.transaction_amount_cents), date_created: payment.date_created, date_approved: payment.date_approved,
});

function orderFacts(order) {
  return {
    order_status: order.status, order_payment_method: order.payment_method, order_total: amount(order.total_cents),
    order_origin: order.origin, order_created_at: order.created_at,
  };
}

function refundFacts(refund) {
  return {
    refund_id: refund.refund_id, provider_refund_id: refund.provider_refund_id, local_refund_status: refund.status,
    local_refund_amount: amount(refund.amount_cents), requested_at: refund.requested_at, completed_at: refund.completed_at,
    has_provider_refund_id: Boolean(refund.provider_refund_id),
  };
}

function buildFinding(ctx, { code, reason, severity, intent = null, payment = null, order = null, facts = {}, explanation }) {
  return {
    code,
    reason,
    severity,
    business_id: intent?.business_id || order?.business_id || ctx.businessId,
    payment_intent_id: intent?.payment_intent_id || null,
    provider_payment_id: payment?.provider_payment_id || intent?.provider_payment_id || null,
    order_id: order?.order_id || intent?.order_id || null,
    order_public_code: order?.public_code || null,
    facts,
    explanation,
  };
}

function sortFindings(findings) {
  const key = (finding) => [SEVERITIES.indexOf(finding.severity), ALL_CODES.indexOf(finding.code),
    finding.payment_intent_id || '', finding.order_id || '', finding.provider_payment_id || '', finding.reason];
  return [...findings].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  });
}

function buildTotals(local, providerStats, findings) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const byCode = Object.fromEntries(ALL_CODES.map((code) => [code, 0]));
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCode[finding.code] += 1;
  }
  return {
    local_intents: local.intents.length,
    local_orders: local.orders.length,
    local_refunds: local.refunds.length,
    provider_payments: providerStats.total,
    provider_payments_in_scope: providerStats.in_scope,
    provider_payments_out_of_scope: providerStats.out_of_scope,
    findings: findings.length,
    by_severity: bySeverity,
    by_code: byCode,
  };
}

function buildCoverage({ local, provider, verification, lagTolerated, findings, providerStats, stats }) {
  const count = (state) => [...verification.values()].filter((entry) => entry.state === state).length;
  // Un intent con un hallazgo crítico o de advertencia no está conciliado,
  // aunque se haya comparado.
  const flagged = new Set(findings.filter((finding) => finding.severity !== 'info' && finding.payment_intent_id)
    .map((finding) => finding.payment_intent_id));
  const unverified = local.intents.filter((intent) => verification.get(intent.payment_intent_id).state === 'unverified');
  const verified = local.intents.filter((intent) => ['compared', 'no_payment_expected'].includes(verification.get(intent.payment_intent_id).state));
  const reasons = {};
  for (const intent of unverified) {
    const reason = verification.get(intent.payment_intent_id).reason;
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  const partial = unverified.filter((intent) => verification.get(intent.payment_intent_id).partial).length;
  const reconciled = verified.filter((intent) => !flagged.has(intent.payment_intent_id) && !lagTolerated.has(intent.payment_intent_id)).length;
  let comparison = 'partial';
  if (!provider || (unverified.length === local.intents.length && local.intents.length > 0 && partial === 0)) comparison = 'none';
  else if (unverified.length === 0) comparison = 'full';
  return {
    provider_supplied: Boolean(provider),
    provider_mode: provider ? provider.coverage.mode : 'none',
    provider_result_complete: provider ? provider.coverage.complete : false,
    provider_range: provider?.coverage.range
      ? { from: new Date(provider.coverage.range.from).toISOString(), to: new Date(provider.coverage.range.to).toISOString(), source: provider.coverage.range.source }
      : null,
    provider_references_queried: provider ? provider.coverage.queried_references.size : 0,
    provider_payments_collector_mismatch: providerStats.collector_mismatch,
    local_intents: local.intents.length,
    compared_against_provider: count('compared'),
    no_provider_payment_expected: count('no_payment_expected'),
    missing_at_provider: count('missing_at_provider'),
    unverified_against_provider: unverified.length,
    unverified_reasons: reasons,
    unverified_payment_intent_ids: unverified.map((intent) => intent.payment_intent_id),
    // De los no verificados, los que sí se compararon en parte (grupo de pagos
    // incompleto o datos que el proveedor no trajo): sus hallazgos valen, pero
    // ninguno cuenta como conciliado.
    partially_compared: partial,
    lag_tolerated: lagTolerated.size,
    refund_totals_not_comparable: stats.refund_totals_not_comparable,
    // Conciliado = comparado ENTERO contra el proveedor (o sin pago que
    // comparar, con la ausencia probada), sin hallazgos y sin atraso pendiente.
    reconciled,
    // Para quien lea sólo un campo, porque el código de salida 0 no distingue
    // «sin hallazgos críticos» de «no se comparó nada»: `none` ningún intent se
    // comparó contra el proveedor, `full` todos quedaron verificados (con o
    // sin hallazgos), `partial` el resto.
    provider_comparison: comparison,
  };
}

function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && value !== null && value !== undefined && value !== '' ? number : fallback;
}
