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
  await expect(page.locator('[data-sandbox-route]')).toContainText('En movimiento');

  await page.goto('/?demo=1#tracking');
  await expect(page.locator('[data-sandbox-tracking]')).toBeVisible();
  await expect(page.locator('[data-sandbox-tracking] [data-sandbox-eta]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-sandbox-tracking]')).toBeVisible();

  await page.goto('/?demo=1#rider');
  await page.locator('[data-sim-pause]').click();
  await expect(page.locator('[data-sandbox-route]')).toContainText('En pausa');
  await page.locator('[data-sim-start]').click();
  await page.locator(`[data-delivery-arrive="${orderId}"]`).click();

  await page.goto('/?demo=1#tracking');
  const code = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  expect(code).toMatch(/^\d{4}$/);
  await page.goto('/?demo=1#rider');
  await page.locator(`[data-delivery-code-input="${orderId}"]`).fill(code);
  await page.locator(`[data-delivery-code-confirm="${orderId}"]`).click();
  await page.locator(`[data-delivery-done="${orderId}"]`).click();

  await page.goto('/?demo=1#tracking');
  await expect(page.locator('[data-tracking-panel]')).toContainText('Pedido entregado');
  await expect(page.locator('[data-sandbox-tracking]')).toHaveCount(0);
  await page.goto('/?demo=1#home');
  await expect(page.locator('[data-view="home"] .reorder-card')).toBeVisible();
  await page.locator('[data-view="home"] .reorder-card').getByRole('button', { name: /Agregar de nuevo/i }).click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await guards.assertClean();
});
