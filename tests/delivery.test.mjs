import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { getRiderActionState } from '../js/core/rider.js';
import { handleDeliveryAction, riderGpsShareState } from '../js/delivery.js';
import { getActiveDeliveryOrder, getRiderQueueOrder } from '../js/orders.js';
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

test('rider queue prefers the active room order over a stale local in-progress order', () => {
  const stale = {
    id: 'LT-9001',
    status: 'on_the_way',
    deliveryMode: 'delivery',
    items: [],
    createdAt: '2026-05-29T10:00:00.000Z',
    statusHistory: [
      { status: 'received', at: '2026-05-29T10:00:00.000Z' },
      { status: 'on_the_way', at: '2026-05-29T10:05:00.000Z' },
    ],
    delivery: { driverName: 'Sin asignar', driverPhone: '', estimatedMinutes: 12, currentLocationLabel: 'En camino' },
  };
  const roomOrder = {
    id: 'LT-9002',
    status: 'received',
    deliveryMode: 'delivery',
    items: [],
    createdAt: '2026-05-29T10:10:00.000Z',
    statusHistory: [{ status: 'received', at: '2026-05-29T10:10:00.000Z' }],
    delivery: { driverName: 'Sin asignar', driverPhone: '', estimatedMinutes: 25, currentLocationLabel: 'Pedido recibido por el local' },
  };

  setState({ ...getState(), orders: [stale, roomOrder], lastOrderId: roomOrder.id });

  assert.equal(getRiderQueueOrder()?.id, roomOrder.id);
});

test('rider helpers expose coherent actions', () => {
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
});

test('rider GPS state goes stale honest instead of staying live', () => {
  const now = 2_000_000;
  const fresh = {
    orderId: 'LT-9001',
    status: 'on_the_way',
    deliveryMode: 'delivery',
    source: 'gps',
    gpsStatus: 'active',
    lat: -38.95,
    lng: -68.05,
    timestamp: now - 5_000,
    lastFixAt: new Date(now - 5_000).toISOString(),
    accuracy: 12,
  };
  const stale = { ...fresh, timestamp: now - 60_000, lastFixAt: new Date(now - 60_000).toISOString() };
  const simulated = { ...fresh, source: 'simulation' };
  const inactive = { ...fresh, gpsStatus: 'inactive' };

  assert.equal(riderGpsShareState(fresh, { now }).live, true);
  assert.equal(riderGpsShareState(fresh, { now }).headSub, 'El cliente puede seguir tu ubicación mientras el pedido esté en reparto.');
  assert.equal(riderGpsShareState(stale, { now }).live, false);
  assert.match(riderGpsShareState(stale, { now }).headSub, /Sin GPS en vivo/);
  assert.equal(riderGpsShareState(simulated, { now }).live, false);
  assert.equal(riderGpsShareState(inactive, { now }).live, false);
});
