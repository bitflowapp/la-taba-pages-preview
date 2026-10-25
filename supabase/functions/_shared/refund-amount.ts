import { PublicPaymentError } from './payment-runtime.ts';

// El importe de un reembolso parcial, en centavos, nunca comparando flotantes: 8.2 * 100 es 819.9999999999999, así
// que la comparación exacta que había en mercadopago-refund rechazaba importes legítimos como $8,20, $16,40 o $4,35 y
// respondía 503 «No pudimos procesar el pago» (medido en el banco de cobros, scripts/payments-e2e). Misma regla que
// money() de refund-correlation.ts. Un importe inválido es un error del pedido (400), no del servicio.
export function normalizedRefundAmount(value: unknown): number {
  const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000 || !Number.isSafeInteger(cents) ||
    Math.abs(amount * 100 - cents) > 0.000001) {
    throw new PublicPaymentError(400, 'INVALID_REFUND_AMOUNT', 'El importe a devolver tiene que ser un monto en pesos con hasta dos decimales.');
  }
  return cents / 100;
}
