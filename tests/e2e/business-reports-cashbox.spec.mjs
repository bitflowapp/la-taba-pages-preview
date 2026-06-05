import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

test('negocio ve reportes/caja desde pedidos reales, cupon, pago y cancelaciones', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1');

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  const productCard = page.locator('[data-product-grid] .product-card').first();
  const productName = (await productCard.locator('.product-body h3').innerText()).trim();
  await productCard.locator('[data-add-product]:not([disabled])').click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Cliente Reporte',
    phone: '2995557000',
    street: 'Roca 123',
    neighborhood: 'Neuquen centro',
    reference: 'Casa gris',
    notes: 'Reporte con cupon',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.locator('[name="couponCode"]').fill('TABA10');
  await page.locator('[data-apply-coupon]').click();
  await expect(page.locator('[data-order-summary]')).toContainText('TABA10');
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido creado/);

  await page.goto('/#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();

  for (let step = 0; step < 4; step += 1) {
    await page.locator('[data-order-advance="LT-0002"]').click();
    await waitForToast(page, 'Estado del pedido actualizado.');
  }

  const report = page.locator('[data-business-report]');
  await expect(report).toContainText('Caja del día');
  await expect(report).toContainText('Ventas de hoy');
  await expect(report.locator('.day-metric', { hasText: 'Transferencia' })).toContainText(/\$\s*[1-9]/);
  await expect(report.locator('.day-metric', { hasText: 'Descuentos' })).toContainText(/\$\s*[1-9]/);
  await expect(report.locator('.board-chip.done')).toContainText(/Entregados\s+[1-9]/);
  await expect(report).toContainText(productName);

  await page.goto('/#catalog');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Cliente Cancelado',
    phone: '2995558000',
    street: 'Mitre 456',
    neighborhood: 'Area centro',
    reference: 'Porton azul',
    notes: 'Cancelar para reporte',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido creado/);

  await page.goto('/#business');
  await expect(page.locator('[data-inbox-order="LT-0003"]')).toBeVisible();
  await page.locator('[data-inbox-order="LT-0003"] [data-order-cancel]').click();
  await expect(page.locator('[data-cancel-modal]')).toBeVisible();
  await page.locator('[data-cancel-preset="Sin stock"]').click();
  await page.locator('[data-cancel-confirm]').click();
  await waitForToast(page, /Pedido LT-0003 cancelado/);

  await expect(report.locator('.board-chip.cancelled')).toContainText('1');
  await expect(report).toContainText('Sin stock');

  await report.locator('[data-cashbox-close]').click();
  await waitForToast(page, 'Cierre de caja demo guardado.');
  await expect(report).toContainText('Historial de cierres');
  await expect(report.locator('.cashbox-history-row').first()).toContainText(/[1-9]\d* entregados/);
  await expect(report.locator('.cashbox-history-row').first()).toContainText('1 cancelados');

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
