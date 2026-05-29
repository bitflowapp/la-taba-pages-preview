import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, openFirstProductModal, waitForToast } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await installBrowserStubs(page);
});

test('carga inicial y catálogo', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  expect(await page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-cart-count]')).toHaveText('0');
  await expect(page.locator('[data-cart-total-small]')).toContainText('$');
  await expect(page.locator('[data-cart-list]')).toContainText('El carrito está vacío');
  await expect(page.locator('[data-admin-area]')).toHaveCount(2);

  await page.locator('[data-category-id="carnes"]').click();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  await openFirstProductModal(page);
  await page.locator('[data-close-modal]').click();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(overflow).toBeTruthy();

  await guards.assertClean();
});

test('flujo cliente con delivery', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await page.locator('[data-product-grid] [data-add-product]').first().click();
  await page.getByRole('link', { name: /Mi pedido/i }).click();
  await page.getByLabel('Envío a domicilio').check();

  await page.getByRole('button', { name: /Confirmar y abrir WhatsApp/i }).click();
  await waitForToast(page, 'Ingresá el nombre del cliente.');

  await fillCheckout(page, {
    name: '',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar y abrir WhatsApp/i }).click();
  await waitForToast(page, 'Ingresá el nombre del cliente.');

  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '',
    address: 'Roca 123',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar y abrir WhatsApp/i }).click();
  await waitForToast(page, 'Ingresá un teléfono de contacto.');

  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '2995550000',
    address: '',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar y abrir WhatsApp/i }).click();
  await waitForToast(page, 'Ingresá la dirección para el envío.');

  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar y abrir WhatsApp/i }).click();
  await waitForToast(page, /LT-\d{4} creado\. Abriendo WhatsApp\.\.\./);

  const openedUrl = await page.evaluate(() => window.__openedUrls.at(-1));
  expect(openedUrl).toContain('wa.me/');
  expect(openedUrl).toContain(encodeURIComponent('Walter QA'));
  expect(openedUrl).toContain(encodeURIComponent('Roca 123'));
  expect(openedUrl).toContain(encodeURIComponent('Subtotal'));

  await page.getByRole('button', { name: /Copiar pedido/i }).click();
  await waitForToast(page, 'Pedido copiado al portapapeles.');
  const clipboardText = await page.evaluate(() => window.__clipboardText);
  expect(clipboardText).toContain('Walter QA');
  expect(clipboardText).toContain('Envío a domicilio');
  expect(clipboardText).toContain('Total:');
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  await guards.assertClean();
});

test('flujo retiro en local', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await page.locator('[data-product-grid] [data-add-product]').first().click();
  await page.getByRole('link', { name: /Mi pedido/i }).click();
  await page.getByLabel('Retiro en local').check();

  await expect(page.locator('[data-address-field]')).toBeHidden();
  await expect(page.locator('[data-order-summary]')).not.toContainText('Pedido mínimo delivery');
  await expect(page.locator('[data-order-summary]')).toContainText('Retiro en local');
  await expect(page.locator('[data-order-summary]')).toContainText('Total');

  await fillCheckout(page, {
    name: 'Ana Retiro',
    phone: '2995551111',
    address: '',
    notes: 'Retiro por mostrador',
    payment: 'cash',
    deliveryMode: 'pickup',
  });
  await page.getByRole('button', { name: /Confirmar y abrir WhatsApp/i }).click();
  await waitForToast(page, /LT-\d{4} creado\. Abriendo WhatsApp\.\.\./);

  const openedUrl = await page.evaluate(() => window.__openedUrls.at(-1));
  expect(openedUrl).toContain(encodeURIComponent('Retiro en local'));
  expect(openedUrl).not.toContain(encodeURIComponent('Roca 123'));
  expect(openedUrl).toContain(encodeURIComponent('Total:'));
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');

  await guards.assertClean();
});

test('modo negocio y delivery', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await expect(page.locator('#negocio')).toBeHidden();
  await expect(page.locator('#delivery')).toBeHidden();

  await page.locator('[data-admin-toggle-secondary]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('0000');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-pin-error]')).toBeVisible();

  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('#negocio')).toBeVisible();
  await expect(page.locator('[data-business-dashboard]')).toContainText('Ventas de hoy');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Stock rápido');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Pedidos entrantes');

  const advanceButton = page.locator('[data-order-advance]').first();
  await expect(advanceButton).toBeVisible();
  await advanceButton.click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Listo para enviar');

  const stockInc = page.locator('[data-stock-inc]').first();
  const stockDec = page.locator('[data-stock-dec]').first();
  const stockBefore = Number(await stockInc.evaluate((button) => button.parentElement.querySelector('strong').textContent));
  await stockInc.click();
  const stockAfterInc = Number(await stockInc.evaluate((button) => button.parentElement.querySelector('strong').textContent));
  expect(stockAfterInc).toBe(stockBefore + 1);
  await stockDec.click();
  const stockAfterDec = Number(await stockDec.evaluate((button) => button.parentElement.querySelector('strong').textContent));
  expect(stockAfterDec).toBe(stockBefore);

  await page.locator('[data-product-toggle]').first().click();
  await waitForToast(page, 'Disponibilidad actualizada.');
  await expect(page.locator('[data-business-dashboard]')).toContainText(/Pausar|Activar/);

  await page.getByRole('button', { name: /Salir del modo negocio/i }).click();
  await expect(page.locator('#negocio')).toBeHidden();

  await page.locator('[data-admin-toggle-secondary]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('#delivery')).toBeVisible();
  await expect(page.locator('[data-delivery-panel]')).toContainText('Pedido');

  const deliveryLeave = page.locator('[data-delivery-leave]').first();
  if (await deliveryLeave.count()) {
    await expect(deliveryLeave).toBeVisible();
    await deliveryLeave.click();
    await waitForToast(page, 'Pedido marcado como en camino.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('En camino');
    await page.locator('[data-delivery-done]').first().click();
    await waitForToast(page, 'Pedido marcado como entregado.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('No hay pedidos asignados al repartidor.');
  }

  await guards.assertClean();
});

  for (const [name, viewport] of [
    ['iPhone-like 390x844', { width: 390, height: 844 }],
    ['Android-like 430x932', { width: 430, height: 932 }],
    ['tablet 768x1024', { width: 768, height: 1024 }],
  ]) {
  test(`responsive smoke ${name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const guards = installPageGuards(page);

    await installBrowserStubs(page);
    await page.goto('/');

    if (viewport.width <= 760) {
      await expect(page.locator('.mobile-nav')).toBeVisible();
      await expect(page.locator('.desktop-nav')).toBeHidden();
    } else {
      await expect(page.locator('.desktop-nav')).toBeVisible();
      await expect(page.locator('.mobile-nav')).toBeHidden();
    }
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    expect(await page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);

    await page.locator('[data-product-grid] [data-add-product]').first().click();
    await page.getByRole('link', { name: /Mi pedido/i }).click();
    await expect(page.locator('[data-checkout-form]')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(overflow).toBeTruthy();

    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await expect(page.locator('[data-product-modal]')).toBeVisible();
    await page.locator('[data-close-modal]').click();

    await page.locator('[data-admin-toggle-secondary]').click();
    await expect(page.locator('[data-pin-modal]')).toBeVisible();

    await guards.assertClean();
    await context.close();
  });
}
