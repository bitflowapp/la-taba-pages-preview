import assert from 'node:assert/strict';
import test from 'node:test';
import { getBusinessMetrics } from '../js/core/business-metrics.js';

const NOW = new Date('2026-06-07T15:00:00.000Z');

test('business growth metrics: calcula metricas locales desde pedidos reales', () => {
  const orders = [
    order({
      id: 'LT-1003',
      customerPhone: '2991110000',
      status: 'on_the_way',
      total: 12000,
      reorder: { sourceOrderId: 'LT-1001', repeatedAt: NOW.toISOString() },
    }),
    order({
      id: 'LT-1002',
      customerPhone: '2992220000',
      status: 'delivered',
      total: 9000,
      deliveryCode: { code: '1234', confirmedAt: '2026-06-07T14:00:00.000Z' },
      tracking: {
        lastLocation: {
          source: 'gps',
          lat: -38.95,
          lng: -68.05,
          lastFixAt: '2026-06-07T14:59:45.000Z',
        },
      },
    }),
    order({
      id: 'LT-1001',
      customerPhone: '2991110000',
      status: 'delivered',
      total: 10000,
      createdAt: '2026-06-06T12:00:00.000Z',
    }),
  ];

  const metrics = getBusinessMetrics(orders, [], NOW);

  assert.equal(metrics.directOrdering.createdOrders, 2);
  assert.equal(metrics.directOrdering.deliveredOrders, 1);
  assert.equal(metrics.directOrdering.inProgressOrders, 1);
  assert.equal(metrics.directOrdering.averageTicket, 10500);
  assert.equal(metrics.directOrdering.recurringCustomers, 1);
  assert.equal(metrics.directOrdering.repeatedOrders, 1);
  assert.equal(metrics.directOrdering.deliveryCodesValidated, 1);
  assert.equal(metrics.directOrdering.ordersWithoutLiveGps, 1);
});

test('business growth metrics: sin pedidos devuelve ceros y no inventa datos', () => {
  const metrics = getBusinessMetrics([], [], NOW);

  assert.equal(metrics.directOrdering.createdOrders, 0);
  assert.equal(metrics.directOrdering.deliveredOrders, 0);
  assert.equal(metrics.directOrdering.inProgressOrders, 0);
  assert.equal(metrics.directOrdering.averageTicket, 0);
  assert.equal(metrics.directOrdering.recurringCustomers, 0);
  assert.equal(metrics.directOrdering.repeatedOrders, 0);
  assert.equal(metrics.directOrdering.deliveryCodesValidated, 0);
  assert.equal(metrics.directOrdering.ordersWithoutLiveGps, 0);
});

function order(overrides = {}) {
  return {
    id: overrides.id || 'LT-1000',
    customerName: overrides.customerName || 'Cliente QA',
    customerPhone: overrides.customerPhone || '2995550000',
    address: 'Roca 123',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    createdAt: overrides.createdAt || '2026-06-07T13:00:00.000Z',
    status: overrides.status || 'received',
    total: overrides.total || 1000,
    items: [{ productId: 'p-muzzarella', name: 'Vacio', quantity: 1, unitPrice: overrides.total || 1000, unit: 'kg' }],
    ...overrides,
  };
}
