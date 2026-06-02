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
import { resetRepositoryFactoryForTests } from '../js/repositories/repository_factory.js';
import {
  activateStreetTestMode,
  disableGpsTracking,
  enableGpsTracking,
  gpsDeliveryPhaseForOrder,
  gpsWatchOptionsForOrder,
  handleViewChangeForSimulation,
  isGpsActive,
  selectStreetTestDestination,
  shouldPublishLocation,
  startSimulation,
  syncSimulationOnStatus,
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

test('GPS explains insecure contexts honestly (no live sharing without HTTPS)', () => {
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
    assert.match(result.message, /conexión segura/);
    assert.equal(getState().simulation.orderId, created.order.id);
    assert.equal(getState().simulation.mode, 'demo');
    assert.equal(getState().simulation.gpsStatus, 'requires_secure_context');
    assert.match(getState().simulation.gpsError, /conexión segura/);
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
    assert.equal(getState().simulation.gpsStatus, 'requesting');
    assert.equal(getState().simulation.source, 'simulation');
    successHandler({
      coords: {
        latitude: -38.9462,
        longitude: -68.0418,
        accuracy: 14,
        heading: 92,
        speed: 3.2,
      },
      timestamp: Date.now(),
    });
    assert.equal(getState().simulation.source, 'gps');
    assert.equal(getState().simulation.gpsStatus, 'active');
    assert.equal(getState().simulation.accuracy, 14);
    assert.equal(getState().simulation.heading, 92);
    assert.equal(getState().simulation.lastSentSource, 'gps');
    assert.ok(getState().simulation.lastGpsFixAt);

    const stopped = disableGpsTracking();
    assert.equal(stopped.ok, true);
    assert.equal(clearWatchId, 42);
    assert.equal(getState().simulation.gpsStatus, 'inactive');
    assert.equal(getState().simulation.source, 'gps');
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('view changes keep GPS live until the rider stops sharing', () => {
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
          return 45;
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
        accuracy: 12,
      },
      timestamp: Date.now(),
    });

    handleViewChangeForSimulation('tracking');
    assert.equal(isGpsActive(), true);
    assert.equal(clearWatchId, null);

    disableGpsTracking();
    assert.equal(clearWatchId, 45);
    assert.equal(getState().simulation.gpsStatus, 'inactive');
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('GPS keeps a recent fix visible after transient unavailable errors', () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let successHandler = null;
  let errorHandler = null;
  let clearWatchId = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (success, error) => {
          successHandler = success;
          errorHandler = error;
          return 43;
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
      },
      timestamp: Date.now(),
    });
    errorHandler({ code: 2 });

    assert.equal(clearWatchId, null);
    assert.equal(getState().simulation.mode, 'gps');
    assert.equal(getState().simulation.source, 'gps');
    assert.equal(getState().simulation.gpsStatus, 'unavailable');
    assert.equal(getState().simulation.accuracy, 14);

    disableGpsTracking();
    assert.equal(clearWatchId, 43);
    assert.equal(getState().simulation.gpsStatus, 'inactive');
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('GPS keeps watcher alive on transient errors before first fix', () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let errorHandler = null;
  let clearWatchId = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (_success, error) => {
          errorHandler = error;
          return 44;
        },
        clearWatch: (id) => { clearWatchId = id; },
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    errorHandler({ code: 2 });

    assert.equal(clearWatchId, null);
    assert.equal(getState().simulation.mode, 'gps');
    assert.equal(getState().simulation.gpsStatus, 'unavailable');
    assert.equal(getState().simulation.source, 'simulation');

    disableGpsTracking();
    assert.equal(clearWatchId, 44);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('GPS can start from street test mode before the order leaves the store', () => {
  addToCart('p-vacio', 1);
  const created = createOrderFromCheckout({
    customerName: 'GPS QA',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: '',
  });

  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let watchCount = 0;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: () => { watchCount += 1; return 24; },
        clearWatch: () => {},
      },
    },
  });

  try {
    assert.equal(selectStreetTestDestination('alto-comahue').ok, true);
    const result = enableGpsTracking();
    assert.equal(result.ok, true);
    assert.equal(watchCount, 1);
    assert.equal(getState().simulation.orderId, created.order.id);
    assert.equal(getState().simulation.destinationId, 'alto-comahue');
    assert.equal(getState().simulation.gpsStatus, 'requesting');
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('GPS geolocation options adapt to delivery phase', () => {
  const idleOrder = { deliveryMode: 'delivery', status: 'preparing' };
  const activeOrder = { deliveryMode: 'delivery', status: 'on_the_way' };
  const nearOrder = { deliveryMode: 'delivery', status: 'arriving' };
  const stoppedOrder = { deliveryMode: 'delivery', status: 'delivered' };

  assert.equal(gpsDeliveryPhaseForOrder(idleOrder), 'IDLE');
  assert.equal(gpsDeliveryPhaseForOrder(activeOrder), 'ACTIVE_DELIVERY');
  assert.equal(gpsDeliveryPhaseForOrder(nearOrder), 'NEAR_CUSTOMER');
  assert.equal(gpsDeliveryPhaseForOrder(stoppedOrder), 'STOPPED');

  assert.equal(gpsWatchOptionsForOrder(idleOrder).enableHighAccuracy, false);
  assert.equal(gpsWatchOptionsForOrder(activeOrder).enableHighAccuracy, true);
  assert.ok(gpsWatchOptionsForOrder(nearOrder).maximumAge < gpsWatchOptionsForOrder(activeOrder).maximumAge);
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
    assert.equal(watchCount, 1);
    assert.equal(clearCount, 0);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('GPS minimal movement does not publish a fresh state immediately', () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let successHandler = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (success) => { successHandler = success; return 93; },
        clearWatch: () => {},
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    const timestamp = Date.now();
    successHandler({
      coords: { latitude: -38.9462, longitude: -68.0418, accuracy: 12 },
      timestamp,
    });
    const firstTimestamp = getState().simulation.timestamp;

    successHandler({
      coords: { latitude: -38.946201, longitude: -68.041801, accuracy: 13 },
      timestamp: timestamp + 1_000,
    });

    assert.equal(getState().simulation.timestamp, firstTimestamp);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('relay/backend publish errors do not stop active GPS', async () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let successHandler = null;
  let clearWatchId = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://example.test/?mode=http&api=https://api.example.test'),
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: () => Promise.reject(new Error('offline')),
  });
  resetRepositoryFactoryForTests();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (success) => {
          successHandler = success;
          return 94;
        },
        clearWatch: (id) => { clearWatchId = id; },
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    successHandler({
      coords: { latitude: -38.9462, longitude: -68.0418, accuracy: 12 },
      timestamp: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(isGpsActive(), true);
    assert.equal(clearWatchId, null);
    assert.equal(getState().simulation.gpsStatus, 'active');
    assert.match(getState().simulation.backendError, /backend/i);
  } finally {
    disableGpsTracking({ silent: true });
    resetRepositoryFactoryForTests();
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
    else delete globalThis.fetch;
  }
});

test('terminal delivery statuses stop the real GPS watch', () => {
  const order = createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let clearWatchId = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: () => 91,
        clearWatch: (id) => { clearWatchId = id; },
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    syncSimulationOnStatus(order.id, 'delivered');
    assert.equal(clearWatchId, 91);
    assert.equal(getState().simulation, null);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('GPS ignores invalid coordinates and absurd jumps', () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let successHandler = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (success) => { successHandler = success; return 92; },
        clearWatch: () => {},
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    const timestamp = Date.now();
    successHandler({
      coords: { latitude: -38.9462, longitude: -68.0418, accuracy: 12, heading: 80, speed: 2.4 },
      timestamp,
    });
    assert.equal(getState().simulation.source, 'gps');
    const acceptedLat = getState().simulation.lat;

    successHandler({
      coords: { latitude: 999, longitude: -68.0418, accuracy: 12 },
      timestamp: timestamp + 1_000,
    });
    assert.equal(getState().simulation.lat, acceptedLat);

    successHandler({
      coords: { latitude: -37.9, longitude: -67.2, accuracy: 120 },
      timestamp: timestamp + 2_000,
    });
    assert.equal(getState().simulation.lat, acceptedLat);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('simulation does not start over an active GPS watch', () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: () => 77,
        clearWatch: () => {},
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    const result = startSimulation();
    assert.equal(result.ok, false);
    assert.match(result.message, /GPS real/);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('simulation can restart after GPS is stopped', () => {
  createReadyDeliveryOrder();
  const originalSecureContext = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let successHandler = null;

  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition: (success) => { successHandler = success; return 78; },
        clearWatch: () => {},
      },
    },
  });

  try {
    assert.equal(enableGpsTracking().ok, true);
    successHandler({
      coords: {
        latitude: -38.9462,
        longitude: -68.0418,
        accuracy: 11,
        heading: 80,
        speed: 2.4,
      },
      timestamp: Date.now(),
    });
    assert.equal(getState().simulation.source, 'gps');
    assert.equal(disableGpsTracking().ok, true);

    const result = startSimulation();
    assert.equal(result.ok, true);
    assert.equal(getState().simulation.source, 'simulation');
    assert.equal(getState().simulation.gpsStatus, 'inactive');
    assert.equal(getState().simulation.running, true);
  } finally {
    disableGpsTracking({ silent: true });
    if (originalSecureContext) Object.defineProperty(globalThis, 'isSecureContext', originalSecureContext);
    else delete globalThis.isSecureContext;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('shouldPublishLocation aplica throttling por tiempo y distancia', () => {
  const t0 = 1_000_000;
  const prev = { lat: -38.9516, lng: -68.0591, source: 'gps', timestamp: t0, at: t0 };
  const nearSoon = { lat: -38.95161, lng: -68.05911, source: 'gps', timestamp: t0 + 1_000 }; // ~1-2 m
  // Mismo punto, muy pronto: no publica.
  assert.equal(shouldPublishLocation(prev, nearSoon, t0 + 1_000), false);
  // Pasó el máximo: publica aunque se haya movido poco.
  assert.equal(shouldPublishLocation(prev, { ...nearSoon, timestamp: t0 + 12_000 }, t0 + 12_000), true);
  // Se movió suficiente y pasó la ventana mínima: publica.
  const farSoon = { lat: -38.9530, lng: -68.0591, source: 'gps', timestamp: t0 + 4_500 };
  assert.equal(shouldPublishLocation(prev, farSoon, t0 + 4_500), true);
  // Si se movió mucho demasiado pronto, espera para reducir ruido.
  assert.equal(shouldPublishLocation(prev, { ...farSoon, timestamp: t0 + 500 }, t0 + 500), false);
  // Sin fix previo: siempre publica el primero.
  assert.equal(shouldPublishLocation(null, nearSoon, t0), true);
  // Sin ubicación nueva: no publica.
  assert.equal(shouldPublishLocation(prev, null, t0 + 10_000), false);
});
