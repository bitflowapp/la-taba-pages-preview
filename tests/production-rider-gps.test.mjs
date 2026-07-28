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
  positionHandler({
    coords: {
      latitude: -38.952,
      longitude: -68.059,
      accuracy: 12,
      heading: 95,
      speed: 8,
    },
    timestamp: Date.now(),
  });
  await tick();

  assert.equal(published.length, 1);
  assert.deepEqual(Object.keys(published[0].location).sort(), [
    'accuracy', 'heading', 'lat', 'lng', 'source', 'speed',
  ]);
  assert.equal(Object.hasOwn(published[0].location, 'timestamp'), false);

  order = { ...order, workflowStatus: 'delivered' };
  assert.equal(controller.reconcile(), true);
  assert.deepEqual(cleared, [77]);
  assert.equal(controller.getSnapshot().state, 'idle');
});

test('expone el fix local válido antes de que termine la publicación remota', async () => {
  let positionHandler = null;
  let resolvePublish;
  const snapshots = [];
  const publication = new Promise((resolve) => {
    resolvePublish = resolve;
  });
  const controller = createProductionRiderGpsController({
    repository: {
      async updateRiderLocation() {
        await publication;
        return { ok: true };
      },
    },
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => activeOrder(),
    navigatorRef: {
      geolocation: {
        watchPosition(success) {
          positionHandler = success;
          return 91;
        },
        clearWatch() {},
      },
    },
    onChange: (snapshot) => snapshots.push(snapshot),
  });

  controller.start('LT-GPS-1');
  positionHandler({
    coords: {
      latitude: -38.952,
      longitude: -68.059,
      accuracy: 10,
      heading: 120,
      speed: 2,
    },
    timestamp: Date.now(),
  });
  await tick();

  const localSnapshot = snapshots.find((snapshot) => snapshot.lastAcceptedFix);
  assert.equal(localSnapshot.lastAcceptedFix.lat, -38.952);
  assert.equal(localSnapshot.lastPublishedFix, null);
  assert.equal(controller.getSnapshot().state, 'publishing');

  resolvePublish();
  await tick();
  assert.equal(controller.getSnapshot().state, 'live');
  controller.stop();
});

test('mantiene actualizado el fix local mientras una publicación remota sigue pendiente', async () => {
  let positionHandler = null;
  let resolvePublish;
  let publishAttempts = 0;
  let clock = Date.now();
  const publication = new Promise((resolve) => {
    resolvePublish = resolve;
  });
  const controller = createProductionRiderGpsController({
    repository: {
      async updateRiderLocation() {
        publishAttempts += 1;
        await publication;
        return { ok: true };
      },
    },
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => activeOrder(),
    navigatorRef: {
      geolocation: {
        watchPosition(success) {
          positionHandler = success;
          return 92;
        },
        clearWatch() {},
      },
    },
    now: () => clock,
  });

  controller.start('LT-GPS-1');
  positionHandler({
    coords: {
      latitude: -38.952,
      longitude: -68.059,
      accuracy: 10,
      heading: 120,
      speed: 2,
    },
    timestamp: clock,
  });
  await tick();
  assert.equal(publishAttempts, 1);
  assert.equal(controller.getSnapshot().state, 'publishing');

  clock += 1_000;
  positionHandler({
    coords: {
      latitude: -38.95205,
      longitude: -68.05905,
      accuracy: 9,
      heading: 125,
      speed: 2,
    },
    timestamp: clock,
  });
  await tick();

  assert.equal(controller.getSnapshot().lastAcceptedFix.lat, -38.95205);
  assert.equal(controller.getSnapshot().lastAcceptedFix.lng, -68.05905);
  assert.equal(controller.getSnapshot().state, 'publishing');
  assert.equal(publishAttempts, 1, 'la escritura remota continúa serializada');

  resolvePublish();
  await tick();
  assert.equal(controller.getSnapshot().lastAcceptedFix.lat, -38.95205);
  assert.equal(controller.getSnapshot().state, 'live');
  controller.stop();
});

test('publica el último fix material encolado después de una escritura remota lenta', async () => {
  let positionHandler = null;
  let resolveFirstPublish;
  let clock = Date.now();
  const published = [];
  const firstPublication = new Promise((resolve) => {
    resolveFirstPublish = resolve;
  });
  const controller = createProductionRiderGpsController({
    repository: {
      async updateRiderLocation(_orderId, location) {
        published.push(location);
        if (published.length === 1) await firstPublication;
        return { ok: true };
      },
    },
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => activeOrder(),
    navigatorRef: {
      geolocation: {
        watchPosition(success) {
          positionHandler = success;
          return 93;
        },
        clearWatch() {},
      },
    },
    now: () => clock,
  });

  controller.start('LT-GPS-1');
  positionHandler({
    coords: {
      latitude: -38.952,
      longitude: -68.059,
      accuracy: 10,
      heading: 120,
      speed: 4,
    },
    timestamp: clock,
  });
  await tick();

  clock += 12_000;
  positionHandler({
    coords: {
      latitude: -38.9523,
      longitude: -68.0593,
      accuracy: 9,
      heading: 125,
      speed: 4,
    },
    timestamp: clock,
  });
  await tick();
  assert.equal(published.length, 1);
  assert.equal(controller.getSnapshot().lastAcceptedFix.lat, -38.9523);

  resolveFirstPublish();
  await tick();
  await tick();

  assert.equal(published.length, 2);
  assert.equal(published[1].lat, -38.9523);
  assert.equal(published[1].lng, -68.0593);
  assert.equal(controller.getSnapshot().lastPublishedFix.lat, -38.9523);
  assert.equal(controller.getSnapshot().state, 'live');
  controller.stop();
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
  assert.equal(controller.getSnapshot().watchId, null);
  assert.equal(controller.getSnapshot().orderId, 'LT-GPS-1');
  assert.equal(controller.getSnapshot().state, 'error');
  assert.match(controller.getSnapshot().message, /denegado/i);
});

test('un rechazo de autoridad corta el watcher y conserva el diagnostico del pedido', async () => {
  const authorityMessage = 'Pedido no asignado a este rider.';
  const cleared = [];
  const snapshots = [];
  let positionHandler = null;
  const controller = createProductionRiderGpsController({
    repository: {
      async updateRiderLocation() {
        return { ok: false, message: authorityMessage };
      },
    },
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => activeOrder(),
    navigatorRef: {
      geolocation: {
        watchPosition(success) {
          positionHandler = success;
          return 120;
        },
        clearWatch(id) { cleared.push(id); },
      },
    },
    onChange: (snapshot) => snapshots.push(snapshot),
  });

  assert.equal(controller.start('LT-GPS-1').ok, true);
  positionHandler({
    coords: {
      latitude: -38.952,
      longitude: -68.059,
      accuracy: 10,
      heading: 80,
      speed: 3,
    },
    timestamp: Date.now(),
  });
  await tick();
  await tick();

  const snapshot = controller.getSnapshot();
  assert.deepEqual(cleared, [120]);
  assert.equal(snapshot.watchId, null);
  assert.equal(snapshot.orderId, 'LT-GPS-1');
  assert.equal(snapshot.state, 'error');
  assert.equal(snapshot.message, authorityMessage);
  assert.ok(
    snapshots.some((candidate) => (
      candidate.orderId === 'LT-GPS-1'
      && candidate.state === 'error'
      && candidate.message === authorityMessage
    )),
    'el consumidor recibe el rechazo de autoridad exacto',
  );
});

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}
