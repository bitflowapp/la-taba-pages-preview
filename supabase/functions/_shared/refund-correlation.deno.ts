import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { correlateProviderRefund } from './refund-correlation.ts';

const requestedAt = '2026-09-08T12:00:00.000Z';
const old = { id: '10000', payment_id: '90001', amount: 100, status: 'approved', date_created: '2026-09-01T12:00:00.000Z' };
const current = { id: '10001', payment_id: '90001', amount: 100, status: 'approved', date_created: '2026-09-08T12:00:02.000Z' };
const other = { id: '10002', payment_id: '90001', amount: 100, status: 'approved', date_created: '2026-09-08T12:00:03.000Z' };
const local = { amount: 100, requestedAt };
const known = { ...local, paymentId: '90001', providerRefundId: '10001' };
const now = Date.parse('2026-09-08T12:01:00Z');

Deno.test('refund correlation requires durable request identity even with one new refund', () => {
  assertEquals(correlateProviderRefund([current], local, new Set()).kind, 'ambiguous');
});

Deno.test('known refund identity selects the exact resource independently of older refunds', () => {
  assertEquals(correlateProviderRefund([old, current], known, new Set(), now), { kind: 'matched', outcome: current });
});

Deno.test('refund correlation excludes provider IDs associated with other local refunds', () => {
  assertEquals(correlateProviderRefund([old, current], known, new Set(['10001']), now).kind, 'rejected');
});

Deno.test('refund correlation preserves ambiguity when two candidates remain', () => {
  assertEquals(correlateProviderRefund([current, other], local, new Set()), { kind: 'ambiguous' });
});

Deno.test('refund correlation is independent of provider array order', () => {
  const first = correlateProviderRefund([old, current], known, new Set(), now);
  const second = correlateProviderRefund([current, old], known, new Set(), now);
  assertEquals(first, second);
});

Deno.test('known provider refund ID is idempotent and authoritative', () => {
  assertEquals(correlateProviderRefund([other, current], known, new Set(), now), { kind: 'matched', outcome: current });
});

for (const [name, mutation, expected] of [
  ['wrong payment', { payment_id: '90002' }, 'rejected'],
  ['wrong amount', { amount: 200 }, 'rejected'],
  ['missing amount', { amount: null }, 'rejected'],
  ['missing timestamp', { date_created: undefined }, 'ambiguous'],
  ['pre-request', { date_created: '2026-09-08T11:59:00Z' }, 'ambiguous'],
  ['future', { date_created: '2099-01-01T12:00:00Z' }, 'ambiguous'],
  ['missing status', { status: undefined }, 'ambiguous'],
] as const) {
  Deno.test('specific refund validation: ' + name, () => {
    assertEquals(correlateProviderRefund([{ ...current, ...mutation }], known, new Set(), now).kind, expected);
  });
}

Deno.test('same-time unassociated refunds remain ambiguous under concurrent reconciliation', () => {
  const results = Array.from({ length: 2 }, () => correlateProviderRefund([current, other], local, new Set()));
  assertEquals(results, [{ kind: 'ambiguous' }, { kind: 'ambiguous' }]);
});
