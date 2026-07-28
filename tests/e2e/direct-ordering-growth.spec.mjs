import { expect, test } from '@playwright/test';
import {
  fillCheckout,
  installPageGuards,
  waitForToast,
} from './helpers.mjs';

test('Direct Ordering Growth Engine: recompra, cliente recurrente, fidelizacion y tracking honesto', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);

  await page.goto('/?reset=1&demo=1');
  await expectHomeSections(page, [
    '[data-view="home"] .home-search',
    '[data-category-strip="home"]',
    '[data-offers-rail]',
  ]);
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();

  await fillCheckout(page, {
    name: 'Cliente Growth',
    phone: '2995557777',
    street: 'Roca 123',
    neighborhood: 'Neuquen centro',
    reference: 'Porton azul',
    notes: 'Cortar fino',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.locator('[name="rememberCustomer"]').check();
  await expect(page.locator('[name="rememberCustomer"]').locator('..')).toContainText('Recordar mis datos');
  const paymentMethod = page.getByLabel('Forma de pago');
  await expect(paymentMethod).toBeVisible();
  await expect(paymentMethod).toHaveValue('transfer');
  await expect(paymentMethod.locator('option[value="coordinate"]')).toHaveText('A coordinar con el local');

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido confirmado/);
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
  await expect(page.locator('[data-tracking-panel] .tracking-hero h1')).toHaveText('Tu pedido fue confirmado');
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/pedido de muestra|no se envió|presentación/i);
  await expect(page.locator('[data-tracking-panel] [data-delivery-code]')).toHaveCount(0);
  await expect(page.locator('[data-tracking-panel] [data-tracking-gps-note]')).toHaveText('El pedido sigue en el local. La ubicación aparecerá cuando comience el reparto.');
  await expect(page.locator('[data-tracking-panel] [data-real-map]')).toHaveCount(0);
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\bETA\b/i);
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\b\d+(?:[.,]\d+)?\s*km\b/i);
  const orderSummary = page.locator('[data-tracking-panel] [data-order-summary-details]');
  await expect(orderSummary.locator('summary')).toContainText('Pedido LT-0002');
  await expect(orderSummary.locator('summary')).toContainText(/1 producto · Total \$[\d.]+/);
  await expect(orderSummary).not.toContainText('Resumen protegido');

  await markLatestOrderDelivered(page);
  await page.reload();
  await page.goto('/?demo=1#home');
  const reorderCard = page.locator('[data-view="home"] .reorder-card');
  await expect(reorderCard).toBeVisible();
  await expect(reorderCard).toContainText('Volver a pedir');
  await expectHomeSections(page, [
    '[data-customer-actions]',
    '[data-category-strip="home"]',
    '[data-offers-rail]',
  ]);
  await reorderCard.getByRole('button', { name: /Agregar de nuevo/i }).click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect(page.locator('[data-order-summary]')).toContainText('Total');
  await expect(page.locator('[name="customerName"]')).toHaveValue('Cliente Growth');
  await expect(page.locator('[name="customerPhone"]')).toHaveValue('2995557777');
  await expect(page.locator('[name="rememberCustomer"]')).toBeChecked();

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido confirmado/);
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  await openBusiness(page);
  await expect(page.locator('[data-business-dashboard]')).toContainText('Cliente recurrente');
  await expect(page.locator('[data-business-dashboard]')).toContainText('1 pedido previo');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Pedido repetido');
  await page.locator('[data-business-view="metrics"]').click();
  const growthMetrics = page.locator('[data-direct-ordering-metrics]');
  await expect(growthMetrics).toContainText('Pedidos creados');
  await expect(growthMetrics).toContainText('Clientes recurrentes');
  await expect(growthMetrics).toContainText('Pedidos repetidos');
  await expect(growthMetrics).toContainText('Entregas validadas');
  await expect(growthMetrics).not.toContainText('999');

  for (let index = 0; index < 3; index += 1) {
    await createRepeatOrderFromHome(page);
  }

  await openBusiness(page);
  await page.locator('[data-business-view="orders"]').click();
  await expect(page.locator('[data-business-dashboard]')).toContainText('Cliente frecuente: revisar beneficio');
  await expect(page.locator('[data-business-dashboard]')).toContainText('5 pedidos locales');

  await enableRealGpsForLatestOrder(page);
  await page.reload();
  await page.goto('/?demo=1#tracking');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel] [data-real-map]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel] .lt-rider-marker.source-gps')).toBeVisible();
  await expect(page.locator('[data-tracking-panel] .lt-rider-marker .lt-rider-helmet-icon[role="img"][aria-label="Casco del rider TABA"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel] [data-tracking-gps-note]')).toHaveCount(0);
  await expect(page.locator('[data-tracking-panel] .tracking-hero h1')).toHaveText('Tu pedido está en camino');
  await expect(page.locator('[data-tracking-panel] [data-map-meta-text]')).toHaveText(
    /^Última ubicación · (?:ahora|hace \d+ s|hace \d+ min)$/,
  );
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\bETA\b/i);
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\b\d+(?:[.,]\d+)?\s*km\b/i);

  await page.evaluate(() => {
    const key = 'la_taba_mvp_v4_state';
    const state = JSON.parse(localStorage.getItem(key));
    const order = state.orders[0];
    const delayedAt = Date.now() - 20_000;
    order.tracking.lastLocation.timestamp = delayedAt;
    order.tracking.lastLocation.lastFixAt = new Date(delayedAt).toISOString();
    order.tracking.updatedAt = new Date(delayedAt).toISOString();
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('[data-tracking-panel] [data-real-map]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel] [data-map-meta-text]')).toHaveText(
    /^Última ubicación · hace \d+ s$/,
  );

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/?demo=1#home');
    await expect(page.locator('[data-view="home"] .reorder-card')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goto('/?demo=1#cart');
    await expectNoHorizontalOverflow(page);
    await openBusiness(page);
    await expectNoHorizontalOverflow(page);
  }

  await guards.assertClean();
  await context.close();
});

