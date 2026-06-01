import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

// Central de pedidos v1: el pedido del cliente entra al negocio, se ve completo
// y el negocio lo gestiona. Mobile-first 390x844, sin geografía falsa.
test('Central de pedidos: el pedido entra, se ve completo y el negocio lo gestiona', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1');

  // 1. Negocio sin pedidos: empty state claro.
  await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  await page.locator('[data-view="profile"] [data-open-admin-view="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-business-dashboard]')).toContainText('Central de pedidos');
  await expect(page.locator('[data-order-inbox]')).toContainText('Todavía no entraron pedidos');

  // 2. El cliente confirma un pedido con dirección real.
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Walter Cliente',
    phone: '2995551234',
    street: 'Mendoza 851',
    neighborhood: 'Centro',
    reference: 'Portón gris',
    notes: 'Sin sal',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido creado. Ya podés seguirlo en tiempo real.');

  // 3. El negocio ve el pedido en la Central de pedidos, completo.
  // (La nav inferior se oculta en Seguimiento: volvemos al inicio por el logo.)
  await page.locator('.topbar .brand').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  await page.locator('[data-view="profile"] [data-open-admin-view="business"]').click();
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-order-inbox]')).toContainText('Pedidos nuevos');

  const card = page.locator('[data-inbox-order="LT-0002"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('LT-0002');
  await expect(card).toContainText('Recibido');
  await expect(card).toContainText('Walter Cliente');
  await expect(card).toContainText('2995551234');
  await expect(card).toContainText('Delivery');
  await expect(card).toContainText('Mendoza 851, Centro');
  await expect(card).toContainText('Portón gris');
  await expect(card).toContainText('Sin sal');
  await expect(card).toContainText('Total a cobrar');
  await expect(card).toContainText('Aceptar pedido');

  // 4. El negocio gestiona el estado: Aceptar -> queda "Listo para entregar".
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toContainText('Preparando');
  await expect(page.locator('[data-inbox-order="LT-0002"]')).toContainText('Listo para entregar');

  // 5. Mobile 390x844 sin overflow horizontal.
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
