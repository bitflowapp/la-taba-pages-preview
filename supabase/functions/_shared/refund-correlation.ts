export type LocalRefundIdentity = {
  amount: number;
  providerRefundId?: string | null;
  paymentId?: string;
  requestedAt: string;
};
export type RefundCorrelation =
  | { kind: 'matched'; outcome: Record<string, unknown> }
  | { kind: 'unavailable' }
  | { kind: 'ambiguous' }
  | { kind: 'rejected' };

// A bound ID is the identity evidence. These bounds only reject inconsistent
// resource data; they must never identify an unknown refund. Allow 30 seconds
// of provider/server clock skew in either direction.
export const REFUND_CLOCK_SKEW_MS = 30_000;

export function providerResourceId(value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return '';
  if (typeof value !== 'number' && typeof value !== 'string') return '';
  const id = String(value);
  return /^[1-9][0-9]{0,31}$/.test(id) ? id : '';
}

export function correlateProviderRefund(
  providerRefunds: unknown[],
  local: LocalRefundIdentity,
  providerIdsOwnedByOtherRefunds: ReadonlySet<string>,
  nowMs = Date.now(),
): RefundCorrelation {
  const knownId = providerResourceId(local.providerRefundId);
  // Lost creation response with no durable ID: never select from a list, even
  // when a single entry has the right amount and a plausible timestamp.
  if (!knownId) return { kind: 'ambiguous' };
  if (providerIdsOwnedByOtherRefunds.has(knownId)) return { kind: 'rejected' };
  const paymentId = providerResourceId(local.paymentId);
  const amount = money(local.amount);
  if (!paymentId || amount === null) return { kind: 'rejected' };
  const candidates = providerRefunds.map(object).filter(row => providerResourceId(row.id) === knownId);
  if (!candidates.length) return { kind: 'unavailable' };
  if (candidates.length !== 1) return { kind: 'ambiguous' };
  const outcome = candidates[0];
  if (providerResourceId(outcome.payment_id) !== paymentId || money(outcome.amount) !== amount) {
    return { kind: 'rejected' };
  }
  const requestedAt = Date.parse(local.requestedAt);
  const createdAt = typeof outcome.date_created === 'string' ? Date.parse(outcome.date_created) : NaN;
  if (!Number.isFinite(requestedAt) || !Number.isFinite(createdAt) || !Number.isFinite(nowMs) ||
    requestedAt > nowMs + REFUND_CLOCK_SKEW_MS ||
    createdAt < requestedAt - REFUND_CLOCK_SKEW_MS || createdAt > nowMs + REFUND_CLOCK_SKEW_MS) {
    return { kind: 'ambiguous' };
  }
  if (outcome.status !== 'approved' && outcome.status !== 'rejected') return { kind: 'ambiguous' };
  return { kind: 'matched', outcome };
}

export type LostRefundSearch = {
  amount: number;
  paymentId: string;
  requestedAt: string;
  /** Último envío autorizado de la MISMA solicitud; sin él, el único envío fue el de `requestedAt`. */
  lastAttemptAt?: string | null;
};
export type LostRefundLookup =
  | { kind: 'matched'; outcome: Record<string, unknown> }
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  | { kind: 'rejected' };

// Lo que tarda como máximo una llamada al proveedor (`mercadoPagoRequest` corta
// a los 12 s): una devolución creada después de eso no la creó ese envío.
export const REFUND_PROVIDER_TIMEOUT_MS = 12_000;

/**
 * Busca, en la lista de devoluciones del pago, la que dejó un envío cuya
 * respuesta se perdió.
 *
 * NO es `correlateProviderRefund` y no lo reemplaza: aquella regla —sin
 * identidad guardada no se elige nada de una lista— sigue valiendo para la
 * conciliación automática. Esto se usa únicamente cuando una persona pidió
 * destrabar la solicitud (`resolve_stuck_payment_refund`) y la base ya comprobó
 * contra el proveedor el importe devuelto: o dejó pedida la búsqueda de la
 * identidad (`resolution_mode = 'provider_lookup'`), o autorizó reenviar y se
 * mira antes de mandar.
 *
 * Aun así no adivina: tiene que quedar UNA sola candidata —del mismo pago, del
 * mismo importe, creada dentro de la ventana del envío, que no sea de otra
 * solicitud local ni esté rechazada—. Con dos no se elige ninguna, y el orden
 * de la lista no decide nada.
 *
 * `none` significa «el proveedor no tiene esta devolución» y es lo que autoriza
 * a reenviar: se dice sólo cuando cada renglón de la lista quedó DESCARTADO por
 * algo que se pudo leer (es de otra solicitud local, está rechazado, es de otro
 * pago, de otro importe, o se creó fuera de la ventana). Un renglón vivo al que
 * nada descarta y al que le falta un dato —o lo trae ilegible— puede ser el
 * primer envío ya ejecutado: la respuesta es `ambiguous`, que no reenvía ni
 * asocia nada. Antes ese renglón se salteaba y la respuesta era `none`.
 */
