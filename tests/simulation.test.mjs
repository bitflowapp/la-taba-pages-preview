import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import {
  advanceSimulation,
  clampProgress,
  createSimulationState,
  nextProgress,
  progressToEta,
  simulationProgressPercent,
} from '../js/core/simulation.js';
import { createOrderFromCheckout, updateOrderStatus } from '../js/orders.js';
import {
  activateStreetTestMode,
  disableGpsTracking,
  enableGpsTracking,
  selectStreetTestDestination,
} from '../js/simulation.js';
import { getState, hydrateState } from '../js/state.js';
import { resetState } from './helpers.mjs';

beforeEach(() => resetState());

function createReadyDeliveryOrder() {
  addToCart('p-vacio', 1);
  const created = createOrderFromCheckout({
    customerName: 'GPS QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  updateOrderStatus(created.order.id, 'preparing');
  updateOrderStatus(created.order.id, 'ready');
  return created.order;
}

test('clampProgress keeps values within 0..1', () => {
  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(0.42), 0.42);
  assert.equal(clampProgress(2), 1);
  assert.equal(clampProgress('nope'), 0);
});

test('nextProgress advances and never exceeds 1', () => {
  const advanced = nextProgress(0, 1200, 24000);
  assert.ok(advanced > 0 && advanced < 1);
  assert.equal(nextProgress(0.99, 24000, 24000), 1);
});

test('progressToEta scales the base ETA down with progress', () => {
  assert.equal(progressToEta(0, 20), 20);
  assert.equal(progressToEta(0.5, 20), 10);
  assert.equal(progressToEta(1, 20), 0);
});

test('createSimulationState seeds a coherent state for a delivery order', () => {
  const sim = createSimulationState({
    id: 'LT-9001',
    status: 'on_the_way',
    deliveryMode: 'delivery',
    delivery: { estimatedMinutes: 18 },
  });
  assert.equal(sim.orderId, 'LT-9001');
  assert.equal(sim.running, true);
  assert.equal(sim.baseEta, 18);
  assert.ok(sim.progress > 0 && sim.progress < 1);
  assert.ok(Number.isFinite(sim.lat) && Number.isFinite(sim.lng));
});

test('advanceSimulation stops when the route is complete', () => {
  const start = { orderId: 'LT-9002', running: true, mode: 'demo', progress: 0.98, baseEta: 12, etaMinutes: 1 };
  const { simulation, reachedEnd } = advanceSimulation(start, 24000);
  assert.equal(reachedEnd, true);
  assert.equal(simulation.progress, 1);
  assert.equal(simulation.running, false);
  assert.equal(simulation.etaMinutes, 0);
  assert.equal(simulationProgressPercent(simulation), 100);
});

test('hydrateState keeps a simulation only for an active delivery order', () => {
  const baseOrder = {
    id: 'LT-9100',
    customerName: 'Cliente',
    customerPhone: '2990000000',
    address: 'Roca 123',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    notes: '',
    createdAt: new Date().toISOString(),
    status: 'on_the_way',
    items: [{ productId: 'p-vacio', name: 'Vacío', icon: '', quantity: 1, unitPrice: 11200, unit: 'kg' }],
    statusHistory: [{ status: 'received', at: new Date().toISOString() }],
    delivery: { driverName: 'Juli', driverPhone: '2991112233', estimatedMinutes: 14, currentLocationLabel: 'En camino' },
  };

  const kept = hydrateState({
    orders: [baseOrder],
    simulation: { orderId: 'LT-9100', running: true, mode: 'demo', progress: 0.4, baseEta: 14, etaMinutes: 8 },
  });
  assert.ok(kept.simulation);
  assert.equal(kept.simulation.orderId, 'LT-9100');
  assert.equal(kept.simulation.running, true);

  const droppedMissing = hydrateState({
    orders: [baseOrder],
    simulation: { orderId: 'LT-0000', running: true, progress: 0.4 },
  });
  assert.equal(droppedMissing.simulation, null);

  const droppedDelivered = hydrateState({
    orders: [{ ...baseOrder, status: 'delivered' }],
    simulation: { orderId: 'LT-9100', running: true, progress: 0.9 },
  });
  assert.equal(droppedDelivered.simulation, null);
});

test('GPS explains insecure LAN contexts and keeps demo simulation available', () => {
  addToCart('p-vacio', 1);
  const created = createOrderFromCheckout({
    customerName: 'GPS QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  updateOrderStatus(created.order.id, 'preparing');
  updateOrderStatus(created.order.id, 'ready');

  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  Object.defineProperty(globalThis, 'isSecureContext', {
    configurable: true,
    value: false,
  });

  try {
    const result = enableGpsTracking();
    assert.equal(result.ok, false);
    assert.match(result.message, /HTTPS o localhost/);
    assert.equal(getState().simulation.orderId, created.order.id);
    assert.equal(getState().simulation.mode, 'demo');
    assert.equal(getState().simulation.gpsStatus, 'requires_secure_context');
    assert.match(getState().simulation.gpsError, /simulación/);
  } finally {
    if (originalSecureContext) {
      Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    } else {
      delete globalThis.isSecureContext;
    }
  }
});

test('street test mode stores selected destination in order and simulation', () => {
  const order = createReadyDeliveryOrder();

  let result = activateStreetTestMode('neuquen-centro');
  assert.equal(result.ok, true);
  assert.equal(getState().simulation.orderId, order.id);
  assert.equal(getState().simulation.destinationId, 'neuquen-centro');

  result = selectStreetTestDestination('alto-comahue');
  assert.equal(result.ok, true);
  assert.equal(getState().simulation.routeId, 'alto-comahue');
  assert.equal(getState().simulation.destinationId, 'alto-comahue');
  assert.equal(getState().orders[0].delivery.demoDestinationId, 'alto-comahue');
  assert.match(getState().orders[0].delivery.demoDestinationAddressLabel, /Alto Comahue/);
});

test('GPS success stores real rider metadata and stopping clears watchPosition', () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let successHandler = null;
  let clearWatchId = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (success) => {
          successHandler = success;
          return 42;
        },
        clearWatch: (id) => { clearWatchId = id; },
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    successHandler({
      coords: {
        latitude: -38.9462,
        longitude: -68.0418,
        accuracy: 14,
        heading: 92,
        speed: 3.2,
      },
      timestamp: 1780110000000,
    });
    assert.equal(getState().simulation.source, 'gps');
    assert.equal(getState().simulation.gpsStatus, 'active');
    assert.equal(getState().simulation.accuracy, 14);
    assert.equal(getState().simulation.heading, 92);

    const stopped = disableGpsTracking();
    assert.equal(stopped.ok, true);
    assert.equal(clearWatchId, 42);
    assert.equal(getState().simulation.gpsStatus, 'inactive');
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('GPS watchPosition is not duplicated when rider taps GPS twice', () => {
  addToCart('p-vacio', 1);
  const created = createOrderFromCheckout({
    customerName: 'GPS QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });
  updateOrderStatus(created.order.id, 'preparing');
  updateOrderStatus(created.order.id, 'ready');

  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let watchCount = 0;
  let clearCount = 0;
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: () => { watchCount += 1; return watchCount; },
        clearWatch: () => { clearCount += 1; },
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    assert.equal(enableGpsTracking().ok, true);
    assert.equal(watchCount, 2);
    assert.equal(clearCount, 1);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
