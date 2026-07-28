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
