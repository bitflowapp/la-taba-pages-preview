import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, seedCartAboveMinimum, waitForToast } from './helpers.mjs';

async function createDemoOrder(page) {
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await seedCartAboveMinimum(page);
  await page.locator('[data-floating-cart]:visible, .topbar [data-open-cart]:visible').first().click();
  await fillCheckout(page, {
    name: 'Hardening QA', phone: '2995550000', street: 'Mendoza 851', neighborhood: 'Centro',
    reference: 'Casa azul', notes: 'Tocar timbre', deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
}

test('un GPS local sandbox se presenta en mapa sin inventar ETA', async ({ page }) => {
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
  await expect(tracking.locator(
    '[data-real-map][data-map-source="sandbox"][data-map-status="ready"]',
  )).toHaveCount(1, { timeout: 15_000 });
  await expect(tracking.locator('.lt-rider-marker')).toHaveCount(1);
  await expect(tracking.locator('.lt-place-marker.is-store')).toHaveCount(1);
  await expect(tracking.locator('.lt-place-marker.is-destination')).toHaveCount(1);
  await expect(tracking.locator('.taba-sandbox-route')).toHaveCount(0);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveCount(0);
  await expect(tracking.locator('[data-sandbox-eta]')).toHaveCount(0);
});

test('?reset=1 limpia el pedido previo y deja el tracking vacío', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1');
  await createDemoOrder(page);
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.goto('/?demo=1#tracking');
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking).toContainText('Todavía no hay un pedido en curso');
  await expect(tracking).not.toContainText('LT-0002');
  await expect(tracking.locator('[data-real-map], .lt-rider-marker')).toHaveCount(0);
  await guards.assertClean();
  await context.close();
});
