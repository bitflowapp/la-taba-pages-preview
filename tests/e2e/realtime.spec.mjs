import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

const RELAY_PORT = Number.parseInt(process.env.TABA_E2E_RELAY_PORT || '18787', 10);
const RELAY_URL = encodeURIComponent(`http://127.0.0.1:${RELAY_PORT}`);

test('el preview privado ignora parámetros de relay y mantiene la operación local', async ({ page }) => {
  await installPageGuards(page);
  await page.goto(`/?demo=1&relay=${RELAY_URL}&room=honesty#rider`);
  await page.locator('[data-view="rider"] [data-open-pin]').click();
  await page.getByLabel('Código del modo negocio').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');

  const panel = page.locator('[data-delivery-panel]');
  await expect(panel).toContainText('Sin entregas disponibles');
  await expect(panel).not.toContainText('En vivo entre equipos');
  await expect(panel.locator('[data-retry-relay], [data-real-map], [data-sim-gps]')).toHaveCount(0);
});

test('cliente, negocio y rider completan el recorrido en el mismo dispositivo sin GPS', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Walter Local', phone: '2995551234', street: 'Roca 123', neighborhood: 'Neuquén centro',
    notes: 'Tocar timbre', deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido fue confirmado');
  await expect(tracking.locator('.track-steps.public')).toBeVisible();
  await expect(tracking.locator('.track-steps.public')).toContainText('Confirmado');
  await expect(tracking.locator('.track-steps.public')).toContainText('Preparando');
  await expect(tracking.locator('.track-steps.public')).toContainText('En camino');
  await expect(tracking.locator('.track-steps.public')).toContainText('Entregado');
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText('El pedido sigue en el local. La ubicación aparecerá cuando comience el reparto.');
  await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  await expect(page.locator('[data-delivery-code]')).toHaveCount(0);

  await page.locator('.topbar .brand').click();
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.getByLabel('Código del modo negocio').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.locator('[data-order-advance="LT-0002"]').click();

  await page.goto('/?demo=1#rider');
  const riderPanel = page.locator('[data-delivery-panel]');
  await expect(riderPanel.locator('[data-rider-assignment-preview="LT-0002"]')).toBeVisible();
  await expect(riderPanel).toContainText('Pedido listo para repartir');
  await expect(riderPanel.locator('[data-real-map], [data-sim-gps]')).toHaveCount(0);
  await page.locator('[data-rider-accept="LT-0002"]').click();
  await page.locator('[data-delivery-leave="LT-0002"]').click();
  await page.locator('[data-delivery-arrive="LT-0002"]').click();

  await page.goto('/?demo=1#tracking');
  const code = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  expect(code).toMatch(/^\d{4}$/);
  await page.goto('/?demo=1#rider');
  await page.locator('[data-delivery-code-input="LT-0002"]').fill(code);
  await page.locator('[data-delivery-code-confirm="LT-0002"]').click();
  await page.locator('[data-delivery-done="LT-0002"]').click();
  await expect(page.locator('[data-delivery-panel]')).toContainText('Sin entregas disponibles');
});
