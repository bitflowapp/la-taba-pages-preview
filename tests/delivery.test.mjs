import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { formatDemoDistance, getRiderActionState } from '../js/core/rider.js';
import { getRiderGpsState, handleDeliveryAction } from '../js/delivery.js';
import { getActiveDeliveryOrder } from '../js/orders.js';
import { getState, setState } from '../js/state.js';
import { resetState, makeTarget } from './helpers.mjs';

beforeEach(() => resetState());

test('delivery selector only returns assignable delivery orders, never pickup ones', () => {
  const orders = [
    {
      id: 'LT-3001',
      status: 'ready',
      deliveryMode: 'pickup',
      items: [],
      createdAt: new Date().toISOString(),
      delivery: { driverName: 'Sin asignar', driverPhone: '', estimatedMinutes: 0, currentLocationLabel: 'Retiro en local' },
    },
    {
      id: 'LT-3002',
      status: 'received',
      deliveryMode: 'delivery',
      items: [],
      createdAt: new Date().toISOString(),
      delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 20, currentLocationLabel: 'Pedido recibido por el local' },
    },
    {
      id: 'LT-3004',
      status: 'ready',
      deliveryMode: 'delivery',
      items: [],
      createdAt: new Date().toISOString(),
      delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 20, currentLocationLabel: 'Pedido listo en el local' },
    },
    {
      id: 'LT-3003',
      status: 'cancelled',
      deliveryMode: 'delivery',
      items: [],
      createdAt: new Date().toISOString(),
      delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 20, currentLocationLabel: 'Pedido cancelado por el negocio' },
    },
  ];

  setState({ ...getState(), orders });

  const active = getActiveDeliveryOrder();
  assert.ok(active);
  assert.equal(active.id, 'LT-3004');
  assert.equal(active.deliveryMode, 'delivery');
});

test('delivery actions move an assigned order from ready to on the way and then delivered', () => {
  const order = {
    id: 'LT-4001',
    customerName: 'Cliente demo',
    customerPhone: '2994445555',
    address: 'Mitre 123',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    notes: '',
    createdAt: new Date().toISOString(),
    status: 'ready',
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    statusHistory: [{ status: 'received', at: new Date().toISOString() }],
    delivery: {
      driverName: 'Juli',
      driverPhone: '2991112233',
      estimatedMinutes: 20,
      currentLocationLabel: 'Pedido listo en el local',
    },
  };

  setState({ ...getState(), orders: [order], lastOrderId: order.id });

  let result = handleDeliveryAction(makeTarget({
    '[data-delivery-done]': { deliveryDone: order.id },
  }));
  assert.equal(result.handled, true);
  assert.equal(result.ok, false);
  assert.match(result.message, /no permitida/);
  assert.equal(getState().orders[0].status, 'ready');

  result = handleDeliveryAction(makeTarget({
    '[data-delivery-leave]': { deliveryLeave: order.id },
  }));
  assert.equal(result.handled, true);
  assert.match(result.message, /en camino/);
  assert.equal(getState().orders[0].status, 'on_the_way');
  assert.match(getState().orders[0].delivery.currentLocationLabel, /salió/);

  result = handleDeliveryAction(makeTarget({
    '[data-delivery-done]': { deliveryDone: order.id },
  }));
  assert.equal(result.handled, true);
  assert.match(result.message, /entregado/);
  assert.equal(getState().orders[0].status, 'delivered');
  assert.match(getState().orders[0].delivery.currentLocationLabel, /entregado/);
});

test('delivery selector ignores delivered, cancelled, and pickup-only queues', () => {
  const orders = [
    {
      id: 'LT-5001',
      status: 'delivered',
      deliveryMode: 'delivery',
      items: [],
      createdAt: new Date().toISOString(),
      delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 0, currentLocationLabel: 'Pedido entregado' },
    },
    {
      id: 'LT-5002',
      status: 'cancelled',
      deliveryMode: 'delivery',
      items: [],
      createdAt: new Date().toISOString(),
      delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 0, currentLocationLabel: 'Pedido cancelado' },
    },
    {
      id: 'LT-5003',
      status: 'ready',
      deliveryMode: 'pickup',
      items: [],
      createdAt: new Date().toISOString(),
      delivery: { driverName: 'Sin asignar', driverPhone: '', estimatedMinutes: 0, currentLocationLabel: 'Retiro en local' },
    },
  ];

  setState({ ...getState(), orders });
  assert.equal(getActiveDeliveryOrder(), null);
});

test('rider helpers expose coherent actions and demo distance', () => {
  const readyOrder = {
    status: 'ready',
    deliveryMode: 'delivery',
    delivery: { estimatedMinutes: 20 },
  };
  const movingOrder = {
    status: 'on_the_way',
    deliveryMode: 'delivery',
    delivery: { estimatedMinutes: 14 },
  };
  const pickupOrder = {
    status: 'ready',
    deliveryMode: 'pickup',
    delivery: { estimatedMinutes: 0 },
  };

  assert.deepEqual(getRiderActionState(readyOrder), {
    canLeave: true,
    canArrive: false,
    canDeliver: false,
  });
  assert.equal(getRiderActionState(movingOrder).canDeliver, true);
  assert.equal(getRiderActionState(pickupOrder).canLeave, false);
  assert.equal(formatDemoDistance(readyOrder), '0,6 km');
  assert.equal(formatDemoDistance({ status: 'delivered', deliveryMode: 'delivery', delivery: { estimatedMinutes: 0 } }), '0,0 km');
});

test('rider GPS state only reports active after a valid real fix', () => {
  const requesting = getRiderGpsState({
    mode: 'gps',
    source: 'simulation',
    gpsStatus: 'requesting',
    lat: -38.95,
    lng: -68.05,
  }, 1_000_000);

  assert.equal(requesting.enabled, false);
  assert.equal(requesting.permissionStatus, 'requesting');
  assert.equal(requesting.lat, null);
  assert.equal(requesting.source, null);

  const active = getRiderGpsState({
    mode: 'gps',
    source: 'gps',
    gpsStatus: 'active',
    lat: -38.9462,
    lng: -68.0418,
    accuracy: 14,
    heading: null,
    speed: null,
    timestamp: 1_000_000,
    lastBackendPublishAt: '2026-05-31T12:00:00.000Z',
  }, 1_010_000);

  assert.equal(active.enabled, true);
  assert.equal(active.source, 'gps');
  assert.equal(active.lat, -38.9462);
  assert.equal(active.lng, -68.0418);
  assert.equal(active.accuracy, 14);
  assert.equal(active.isStale, false);
  assert.equal(active.lastBackendPublishAt, '2026-05-31T12:00:00.000Z');
});
