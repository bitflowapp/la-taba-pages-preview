import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

async function createDemoOrder(page) {
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-nav-view="cart"]:visible').first().click();
  await fillCheckout(page, {
    name: 'Hardening QA', phone: '2995550000', street: 'Mendoza 851', neighborhood: 'Centro',
    reference: 'Casa azul', notes: 'Tocar timbre', deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido creado. Simulación en este dispositivo.');
}

test('un GPS heredado nunca reactiva mapa, marker ni ETA en la presentación', async ({ page }) => {
  await installBrowserStubs(page);
  await page.goto('/?demo=1');
  await createDemoOrder(page);
  await page.evaluate(async () => {
    const { updateState } = await import('/js/state.js');
    updateState((draft) => {
      const order = draft.orders.find((candidate) => candidate.id === draft.lastOrderId);
      const now = new Date().toISOString();
      order.status = 'on_the_way';
      order.tracking = { lastLocation: { source: 'gps', lat: -38.95, lng: -68.05, lastFixAt: now, timestamp: Date.now() } };
      draft.simulation = { orderId: order.id, source: 'gps', mode: 'gps', gpsStatus: 'active', lat: -38.95, lng: -68.05, lastFixAt: now };
    });
  });

  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('[data-real-map], .lt-rider-marker, .map-route')).toHaveCount(0);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText('Seguimiento por estados, sin GPS ni ubicación en vivo.');
  await expect(tracking).not.toContainText(/\bETA\b|\d+(?:[.,]\d+)?\s*km/i);
});

test('?reset=1 limpia el pedido previo y deja el tracking vacío', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1&demo=1');
  await createDemoOrder(page);
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  await page.goto('/?reset=1&demo=1');
  await page.goto('/?demo=1#tracking');
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking).toContainText('No hay un pedido activo');
  await expect(tracking).not.toContainText('LT-0002');
  await expect(tracking.locator('[data-real-map], .lt-rider-marker')).toHaveCount(0);
  await guards.assertClean();
  await context.close();
});
