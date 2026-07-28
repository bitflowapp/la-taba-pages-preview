import { expect, test } from '@playwright/test';
import { fillCheckout, installPageGuards, waitForToast } from './helpers.mjs';

test('sandbox persists, synchronizes between tabs, exports/imports and resets', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await context.newPage();
  const business = await context.newPage();
  installPageGuards(client);
  installPageGuards(business);

  await client.goto('/?reset=1&demo=1&tools=1#home');
  await expect(client.locator('[data-sandbox-tools]')).toBeVisible();
  await client.locator('[data-sandbox-action="seed-order"]').click();
  await expect.poll(() => client.evaluate(() => {
    return import('/js/state.js').then(({ getState }) => getState().orders.filter((order) => !order.internalSeed).length);
  })).toBe(1);

  const orderId = await client.evaluate(() => import('/js/state.js').then(({ getState }) => getState().lastOrderId));
  await client.reload();
  await expect.poll(() => client.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().orders.find((order) => order.id === getState().lastOrderId)?.id || null;
  })).toBe(orderId);

  await business.goto('/?demo=1&tools=1#business');
  await expect(business.locator('[data-sandbox-tools]')).toBeVisible();
  await client.evaluate(async (id) => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    return getOrderRepository().updateOrderStatus(id, 'accepted');
  }, orderId);
  await expect.poll(() => business.evaluate(async (id) => {
    const { getState } = await import('/js/state.js');
    return getState().orders.find((order) => order.id === id)?.status;
  }, orderId)).toBe('preparing');

  await client.evaluate(async (id) => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    return getOrderRepository().updateOrderStatus(id, 'ready');
  }, orderId);
  const [claimA, claimB] = await Promise.all([
    client.evaluate(async (id) => {
      const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
      return getOrderRepository().claimRiderOrder(id, { riderId: 'sandbox-rider-a' });
    }, orderId),
    business.evaluate(async (id) => {
      const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
      return getOrderRepository().claimRiderOrder(id, { riderId: 'sandbox-rider-b' });
    }, orderId),
  ]);
  expect([claimA.ok, claimB.ok].filter(Boolean)).toHaveLength(1);
  expect([claimA.ok, claimB.ok].filter((ok) => !ok)).toHaveLength(1);

  const invalidTransition = await client.evaluate(async (id) => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    return getOrderRepository().updateOrderStatus(id, 'delivered');
  }, orderId);
  expect(invalidTransition.ok).toBe(false);

  const downloadPromise = client.waitForEvent('download');
  await client.locator('[data-sandbox-action="export"]').click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  expect(exportPath).toBeTruthy();

  await client.locator('[data-sandbox-action="reset"]').click();
  await expect.poll(() => client.evaluate(() => import('/js/state.js').then(({ getState }) => (
    getState().orders.filter((order) => !order.internalSeed).length
  )))).toBe(0);
  await client.locator('[data-sandbox-import]').setInputFiles(exportPath);
  await expect.poll(() => client.evaluate(() => import('/js/state.js').then(({ getState }) => (
    getState().orders.filter((order) => !order.internalSeed).length
  )))).toBe(1);

  await context.close();
});

test('sandbox tools stay isolated from production mode', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?tools=1#home');
  await expect(page.locator('[data-sandbox-tools]')).toHaveCount(0);
  const mode = await page.evaluate(async () => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    return getOrderRepository().mode;
  });
  expect(mode).not.toBe('sandbox');
  expect(errors).toEqual([]);
});

test('tracking recovers the newest persisted sandbox state on returning to the foreground', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await context.newPage();
  const tracking = await context.newPage();
  installPageGuards(client);
  installPageGuards(tracking);

  // Reproduce an Android background tab: neither its BroadcastChannel nor the
  // storage event can advance its in-memory state. The foreground hook must
  // read IndexedDB when Tracking becomes active again.
  await tracking.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true });
    window.addEventListener('storage', (event) => event.stopImmediatePropagation(), true);
  });

  await client.goto('/?reset=1&demo=1&tools=1#home');
  await client.locator('[data-sandbox-action="seed-order"]').click();
  const orderId = await client.evaluate(() => import('/js/state.js').then(({ getState }) => getState().lastOrderId));

  await tracking.goto('/?demo=1#tracking');
  await expect.poll(() => tracking.evaluate(async (id) => {
    const { getState } = await import('/js/state.js');
    return getState().orders.find((order) => order.id === id)?.status;
  }, orderId)).toBe('received');

  await client.evaluate(async (id) => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    return getOrderRepository().updateOrderStatus(id, 'accepted');
  }, orderId);
  await tracking.waitForTimeout(150);
  expect(await tracking.evaluate(async (id) => {
    const { getState } = await import('/js/state.js');
    return getState().orders.find((order) => order.id === id)?.status;
  }, orderId)).toBe('received');

  await tracking.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => tracking.evaluate(async (id) => {
    const { getState } = await import('/js/state.js');
    return getState().orders.find((order) => order.id === id)?.status;
  }, orderId)).toBe('preparing');

  await context.close();
});

