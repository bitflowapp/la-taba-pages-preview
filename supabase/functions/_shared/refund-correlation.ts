export type LocalRefundIdentity = {
  amount: number;
  providerRefundId?: string | null;
  requestedAt: string;
};

export type RefundCorrelation =
  | { kind: 'matched'; outcome: Record<string, unknown> }
  | { kind: 'unavailable' }
  | { kind: 'ambiguous' };

const REQUEST_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Correlates a provider refund without trusting array order. A provider ID is
 * authoritative when already recorded. Otherwise amount, request time and the
 * exclusion of IDs owned by other local refunds must leave exactly one result.
 */
export function correlateProviderRefund(
  providerRefunds: unknown[],
  local: LocalRefundIdentity,
  providerIdsOwnedByOtherRefunds: ReadonlySet<string>,
): RefundCorrelation {
  const amount = normalizedMoney(local.amount);
  const knownId = String(local.providerRefundId || '').trim();
  const candidates = providerRefunds
    .map(object)
    .filter((candidate) => {
      const id = String(candidate.id || '').trim();
      return id && normalizedMoney(candidate.amount) === amount;
    });

  if (knownId) {
    const exact = candidates.filter((candidate) => String(candidate.id).trim() === knownId);
    return exact.length === 1 ? { kind: 'matched', outcome: exact[0] } : { kind: 'unavailable' };
  }

  const requestedAt = Date.parse(local.requestedAt);
  if (!Number.isFinite(requestedAt)) return { kind: 'ambiguous' };
  const plausible = candidates.filter((candidate) => {
    const id = String(candidate.id).trim();
    if (providerIdsOwnedByOtherRefunds.has(id)) return false;
    const createdAtText = String(candidate.date_created || candidate.date_created_at || '').trim();
    if (!createdAtText) return true;
    const createdAt = Date.parse(createdAtText);
    return Number.isFinite(createdAt) && createdAt >= requestedAt - REQUEST_CLOCK_SKEW_MS;
  });
  if (plausible.length === 0) return { kind: 'unavailable' };
  if (plausible.length > 1) return { kind: 'ambiguous' };
  return { kind: 'matched', outcome: plausible[0] };
}

function normalizedMoney(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : '';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