export function locateRefundWithLostResponse(
  providerRefunds: unknown[],
  local: LostRefundSearch,
  providerIdsOwnedByOtherRefunds: ReadonlySet<string>,
  nowMs = Date.now(),
): LostRefundLookup {
  const paymentId = providerResourceId(local.paymentId);
  const amount = money(local.amount);
  const requestedAt = Date.parse(local.requestedAt);
  const lastAttemptAt = local.lastAttemptAt ? Date.parse(local.lastAttemptAt) : requestedAt;
  if (!paymentId || amount === null || !Number.isFinite(requestedAt) || !Number.isFinite(lastAttemptAt) ||
    !Number.isFinite(nowMs) || requestedAt > nowMs + REFUND_CLOCK_SKEW_MS) {
    return { kind: 'rejected' };
  }
  const from = requestedAt - REFUND_CLOCK_SKEW_MS;
  const until = Math.min(
    Math.max(requestedAt, lastAttemptAt) + REFUND_PROVIDER_TIMEOUT_MS + REFUND_CLOCK_SKEW_MS,
    nowMs + REFUND_CLOCK_SKEW_MS,
  );
  let unreadable = false;
  const candidates: Record<string, unknown>[] = [];
  for (const row of providerRefunds.map(object)) {
    const id = providerResourceId(row.id);
    const rowPaymentId = row.payment_id === undefined ? paymentId : providerResourceId(row.payment_id);
    const rowAmount = money(row.amount);
    const createdAt = typeof row.date_created === 'string' ? Date.parse(row.date_created) : NaN;
    // Lo que descarta un renglón, sólo con datos que se leyeron.
    if (id && providerIdsOwnedByOtherRefunds.has(id)) continue;
    if (row.status === 'rejected' || row.status === 'cancelled') continue;
    if (rowPaymentId && rowPaymentId !== paymentId) continue;
    if (rowAmount !== null && rowAmount !== amount) continue;
    if (Number.isFinite(createdAt) && (createdAt < from || createdAt > until)) continue;
    // Nada lo descartó. Con todo legible es una candidata; si no, no se sabe.
    if (!id || !rowPaymentId || rowAmount === null || !Number.isFinite(createdAt)) {
      unreadable = true;
      continue;
    }
    candidates.push(row);
  }
  if (unreadable) return { kind: 'ambiguous' };
  if (!candidates.length) return { kind: 'none' };
  if (candidates.length !== 1) return { kind: 'ambiguous' };
  return { kind: 'matched', outcome: candidates[0] };
}

// 10.000.000,00: el tope que ya tenía el pedido de reembolso.
const MAX_REFUND_CENTS = 1_000_000_000;

/**
 * Importe que pidió el Panel, en centavos ENTEROS; `null` si no es un importe
 * positivo de hasta dos decimales.
 *
 * La validación anterior comparaba `Math.round(amount * 100) !== amount * 100`.
 * En coma flotante `1.15 * 100` es 114.99999999999999, así que rechazaba cerca
 * del 9 % de los importes válidos de dos decimales (0.07, 0.29, 0.57, 1.15…) y
 * lo informaba como 503. El importe se decide en centavos y con tolerancia.
 */
export function refundAmountCents(value: unknown): number | null {
  if (typeof value === 'string' && !/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = money(value);
  return cents !== null && cents >= 1 && cents <= MAX_REFUND_CENTS ? cents : null;
}

function money(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const amount = Number(value), cents = Math.round(amount * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(cents) &&
    Math.abs(amount * 100 - cents) < 0.000001 ? cents : null;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
