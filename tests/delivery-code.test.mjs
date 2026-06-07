import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import {
  confirmDeliveryCode,
  createOrderFromCheckout,
} from '../js/orders.js';
import {
  formatDeliveryCode,
  normalizeDeliveryCode,
  verifyDeliveryCodeValue,
} from '../js/core/delivery-code.js';
import { getState, setState } from '../js/state.js';
import { resetState } from './helpers.mjs';

beforeEach(() => resetState());

test('delivery code: normaliza, formatea y valida 4 digitos', () => {
  const code = normalizeDeliveryCode({ code: '12 34' });

  assert.deepEqual(code, { code: '1234' });
  assert.equal(formatDeliveryCode(code.code), '12 34');
  assert.deepEqual(verifyDeliveryCodeValue(code, '1234'), {
    ok: true,
    message: 'Codigo de entrega confirmado.',
  });
  assert.equal(verifyDeliveryCodeValue(code, '9999').ok, false);
  assert.equal(verifyDeliveryCodeValue(code, '12345').ok, false);
});

test('delivery code: pedidos nuevos nacen con codigo visible y confirmable', () => {
  addToCart('p-vacio', 1);

  const created = createOrderFromCheckout({
    customerName: 'Cliente Codigo',
    customerPhone: '2995550000',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: 'Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  assert.equal(created.ok, true);
  assert.match(created.order.deliveryCode.code, /^\d{4}$/);

  const wrong = confirmDeliveryCode(created.order.id, '0000');
  assert.equal(wrong.ok, false);
  assert.equal(getState().orders[0].deliveryCode.confirmedAt, undefined);

  const confirmed = confirmDeliveryCode(created.order.id, created.order.deliveryCode.code, {
    confirmedAt: '2026-06-07T12:00:00.000Z',
    confirmedBy: 'rider',
  });
  assert.equal(confirmed.ok, true);
  assert.equal(getState().orders[0].deliveryCode.confirmedAt, '2026-06-07T12:00:00.000Z');
  assert.equal(getState().orders[0].deliveryCode.confirmedBy, 'rider');
});

test('delivery code: retiro en local no crea codigo de rider', () => {
  addToCart('p-combo-retiro', 1);

  const created = createOrderFromCheckout({
    customerName: 'Cliente Retiro',
    customerPhone: '2995552222',
    deliveryMode: 'pickup',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  assert.equal(created.ok, true);
  assert.equal(created.order.deliveryCode, undefined);
  assert.equal(getState().orders[0].deliveryCode, undefined);
  assert.deepEqual(confirmDeliveryCode(created.order.id, '1234'), {
    ok: false,
    message: 'Codigo de entrega disponible solo para delivery.',
  });
});

test('delivery code: pedido seed entregado no inventa codigo pendiente', () => {
  const seed = getState().orders.find((order) => order.id === 'LT-0001');

  assert.equal(seed.status, 'delivered');
  assert.equal(seed.deliveryCode, undefined);
});

test('delivery code: un pedido entregado no admite revalidacion por codigo', () => {
  setState({
    ...getState(),
    orders: [{
      id: 'LT-DONE',
      status: 'delivered',
      createdAt: '2026-06-07T10:00:00.000Z',
      statusHistory: [{ status: 'delivered', at: '2026-06-07T10:15:00.000Z' }],
      items: [{ productId: 'p-vacio', name: 'Vacio especial', quantity: 1, unitPrice: 11200, unit: 'kg' }],
      deliveryMode: 'delivery',
      customerName: 'Cliente entregado',
      customerPhone: '2995553333',
      address: 'Mitre 123, Centro',
      paymentMethod: 'Efectivo',
      delivery: { currentLocationLabel: 'Pedido entregado' },
      deliveryCode: { code: '1234' },
    }],
    lastOrderId: 'LT-DONE',
  });

  assert.deepEqual(confirmDeliveryCode('LT-DONE', '1234'), {
    ok: false,
    message: 'El pedido ya no admite validacion de codigo.',
  });
});

test('delivery code: pedidos viejos sin codigo hidratan con fallback estable', () => {
  const oldOrder = {
    id: 'LT-OLD',
    status: 'on_the_way',
    createdAt: '2026-06-07T10:00:00.000Z',
    statusHistory: [{ status: 'on_the_way', at: '2026-06-07T10:00:00.000Z' }],
    items: [{ productId: 'p-vacio', name: 'Vacio', quantity: 1, unitPrice: 11200, unit: 'kg' }],
    deliveryMode: 'delivery',
    customerName: 'Cliente viejo',
    customerPhone: '2995551111',
    address: 'Mitre 123, Centro',
    paymentMethod: 'Efectivo',
    delivery: { estimatedMinutes: 8, currentLocationLabel: 'En camino' },
  };

  setState({ ...getState(), orders: [oldOrder], lastOrderId: 'LT-OLD' });
  const firstCode = getState().orders[0].deliveryCode.code;

  assert.match(firstCode, /^\d{4}$/);

  setState({ ...getState(), orders: [oldOrder], lastOrderId: 'LT-OLD' });
  assert.equal(getState().orders[0].deliveryCode.code, firstCode);
});