async function createRepeatOrderFromHome(page) {
  await page.goto('/?demo=1#home');
  const reorderCard = page.locator('[data-view="home"] .reorder-card');
  await expect(reorderCard).toBeVisible();
  await reorderCard.getByRole('button', { name: /Agregar de nuevo/i }).click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect(page.locator('[data-order-summary]')).toContainText('Total');
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido confirmado/);
}

async function openBusiness(page) {
  await page.goto('/?demo=1#business');
  if (await page.locator('[data-pin-modal]').isVisible().catch(() => false)) {
    await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
  } else if (await page.locator('[data-open-pin][data-admin-target="business"]').isVisible().catch(() => false)) {
    await page.locator('[data-open-pin][data-admin-target="business"]').click();
    await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
  }
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  const dashboard = page.locator('[data-business-dashboard]');
  await expect(dashboard).toBeVisible();
  await expect(dashboard.locator('[data-business-view="orders"]')).toBeVisible();
  await expect(dashboard.locator('[data-business-workspace]')).toBeVisible();
}

async function enableRealGpsForLatestOrder(page) {
  await page.evaluate(() => {
    const key = 'la_taba_mvp_v4_state';
    const state = JSON.parse(localStorage.getItem(key));
    const order = state.orders[0];
    const now = new Date().toISOString();
    order.status = 'on_the_way';
    order.statusHistory = [...(order.statusHistory || []), { status: 'on_the_way', at: now }];
    order.tracking = {
      lastLocation: {
        source: 'gps',
        lat: -38.951,
        lng: -68.059,
        accuracy: 12,
        lastFixAt: now,
        timestamp: Date.now(),
      },
      source: 'gps',
      updatedAt: now,
    };
    order.delivery = {
      ...(order.delivery || {}),
      currentLocationLabel: 'El repartidor salio del local',
    };
    state.lastOrderId = order.id;
    localStorage.setItem(key, JSON.stringify(state));
  });
}

async function markLatestOrderDelivered(page) {
  await page.evaluate(async () => {
    const [{ getState, updateState }, { updateCustomerOrderSnapshot }] = await Promise.all([
      import('/js/state.js'),
      import('/js/core/customer-history.js'),
    ]);
    updateState((draft) => {
      const order = draft.orders.find((candidate) => candidate.id === draft.lastOrderId) || draft.orders[0];
      if (!order) return;
      const at = new Date().toISOString();
      order.status = 'delivered';
      order.statusHistory = [...(order.statusHistory || []), { status: 'delivered', at }];
      draft.lastOrderId = null;
    });
    const order = getState().orders.find((candidate) => candidate.id === getState().lastOrderId)
      || getState().orders[0];
    if (order) updateCustomerOrderSnapshot(order);
  });
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(Math.max(overflow.doc, overflow.body)).toBeLessThanOrEqual(overflow.width + 1);
}

async function expectHomeSections(page, selectors) {
  for (const selector of selectors) {
    await expect(page.locator(selector)).toBeVisible();
  }
}
