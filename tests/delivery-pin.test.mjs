import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmDeliveryPin,
  createDeliveryPin,
  createDeliveryPinState,
  deliveryPinIsConfirmed,
  formatDeliveryPin,
  incrementDeliveryPinAttempts,
  normalizeDeliveryPin,
  normalizeDeliveryPinState,
  resolveDeliveryPin,
  validateDeliveryPinForCompletion,
  verifyDeliveryPinForOrder,
} from '../js/core/delivery-pin.js';

test('delivery PIN helpers normalize, format, and verify codes', () => {
  assert.match(createDeliveryPin(), /^\d{4}$/);
  assert.equal(normalizeDeliveryPin('12 34'), '1234');
  assert.equal(normalizeDeliveryPin('12345'), '');
  assert.equal(formatDeliveryPin('1234'), '12 34');
  assert.equal(formatDeliveryPin({ code: '9876' }), '98 76');

  const order = { id: 'LT-1001', deliveryMode: 'delivery', deliveryPin: '4321' };
  assert.equal(verifyDeliveryPinForOrder(order, '43-21'), true);
  assert.equal(verifyDeliveryPinForOrder(order, '1234'), false);

  const state = createDeliveryPinState('1357');
  assert.deepEqual(state, { code: '1357', status: 'pending', attempts: 0 });
  assert.deepEqual(normalizeDeliveryPinState('2468'), { code: '2468', status: 'pending', attempts: 0 });
  assert.deepEqual(incrementDeliveryPinAttempts(state), { code: '1357', status: 'pending', attempts: 1 });
  assert.deepEqual(confirmDeliveryPin(incrementDeliveryPinAttempts(state), '2026-06-06T12:00:00.000Z'), {
    code: '1357',
    status: 'confirmed',
    attempts: 1,
    confirmedAt: '2026-06-06T12:00:00.000Z',
  });
  assert.equal(deliveryPinIsConfirmed({ deliveryPin: confirmDeliveryPin(state) }), true);
});

test('legacy delivery orders derive a stable fallback PIN', () => {
  const order = {
    id: 'LT-LEGACY',
    deliveryMode: 'delivery',
    createdAt: '2026-06-06T12:00:00.000Z',
    customerPhone: '2995550000',
  };

  assert.match(resolveDeliveryPin(order), /^\d{4}$/);
  assert.equal(resolveDeliveryPin(order), resolveDeliveryPin({ ...order }));
  assert.equal(resolveDeliveryPin({ ...order, deliveryMode: 'pickup' }), '');
});

test('delivery completion can require the customer PIN', () => {
  const order = { id: 'LT-2001', deliveryMode: 'delivery', deliveryPin: '2468' };

  assert.deepEqual(
    validateDeliveryPinForCompletion(order, 'delivered', '', { requireDeliveryPin: true }),
    { ok: false, reason: 'missing', message: 'Pedile al cliente el PIN de entrega.' },
  );
  assert.deepEqual(
    validateDeliveryPinForCompletion(order, 'delivered', '0000', { requireDeliveryPin: true }),
    { ok: false, reason: 'mismatch', message: 'PIN de entrega incorrecto.' },
  );
  assert.deepEqual(
    validateDeliveryPinForCompletion(order, 'delivered', '2468', { requireDeliveryPin: true }),
    { ok: true, pin: '2468' },
  );
  assert.equal(
    validateDeliveryPinForCompletion(order, 'delivered', '', { requireDeliveryPin: false }).ok,
    true,
  );
});
