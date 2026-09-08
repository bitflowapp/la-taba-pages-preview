import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { correlateProviderRefund } from './refund-correlation.ts';
const local = { amount: 100, requestedAt: '2026-09-08T12:00:00Z' };
const current = { id: '10001', amount: 100, status: 'approved', payment_id: '90001', date_created: '2026-09-08T12:00:02Z' };
for (const [name, list] of [
  ['missing timestamp', [{ id: '10001', amount: 100, status: 'approved' }]],
  ['pre-request refund', [{ ...current, date_created: '2026-09-08T11:59:00Z' }]],
  ['future refund', [{ ...current, date_created: '2099-01-01T12:00:00Z' }]],
  ['two plausible refunds', [current, { ...current, id: '10002' }]],
  ['one plausible refund without request identity', [current]],
  ['empty list after lost response', []],
] as const) {
  Deno.test('A4 unknown identity remains ambiguous: ' + name, () => {
    assertEquals(correlateProviderRefund([...list], local, new Set()).kind, 'ambiguous');
  });
}
