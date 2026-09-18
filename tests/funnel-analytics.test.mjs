import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FUNNEL_EVENTS,
  sanitizeFunnelMetadata,
  recordFunnelEvent,
  getFunnelSummary,
  clearFunnelEvents,
} from '../js/core/funnel-analytics.js';

test('funnel: define los diez eventos obligatorios del funnel de compra', () => {
  const expected = [
    'HOME_VIEW',
    'SEARCH_USED',
    'PRODUCT_ADDED',
    'CART_OPENED',
    'CHECKOUT_STARTED',
    'ADDRESS_COMPLETED',
    'ORDER_SUBMIT_ATTEMPT',
    'ORDER_CREATED',
    'ORDER_FAILED',
    'REPEAT_ORDER_USED',
  ];
  for (const name of expected) {
    assert.equal(FUNNEL_EVENTS[name], name);
  }
});

test('funnel: sanitizeFunnelMetadata elimina rigurosamente todo PII o credencial', () => {
  const input = {
    customerName: 'Juan Perez',
    name: 'Juan',
    phone: '2991234567',
    customerPhone: '+5492991234567',
    customerAddress: 'Mendoza 827',
    addressText: 'Calle Falsa 123',
    street: 'Mendoza',
    neighborhood: 'Centro',
    reference: 'Timbre 2',
    trackingToken: 'secret-token-39281',
    token: 'jwt-header.body.sig',
    password: 'supersecretpassword',
    secretKey: 'key_12345',
    cardNumber: '4500000000000000',
    cvv: '123',
    credentials: { user: 'a', pass: 'b' },
    // Campos legítimos de agregación / diagnósticos:
    deliveryMode: 'delivery',
    itemCount: 3,
    subtotal: 4500,
    hasAlcohol: false,
    reason: 'minimum_not_met',
    orderId: 'LT-0042',
  };

  const sanitized = sanitizeFunnelMetadata(input);

  // Todo dato personal o sensible debe ser omitido:
  assert.equal(sanitized.customerName, undefined);
  assert.equal(sanitized.name, undefined);
  assert.equal(sanitized.phone, undefined);
  assert.equal(sanitized.customerPhone, undefined);
  assert.equal(sanitized.customerAddress, undefined);
  assert.equal(sanitized.addressText, undefined);
  assert.equal(sanitized.street, undefined);
  assert.equal(sanitized.neighborhood, undefined);
  assert.equal(sanitized.reference, undefined);
  assert.equal(sanitized.trackingToken, undefined);
  assert.equal(sanitized.token, undefined);
  assert.equal(sanitized.password, undefined);
  assert.equal(sanitized.secretKey, undefined);
  assert.equal(sanitized.cardNumber, undefined);
  assert.equal(sanitized.cvv, undefined);
  assert.equal(sanitized.credentials, undefined);

  // Campos no sensibles se preservan:
  assert.equal(sanitized.deliveryMode, 'delivery');
  assert.equal(sanitized.itemCount, 3);
  assert.equal(sanitized.subtotal, 4500);
  assert.equal(sanitized.hasAlcohol, false);
  assert.equal(sanitized.reason, 'minimum_not_met');
  assert.equal(sanitized.orderId, 'LT-0042');
});

test('funnel: registra eventos agregados y actualiza los contadores', () => {
  clearFunnelEvents();

  recordFunnelEvent(FUNNEL_EVENTS.HOME_VIEW);
  recordFunnelEvent(FUNNEL_EVENTS.SEARCH_USED, { queryLength: 5 });
  recordFunnelEvent(FUNNEL_EVENTS.PRODUCT_ADDED, { productId: 'prod-123', quantity: 2 });
  recordFunnelEvent(FUNNEL_EVENTS.CART_OPENED);
  recordFunnelEvent(FUNNEL_EVENTS.CHECKOUT_STARTED, { itemCount: 2, subtotal: 3000 });
  recordFunnelEvent(FUNNEL_EVENTS.ADDRESS_COMPLETED, { deliveryMode: 'delivery' });
  recordFunnelEvent(FUNNEL_EVENTS.ORDER_SUBMIT_ATTEMPT, { paymentMethod: 'cash' });
  recordFunnelEvent(FUNNEL_EVENTS.ORDER_CREATED, { orderId: 'LT-0001', deliveryMode: 'delivery' });

  const summary = getFunnelSummary();
  assert.equal(summary.counts.HOME_VIEW, 1);
  assert.equal(summary.counts.SEARCH_USED, 1);
  assert.equal(summary.counts.PRODUCT_ADDED, 1);
  assert.equal(summary.counts.CART_OPENED, 1);
  assert.equal(summary.counts.CHECKOUT_STARTED, 1);
  assert.equal(summary.counts.ADDRESS_COMPLETED, 1);
  assert.equal(summary.counts.ORDER_SUBMIT_ATTEMPT, 1);
  assert.equal(summary.counts.ORDER_CREATED, 1);
  assert.equal(summary.recentCount, 8);

  // Registro de un evento desconocido es ignorado de forma segura:
  const invalid = recordFunnelEvent('UNKNOWN_EVENT_TEST');
  assert.equal(invalid, null);
  assert.equal(getFunnelSummary().recentCount, 8);
});
