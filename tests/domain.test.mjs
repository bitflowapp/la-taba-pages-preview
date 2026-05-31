import assert from 'node:assert/strict';
import test from 'node:test';
import { BUSINESS_CONFIG } from '../js/config.js';
import {
  normalizeTrackingLocation,
  toDomainBusiness,
  toDomainOrder,
  toDomainRider,
} from '../js/core/domain.js';

test('domain order projects legacy demo orders into a backend-ready shape', () => {
  const order = toDomainOrder({
    id: 'LT-9001',
    status: 'arriving',
    deliveryMode: 'delivery',
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    address: 'Roca 321',
    items: [{ productId: 'p-vacio', name: 'Vacio', quantity: 2, unit: 'kg', unitPrice: 1000 }],
    subtotal: 2000,
    deliveryFee: 500,
    total: 2500,
    paymentMethod: 'Efectivo',
    notes: 'Sin grasa',
    createdAt: '2026-05-30T12:00:00.000Z',
    statusHistory: [
      { status: 'received', at: '2026-05-30T12:00:00.000Z' },
      { status: 'preparing', at: '2026-05-30T12:05:00.000Z' },
      { status: 'ready', at: '2026-05-30T12:20:00.000Z' },
      { status: 'arriving', at: '2026-05-30T12:40:00.000Z' },
    ],
    assignedRiderId: 'rider-1',
    tracking: {
      lastLocation: {
        lat: -38.95,
        lng: -68.06,
        accuracy: 12,
        heading: 370,
        timestamp: 1790685600000,
        source: 'gps',
      },
    },
  });

  assert.equal(order.status, 'arrived');
  assert.equal(order.demoStatus, 'arriving');
  assert.equal(order.fulfillmentType, 'delivery');
  assert.equal(order.customer.name, 'Cliente QA');
  assert.equal(order.items[0].subtotal, 2000);
  assert.equal(order.totals.total, 2500);
  assert.equal(order.acceptedAt, '2026-05-30T12:05:00.000Z');
  assert.equal(order.readyAt, '2026-05-30T12:20:00.000Z');
  assert.equal(order.assignedRiderId, 'rider-1');
  assert.equal(order.tracking.lastLocation.source, 'gps');
  assert.equal(order.tracking.lastLocation.heading, 10);
});

test('domain normalizes rider, business and tracking primitives', () => {
  assert.equal(normalizeTrackingLocation({ lat: 'x', lng: -68 }), null);
  assert.deepEqual(
    normalizeTrackingLocation({ lat: -38.95, lng: -68.06, source: 'manual' }).source,
    'manual',
  );

  const rider = toDomainRider({ id: 'r-1', name: 'Juli', phone: '2991112233' });
  assert.equal(rider.id, 'r-1');
  assert.equal(rider.status, 'available');

  const business = toDomainBusiness(BUSINESS_CONFIG);
  assert.equal(business.name, BUSINESS_CONFIG.name);
  assert.ok(business.deliveryZones.length > 0);
});
