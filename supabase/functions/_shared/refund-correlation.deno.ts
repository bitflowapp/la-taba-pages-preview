import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { correlateProviderRefund } from './refund-correlation.ts';

const requestedAt = '2026-09-08T12:00:00.000Z';
const old = { id: 'old', amount: 100, status: 'approved', date_created: '2026-09-01T12:00:00.000Z' };
const current = { id: 'current', amount: 100, status: 'approved', date_created: '2026-09-08T12:00:02.000Z' };
const other = { id: 'other', amount: 100, status: 'approved', date_created: '2026-09-08T12:00:03.000Z' };
const local = { amount: 100, requestedAt };

Deno.test('refund correlation matches one unambiguous new refund', () => {
  assertEquals(correlateProviderRefund([current], local, new Set()), { kind: 'matched', outcome: current });
});

Deno.test('refund correlation selects the new refund instead of an older refund', () => {
  assertEquals(correlateProviderRefund([old, current], local, new Set()), { kind: 'matched', outcome: current });
});

Deno.test('refund correlation excludes provider IDs associated with other local refunds', () => {
  assertEquals(correlateProviderRefund([old, current], local, new Set(['old'])), { kind: 'matched', outcome: current });
});

Deno.test('refund correlation preserves ambiguity when two candidates remain', () => {
  assertEquals(correlateProviderRefund([current, other], local, new Set()), { kind: 'ambiguous' });
});

Deno.test('refund correlation is independent of provider array order', () => {
  const first = correlateProviderRefund([old, current], local, new Set());
  const second = correlateProviderRefund([current, old], local, new Set());
  assertEquals(first, second);
});

Deno.test('known provider refund ID is idempotent and authoritative', () => {
  const known = { ...local, providerRefundId: 'current' };
  assertEquals(correlateProviderRefund([other, current], known, new Set(['current'])), { kind: 'matched', outcome: current });
});

Deno.test('same-time unassociated refunds remain ambiguous under concurrent reconciliation', () => {
  const results = Array.from({ length: 2 }, () => correlateProviderRefund([current, other], local, new Set()));
  assertEquals(results, [{ kind: 'ambiguous' }, { kind: 'ambiguous' }]);
});
