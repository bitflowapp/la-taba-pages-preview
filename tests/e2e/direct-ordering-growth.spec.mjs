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

  await page.goto('/?reset=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();

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
  await expect(page.locator('.remember-customer-row')).toContainText('Recordar mis datos');
  await expect(page.locator('[data-payment-note]')).toContainText('La app no procesa pagos reales');

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido creado/);
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
  await expect(page.locator('[data-tracking-panel]')).toContainText('Código');
  await expect(page.locator('[data-tracking-panel] [data-tracking-gps-note]')).toHaveCount(1);
  await expect(page.locator('[data-tracking-panel] [data-real-map]')).toHaveCount(0);
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\bETA\b/i);
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\b\d+(?:[.,]\d+)?\s*km\b/i);

  await page.reload();
  await page.goto('/#home');
  const reorderCard = page.locator('.reorder-card');
  await expect(reorderCard).toBeVisible();
  await expect(reorderCard).toContainText('Pedir de nuevo');
  await expect(reorderCard).toContainText('Total estimado');
  await expect(reorderCard).toContainText('Dirección usada');

  await reorderCard.getByRole('button', { name: /Editar antes de confirmar/i }).click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect(page.locator('[data-order-summary]')).toContainText('Total');
  await expect(page.locator('[name="customerName"]')).toHaveValue('Cliente Growth');
  await expect(page.locator('[name="customerPhone"]')).toHaveValue('2995557777');
  await expect(page.locator('[name="rememberCustomer"]')).toBeChecked();

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido creado/);
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  await openBusiness(page);
  await expect(page.locator('[data-business-dashboard]')).toContainText('Cliente recurrente');
  await expect(page.locator('[data-business-dashboard]')).toContainText('1 pedido previo');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Pedido repetido');
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
  await expect(page.locator('[data-business-dashboard]')).toContainText('Cliente frecuente: revisar beneficio');
  await expect(page.locator('[data-business-dashboard]')).toContainText('5 pedidos locales');

  await enableRealGpsForLatestOrder(page);
  await page.reload();
  await page.goto('/#tracking');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel] [data-real-map]')).toHaveCount(1);
  await expect(page.locator('[data-tracking-panel] .lt-rider-marker')).toHaveCount(1);
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\bETA\b/i);
  await expect(page.locator('[data-tracking-panel]')).not.toContainText(/\b\d+(?:[.,]\d+)?\s*km\b/i);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/#home');
    await expect(page.locator('.reorder-card')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goto('/#cart');
    await expectNoHorizontalOverflow(page);
    await openBusiness(page);
    await expectNoHorizontalOverflow(page);
  }

  await guards.assertClean();
  await context.close();
});

async function createRepeatOrderFromHome(page) {
  await page.goto('/#home');
  await expect(page.locator('.reorder-card')).toBeVisible();
  await page.locator('.reorder-card').getByRole('button', { name: /Repetir pedido/i }).click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect(page.locator('[data-order-summary]')).toContainText('Total');
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido creado/);
}

async function openBusiness(page) {
  await page.goto('/#business');
  if (await page.locator('[data-pin-modal]').isVisible().catch(() => false)) {
    await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
  } else if (await page.locator('[data-open-pin][data-admin-target="business"]').isVisible().catch(() => false)) {
    await page.locator('[data-open-pin][data-admin-target="business"]').click();
    await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
  }
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-business-dashboard]')).toContainText('Central de pedidos');
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

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(Math.max(overflow.doc, overflow.body)).toBeLessThanOrEqual(overflow.width + 1);
}
