import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

test('Delivery code: cliente ve codigo, rider confirma y negocio lo audita', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1&demo=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();
  await fillCheckout(page, {
    name: 'Cliente Codigo',
    phone: '2995551212',
    street: 'Roca 222',
    neighborhood: 'Centro',
    reference: 'Porton negro',
    notes: '',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado');

  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Pedido confirmado');
  await expect(tracking.locator('[data-delivery-code-card]')).toHaveCount(0);

  await page.goto('/?demo=1#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toBeVisible();
  await page.locator('[data-inbox-order="LT-0002"] [data-prep-minutes]').selectOption('20');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');

  await page.goto('/?demo=1#rider');
  await page.locator('[data-rider-accept="LT-0002"]').click();
  await waitForToast(page, 'Entrega aceptada. Ya podés ver los datos del pedido.');
  await page.locator('[data-delivery-leave="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como en camino.');
  await page.locator('[data-delivery-arrive="LT-0002"]').click();
  await waitForToast(page, 'Llegada al domicilio registrada.');

  await page.goto('/?demo=1#tracking');
  await expect(tracking.locator('[data-delivery-code-card]')).toBeVisible();
  const code = await tracking.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  expect(code).toMatch(/^\d{4}$/);

  await page.goto('/?demo=1#rider');
  const riderPanel = page.locator('[data-delivery-panel]');
  await expect(riderPanel.locator('[data-delivery-code-panel]')).toBeVisible();
  await riderPanel.locator('[data-delivery-code-input="LT-0002"]').fill('0000');
  await riderPanel.locator('[data-delivery-code-confirm="LT-0002"]').click();
  await waitForToast(page, 'Código incorrecto. Revisalo con el cliente.');

  await riderPanel.locator('[data-delivery-code-input="LT-0002"]').fill(code);
  await riderPanel.locator('[data-delivery-code-confirm="LT-0002"]').click();
  await waitForToast(page, 'Código de entrega confirmado.');
  await expect(riderPanel.locator('[data-delivery-code-panel]')).toContainText('Código de entrega confirmado');

  await page.goto('/?demo=1#business');
  await expect(page.locator('[data-delivery-code-summary="LT-0002"]')).toContainText('Código validado');

  await page.goto('/?demo=1#rider');
  await page.locator('[data-delivery-done="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como entregado.');
  await page.goto('/?demo=1#tracking');
  await expect(tracking).toContainText('¡Disfrutalo!');
  await expect(tracking.locator('[data-delivery-code]')).toHaveCount(0);
  await expect(tracking.locator('[data-delivery-code-card]')).toContainText('Entrega validada');

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
