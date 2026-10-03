import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

// These are browser-contract focales: they execute the shipped ES modules in
// Chromium. They do not simulate a GPS PASS and do not replace the Moto G15 or
// staging evidence required by Gate 2.

test('el watcher rider conserva una intención autorizada y se recupera al volver visible', async ({ page }) => {
  await installBrowserStubs(page);
  installPageGuards(page);
  await page.goto('/?demo=1', { waitUntil: 'load' });

  const result = await page.evaluate(async () => {
    const { createProductionRiderGpsController } = await import('/js/tracking/production_rider_gps.js');
    const riderId = 'rider-browser-gate2';
    const order = {
      id: 'LT-BROWSER-GATE2',
      deliveryMode: 'delivery',
      assignedRiderId: riderId,
      workflowStatus: 'on_the_way',
    };
    let watchCount = 0;
    const cleared = [];
    const controller = createProductionRiderGpsController({
      getAccess: () => ({ user: { id: riderId }, membership: { role: 'rider' } }),
      getOrder: () => order,
      navigatorRef: {
        geolocation: {
          watchPosition() { watchCount += 1; return watchCount; },
          clearWatch(id) { cleared.push(id); },
        },
      },
    });
    const started = controller.start(order.id);
    const paused = controller.pause();
    const resumed = controller.resume();
    return {
      started: started.ok,
      paused,
      resumed,
      watchCount,
      cleared,
      state: controller.getSnapshot().state,
    };
  });

  expect(result).toEqual({
    started: true,
    paused: true,
    resumed: true,
    watchCount: 2,
    cleared: [1],
    state: 'requesting',
  });
});

test('el navegador clasifica freshness sin convertir un fix viejo en GPS en vivo', async ({ page }) => {
  await installBrowserStubs(page);
  installPageGuards(page);
  await page.goto('/?demo=1', { waitUntil: 'load' });

  const freshness = await page.evaluate(async () => {
    const { trackingLocationFreshness } = await import('/js/map/route_geometry.js');
    const now = Date.now();
    return {
      fresh: trackingLocationFreshness({
        lat: -38.95,
        lng: -68.06,
        accuracy: 12,
        source: 'gps',
        lastFixAt: new Date(now - 5_000).toISOString(),
      }, { now }),
      delayed: trackingLocationFreshness({
        lat: -38.95,
        lng: -68.06,
        accuracy: 12,
        source: 'gps',
        lastFixAt: new Date(now - 25_000).toISOString(),
      }, { now }),
      lost: trackingLocationFreshness({
        lat: -38.95,
        lng: -68.06,
        accuracy: 12,
        source: 'gps',
        lastFixAt: new Date(now - 60_000).toISOString(),
      }, { now }),
    };
  });

  expect(freshness).toEqual({ fresh: 'fresh', delayed: 'delayed', lost: 'lost' });
});

