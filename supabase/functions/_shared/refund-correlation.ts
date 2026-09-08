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

function money(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const amount = Number(value), cents = Math.round(amount * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(cents) &&
    Math.abs(amount * 100 - cents) < 0.000001 ? cents : null;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
