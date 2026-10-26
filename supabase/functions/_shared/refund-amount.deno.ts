import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.19';
import { normalizedRefundAmount } from './refund-amount.ts';
import { PublicPaymentError } from './payment-runtime.ts';

Deno.test('un reembolso parcial con centavos se acepta por su importe exacto', () => {
  // 8.2 * 100 === 819.9999999999999: la comparación exacta de antes rechazaba todos estos.
  for (const [value, expected] of [[8.2, 8.2], [16.4, 16.4], [4.35, 4.35], [1.15, 1.15], [0.07, 0.07], [0.29, 0.29],
    ['8.20', 8.2], [1999.99, 1999.99], [1500.35, 1500.35], [100, 100]] as const) {
    assertEquals(normalizedRefundAmount(value), expected);
  }
});

Deno.test('un importe inválido es un 400 con su motivo, nunca un 503 genérico', () => {
  for (const value of [0, -1, 8.205, '8,20', '', null, undefined, {}, [], Number.NaN, Infinity, 10_000_001, true]) {
    const error = assertThrows(() => normalizedRefundAmount(value), PublicPaymentError);
    assertEquals(error.status, 400);
    assertEquals(error.code, 'INVALID_REFUND_AMOUNT');
  }
});
