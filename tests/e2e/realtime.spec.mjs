import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

test('la presentación permanece local aunque la URL incluya parámetros de relay', async ({ page }) => {
  await installPageGuards(page);
  await page.goto('/?demo=1&relay=http%3A%2F%2F127.0.0.1%3A18787&room=honesty#rider');
  await page.locator('[data-view="rider"] [data-open-pin]').click();
  await page.getByLabel('Código del modo negocio').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');

  const panel = page.locator('[data-delivery-panel]');
  await expect(panel).toContainText('Vista de reparto');
  await expect(panel).not.toContainText('En vivo entre equipos');
  await expect(panel.locator('[data-retry-relay], [data-real-map], [data-sim-gps]')).toHaveCount(0);
});

test('cliente, negocio y rider completan el recorrido en el mismo dispositivo sin GPS', async ({ page }) => {
  await installBrowserStubs(page);
  await page.goto('/?reset=1&demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Walter Local', phone: '2995551234', street: 'Roca 123', neighborhood: 'Neuquén centro',
    notes: 'Tocar timbre', deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  const code = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');

  await page.locator('.topbar .brand').click();
  await page.locator('[data-admin-toggle]').click();
  await page.getByLabel('Código del modo negocio').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.getByRole('button', { name: /Vista rider/i }).click();
  await expect(page.locator('[data-delivery-panel]')).toContainText('Vista de reparto');
  await expect(page.locator('[data-delivery-panel] [data-real-map], [data-delivery-panel] [data-sim-gps]')).toHaveCount(0);
  await page.locator('[data-delivery-leave="LT-0002"]').click();
  await page.locator('[data-delivery-arrive="LT-0002"]').click();

  await page.locator('[data-delivery-code-input="LT-0002"]').fill(code);
  await page.locator('[data-delivery-code-confirm="LT-0002"]').click();
  await page.locator('[data-delivery-done="LT-0002"]').click();
  await expect(page.locator('[data-delivery-panel]')).toContainText('Sin entregas asignadas');
});
