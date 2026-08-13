import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canShareProductionRiderGps,
  createProductionRiderGpsController,
} from '../js/tracking/production_rider_gps.js';

const RIDER_ID = 'rider-qa-1';

function activeOrder(status = 'on_the_way') {
  return {
    id: 'LT-GPS-1',
    deliveryMode: 'delivery',
    assignedRiderId: RIDER_ID,
    workflowStatus: status,
  };
}

test('el GPS productivo exige rider asignado y estado de reparto', () => {
  assert.equal(canShareProductionRiderGps({ order: activeOrder(), userId: RIDER_ID, role: 'rider' }), true);
  assert.equal(canShareProductionRiderGps({ order: activeOrder(), userId: 'otro', role: 'rider' }), false);
  assert.equal(canShareProductionRiderGps({ order: activeOrder(), userId: RIDER_ID, role: 'staff' }), false);
  assert.equal(canShareProductionRiderGps({ order: activeOrder('ready'), userId: RIDER_ID, role: 'rider' }), false);
  assert.equal(canShareProductionRiderGps({ order: activeOrder('arrived'), userId: RIDER_ID, role: 'rider' }), true);
});

test('publica sólo campos GPS permitidos y detiene el watcher al entregar', async () => {
  let order = activeOrder();
  let positionHandler = null;
  const cleared = [];
  const published = [];
  const controller = createProductionRiderGpsController({
    repository: {
      async updateRiderLocation(orderId, location) {
        published.push({ orderId, location });
        return { ok: true };
      },
    },
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => order,
    navigatorRef: {
      geolocation: {
        watchPosition(success) {
          positionHandler = success;
          return 77;
        },
        clearWatch(id) { cleared.push(id); },
      },
    },
  });

  assert.equal(controller.start(order.id).ok, true);
  const capturedAt = Date.now() - 30_000;
  positionHandler({
    coords: {
      latitude: -38.952,
      longitude: -68.059,
      accuracy: 12,
      heading: 95,
      speed: 8,
    },
    timestamp: capturedAt,
  });
  await tick();

  assert.equal(published.length, 1);
  assert.deepEqual(Object.keys(published[0].location).sort(), [
    'accuracy', 'heading', 'lat', 'lng', 'source', 'speed', 'timestamp',
  ]);
  assert.equal(published[0].location.timestamp, capturedAt);

  order = { ...order, workflowStatus: 'delivered' };
  assert.equal(controller.reconcile(), true);
  assert.deepEqual(cleared, [77]);
  assert.equal(controller.getSnapshot().state, 'idle');
});

test('un RPC colgado libera la publicación y permite enviar el fix siguiente', async () => {
  let positionHandler = null;
  let currentTime = Date.parse('2026-08-13T12:00:00.000Z');
  const published = [];
  const controller = createProductionRiderGpsController({
    repository: {
      updateRiderLocation(_orderId, location) {
        published.push(location);
        return published.length === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true });
      },
    },
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => activeOrder(),
    navigatorRef: {
      geolocation: {
        watchPosition(success) { positionHandler = success; return 91; },
        clearWatch() {},
      },
    },
    now: () => currentTime,
    publishTimeoutMs: 5,
  });

  controller.start('LT-GPS-1');
  positionHandler({
    coords: { latitude: -38.952, longitude: -68.059, accuracy: 12, heading: 95, speed: 8 },
    timestamp: currentTime,
  });
  await delay(15);
  assert.equal(controller.getSnapshot().publishing, false);
  assert.equal(controller.getSnapshot().state, 'error');

  currentTime += 20_000;
  positionHandler({
    coords: { latitude: -38.9521, longitude: -68.0591, accuracy: 10, heading: 96, speed: 8 },
    timestamp: currentTime,
  });
  await tick();

  assert.equal(published.length, 2);
  assert.equal(controller.getSnapshot().state, 'live');
  assert.equal(controller.getSnapshot().lastAcceptedFix.lat, -38.9521);
});

test('un permiso denegado corta el watcher y no deja captura activa', () => {
  const cleared = [];
  let denied;
  const controller = createProductionRiderGpsController({
    repository: { updateRiderLocation: async () => ({ ok: true }) },
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => activeOrder(),
    navigatorRef: {
      geolocation: {
        watchPosition(_success, error) { denied = error; return 42; },
        clearWatch(id) { cleared.push(id); },
      },
    },
  });
  controller.start('LT-GPS-1');
  denied({ code: 1 });
  assert.deepEqual(cleared, [42]);
  assert.equal(controller.getSnapshot().orderId, '');
});

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