test('sandbox paints the customer surface before a delayed IndexedDB hydration finishes', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open: () => ({}) },
    });
  });

  await page.goto('/?demo=1#home');
  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  await expect(page.locator('[data-view="home"]')).not.toBeEmpty();
  await guards.assertClean();
  await context.close();
});

test('sandbox completes client, business, rider, route, delivery and reorder', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.goto('/?reset=1&demo=1#home');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Cliente Sandbox',
    phone: '2995550101',
    street: 'Mendoza 851',
    neighborhood: 'Centro',
    reference: 'Portón gris',
    notes: 'Pedido de prueba',
  });
  await page.locator('[name="rememberCustomer"]').check();
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido confirmado/);

  const orderId = await page.evaluate(() => import('/js/state.js').then(({ getState }) => getState().lastOrderId));
  await page.goto('/?demo=1#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator(`[data-order-advance="${orderId}"]`).click();
  await page.locator(`[data-order-advance="${orderId}"]`).click();

  await page.goto('/?demo=1#rider');
  await page.locator(`[data-rider-accept="${orderId}"]`).click();
  await page.locator(`[data-delivery-leave="${orderId}"]`).click();
  await expect(page.locator('[data-sandbox-route]')).toBeVisible();
  await page.locator('[data-sim-start]').click();
  await expect(page.locator('[data-sandbox-route]')).toContainText('Seguimiento activo');
  await expect(page.locator('[data-delivery-panel] [data-real-map][data-map-source="sandbox"][data-map-engine="maplibre"]')).toHaveCount(1);
  await expect(page.locator('[data-delivery-panel] [data-real-map][data-map-status="ready"]')).toHaveCount(1);
  await expect(page.locator('[data-delivery-panel] .lt-place-marker.is-store')).toHaveCount(1);
  await expect(page.locator('[data-delivery-panel] .lt-place-marker.is-destination')).toHaveCount(1);
  await expect(page.locator('[data-delivery-panel] .lt-rider-marker')).toHaveCount(1);
  await expect(page.locator('[data-delivery-panel] [data-real-map][data-route-source="simulation"]')).toHaveCount(1);

  await page.goto('/?demo=1#tracking');
  await expect(page.locator('[data-sandbox-tracking]')).toBeVisible();
  await expect(page.locator('[data-sandbox-tracking] [data-real-map][data-map-source="sandbox"][data-map-engine="maplibre"][data-map-status="ready"]')).toHaveCount(1);
  await expect(page.locator('[data-sandbox-tracking] .lt-place-marker.is-store')).toHaveCount(1);
  await expect(page.locator('[data-sandbox-tracking] .lt-place-marker.is-destination')).toHaveCount(1);
  await expect(page.locator('[data-sandbox-tracking] .lt-rider-marker')).toHaveCount(1);
  await expect(page.locator('[data-sandbox-tracking] [data-sandbox-eta]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-sandbox-tracking]')).toBeVisible();

  await page.goto('/?demo=1#rider');
  await page.locator('[data-sim-pause]').click();
  await expect(page.locator('[data-sandbox-route]')).toContainText('Seguimiento pausado');
  await page.locator('[data-sim-start]').click();
  await page.locator(`[data-delivery-arrive="${orderId}"]`).click();

  await page.goto('/?demo=1#tracking');
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido llegó');
  await expect(tracking).not.toContainText('0 min');
  await expect(page.locator('[data-sandbox-eta]').first()).toContainText('Llegó');
  const arrivedTimeline = tracking.getByRole('list', { name: 'Progreso del pedido' });
  await expect(arrivedTimeline.getByRole('listitem')).toHaveCount(4);
  await expect(arrivedTimeline.locator('.track-step.done, .track-step.current')).toHaveCount(3);
  await expect(arrivedTimeline.locator('.track-step.current')).toHaveText('En camino');
  await expect(arrivedTimeline.locator('.track-step.pending')).toHaveText('Entregado');
  const code = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  expect(code).toMatch(/^\d{4}$/);
  await page.goto('/?demo=1#rider');
  await page.locator(`[data-delivery-code-input="${orderId}"]`).fill(code);
  await page.locator(`[data-delivery-code-confirm="${orderId}"]`).click();
  await page.locator(`[data-delivery-done="${orderId}"]`).click();

  await page.goto('/?demo=1#tracking');
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Pedido entregado');
  const deliveredTimeline = tracking.getByRole('list', { name: 'Progreso del pedido' });
  await expect(deliveredTimeline.getByRole('listitem')).toHaveCount(4);
  await expect(deliveredTimeline.locator('.track-step.done, .track-step.current')).toHaveCount(4);
  await expect(deliveredTimeline.locator('.track-step.current')).toHaveText('Entregado');
  await expect(deliveredTimeline.locator('.track-step.pending')).toHaveCount(0);
  await expect(tracking.locator('[data-delivery-code-card]')).toHaveCount(0);
  await expect(page.locator('[data-sandbox-tracking]')).toHaveCount(0);
  await page.goto('/?demo=1#home');
  await expect(page.locator('[data-view="home"] .reorder-card')).toBeVisible();
  await page.locator('[data-view="home"] .reorder-card').getByRole('button', { name: /Agregar de nuevo/i }).click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await guards.assertClean();
});
