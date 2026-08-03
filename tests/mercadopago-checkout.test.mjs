import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildMercadoPagoCheckoutPayload,
  checkoutStorageKey,
  clearMercadoPagoCheckoutRecord,
  paymentStatusPresentation,
  readMercadoPagoCheckoutRecord,
  writeMercadoPagoCheckoutRecord,
} from '../js/payments/mercadopago-checkout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const businessId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const checkoutId = '33333333-3333-4333-8333-333333333333';

test('Mercado Pago checkout browser payload contains identifiers and contact only', () => {
  const payload = buildMercadoPagoCheckoutPayload({
    businessId,
    clientRequestId: 'mp-checkout-request-001',
    items: [{ productId, quantity: 2, price: 1, total: 2 }],
    values: {
      deliveryMode: 'delivery',
      customerName: 'Cliente de prueba',
      customerPhone: '+54 9 11 1234 5678',
      deliveryStreet: 'Calle de prueba',
      deliveryStreetNumber: '123',
      deliveryCity: 'Buenos Aires',
      price: 1,
      total: 1,
      currency: 'USD',
    },
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    'address', 'age_confirmed', 'business_id', 'client_request_id',
    'contact', 'fulfillment_type', 'items', 'payment_method',
  ]);
  assert.deepEqual(payload.items, [{ product_id: productId, quantity: 2 }]);
  assert.equal(payload.payment_method, 'mercadopago');
  assert.equal(payload.address.street, 'Calle de prueba');
  assert.doesNotMatch(JSON.stringify(payload), /"(?:price|subtotal|discount|total|currency|stock|preference_id|payment_id)"/i);
});

test('Mercado Pago recovery stores only a public checkout session identifier', () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  assert.equal(writeMercadoPagoCheckoutRecord(storage, businessId, checkoutId), true);
  const serialized = entries.get(checkoutStorageKey(businessId));
  assert.match(serialized, new RegExp(checkoutId));
  assert.doesNotMatch(serialized, /token|secret|preference|amount|payment/i);
  assert.deepEqual(readMercadoPagoCheckoutRecord(storage, businessId).checkoutSessionId, checkoutId);
  clearMercadoPagoCheckoutRecord(storage, businessId);
  assert.equal(readMercadoPagoCheckoutRecord(storage, businessId), null);
});

test('return state is derived from the server checkout, never from redirect query parameters', () => {
  assert.deepEqual(paymentStatusPresentation({ status: 'completed', payment_status: 'completed' }), {
    state: 'completed', label: 'Pedido confirmado', terminal: true, clearCart: true,
  });
  assert.equal(paymentStatusPresentation({ status: 'payment_approved', payment_status: 'approved' }).label, 'Confirmando tu pedido');
  assert.equal(paymentStatusPresentation({ status: 'payment_pending', payment_status: 'pending' }).state, 'pending');
  assert.equal(paymentStatusPresentation({ status: 'payment_pending', payment_status: 'pending' }).label, 'Pago pendiente');
  assert.equal(paymentStatusPresentation({ status: 'manual_review_required', payment_status: 'approved' }).state, 'manual_review');
  assert.equal(paymentStatusPresentation({ status: 'manual_review_required', payment_status: 'approved' }).label, 'Necesitamos revisar este pago');
  assert.equal(paymentStatusPresentation({ status: 'cancelled', payment_status: 'cancelled' }).state, 'rejected');
  assert.equal(paymentStatusPresentation({ status: 'redirected', payment_status: 'created' }).label, 'Verificando el pago');

  const returnScript = fs.readFileSync(path.join(root, 'js/payments/mercadopago-return.js'), 'utf8');
  assert.match(returnScript, /getMercadoPagoCheckoutStatus/);
  assert.doesNotMatch(returnScript, /URLSearchParams|[?&]status=/);
});

test('storefront redirects only after server-side checkout session and preference creation', () => {
  const repository = fs.readFileSync(path.join(root, 'js/repositories/supabase_order_repository.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(repository, /mercadopago-create-checkout-session/);
  assert.match(repository, /mercadopago-create-preference/);
  assert.match(repository, /trustedMercadoPagoCheckoutUrl/);
  assert.match(app, /createMercadoPagoCheckout/);
  assert.match(app, /Preparando pago/);
  assert.match(ui, /Pagar con Mercado Pago/);
  assert.match(ui, /Mercado Pago.*Tarjeta, débito o dinero en cuenta/);
  assert.doesNotMatch(repository, /MERCADOPAGO_ACCESS_TOKEN/);
});
