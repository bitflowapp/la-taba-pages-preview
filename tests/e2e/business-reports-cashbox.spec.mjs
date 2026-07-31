import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, openBusinessSection, waitForToast } from './helpers.mjs';

test('negocio ve reportes/caja de la simulacion y cancelaciones', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1');

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  const productCard = page.locator('[data-product-grid] .product-card').first();
  const productName = (await productCard.locator('.product-body h3').innerText()).trim();
  await productCard.locator('[data-add-product]:not([disabled])').click();
  await page.locator('[data-floating-cart]').click();
  await fillCheckout(page, {
    name: 'Cliente Reporte',
    phone: '2995557000',
    street: 'Roca 123',
    neighborhood: 'Neuquen centro',
    reference: 'Casa gris',
    notes: 'Reporte de muestra',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido confirmado/);

  await page.goto('/?demo=1#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  for (let step = 0; step < 2; step += 1) {
    await page.locator('[data-order-advance="LT-0002"]').click();
    await waitForToast(page, 'Estado del pedido actualizado.');
  }
  await page.getByRole('button', { name: 'Abrir reparto' }).click();
  await page.locator('[data-rider-accept="LT-0002"]').click();
  await page.locator('[data-delivery-leave="LT-0002"]').click();
  await page.locator('[data-delivery-arrive="LT-0002"]').click();
  await page.goto('/?demo=1#tracking');
  const deliveryCode = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  expect(deliveryCode).toMatch(/^\d{4}$/);
  await page.goto('/?demo=1#rider');
  await page.locator('[data-delivery-code-input="LT-0002"]').fill(deliveryCode);
  await page.locator('[data-delivery-code-confirm="LT-0002"]').click();
  await page.locator('[data-delivery-done="LT-0002"]').click();
  await page.getByRole('button', { name: 'Ir al panel del negocio' }).click();
  await openBusinessSection(page, '[data-scroll-reports]');

  const report = page.locator('[data-business-report]');
  await expect(report).toContainText('Resumen del período');
  await expect(report).toContainText('Ventas de hoy');
  await expect(page.locator('[data-business-dashboard]')).not.toContainText(/Datos de ejemplo|Vista de operación/);
  await expect(report.locator('.board-chip.done')).toContainText(/Entregados\s+[1-9]/);
  await expect(report).toContainText(productName);

  await page.goto('/?demo=1#catalog');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();
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
  await waitForToast(page, /Pedido confirmado/);

  await page.goto('/?demo=1#business');
  await page.locator('[data-business-view="orders"]').click();
  await expect(page.locator('[data-inbox-order="LT-0003"]')).toBeVisible();
  await page.locator('[data-inbox-order="LT-0003"] summary').click();
  await page.locator('[data-inbox-order="LT-0003"] [data-order-cancel]').click();
  await expect(page.locator('[data-cancel-modal]')).toBeVisible();
  await page.locator('[data-cancel-preset="Sin stock"]').click();
  await page.locator('[data-cancel-confirm]').click();
  await waitForToast(page, /Pedido LT-0003 cancelado/);

  await openBusinessSection(page, '[data-scroll-reports]');
  await expect(report.locator('.board-chip.cancelled')).toContainText('1');
  await expect(report).toContainText('Sin stock');

  await page.locator('[data-business-view="cashbox"]').click();
  await expect(report).toContainText('Caja del día');
  await report.locator('[data-cashbox-close]').click();
  await waitForToast(page, 'Cierre del turno guardado en este dispositivo.');
  await expect(report).toContainText('Historial de cierres');
  await expect(report.locator('.cashbox-history-row').first()).toContainText('1 entregados');
  await expect(report.locator('.cashbox-history-row').first()).toContainText('1 cancelados');

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
