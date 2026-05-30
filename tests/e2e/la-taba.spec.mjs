import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, openFirstProductModal, waitForToast } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await installBrowserStubs(page);
});

test('carga inicial, home sin lista infinita y catálogo por categorías', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await expect(page.locator('[data-cart-count]')).toHaveText('0');
  await expect(page.locator('[data-cart-total-small]')).toHaveText('Pedido');
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(page.locator('[data-view="cart"]')).toBeHidden();
  await expect(page.locator('[data-view]')).toHaveCount(7);

  // El home no muestra el grid de productos completo (sin lista infinita).
  await expect(page.locator('[data-view="home"] [data-product-grid]')).toHaveCount(0);
  await expect(page.locator('[data-view="home"] .category-strip')).toBeVisible();

  // Entrar al catálogo desde el CTA del home.
  await page.locator('[data-view="home"] [data-nav-view="catalog"]').first().click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  await expect.poll(() => page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);

  // Seleccionar categoría Carnes.
  await page.locator('[data-view="catalog"] [data-category-id="carnes"]').click();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Carnes');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  // Seleccionar categoría Bebidas.
  await page.locator('[data-view="catalog"] [data-category-id="bebidas"]').click();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Bebidas');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  // Ordenar por menor precio.
  await page.locator('[data-sort-select]').selectOption('price_asc');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  await openFirstProductModal(page);
  await page.locator('[data-close-modal]').click();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(overflow).toBeTruthy();

  await guards.assertClean();
});

test('agregar producto desde una categoría del catálogo', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-view="catalog"] [data-category-id="carnes"]').click();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Carnes');

  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await waitForToast(page, /agregado al pedido/);
  await expect(page.locator('[data-cart-count]')).not.toHaveText('0');
  await expect(page.locator('[data-floating-cart]')).toBeVisible();
  await expect(page.locator('[data-floating-cart]')).toContainText(/1 ítem/);
  await page.locator('[data-floating-cart]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();

  // La tarjeta del producto agregado muestra el stepper de cantidad.
  const card = page.locator('[data-product-grid] .product-card.in-cart').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.qty-stepper strong')).toHaveText('1');
  await card.locator('[data-cart-inc]').click();
  await expect(card.locator('.qty-stepper strong')).toHaveText('2');
  await expect(page.locator('[data-cart-count]')).toHaveText('2');
  await card.locator('[data-cart-dec]').click();
  await expect(card.locator('.qty-stepper strong')).toHaveText('1');

  await guards.assertClean();
});

test('catálogo: tiles limpios (nombre debajo) y breadcrumb compacto', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-view="catalog"] [data-category-id="combos"]').click();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Combos');

  const card = page.locator('[data-product-grid] .product-card').first();
  await expect(card).toBeVisible();
  // El nombre del producto vive en el cuerpo (h3), no superpuesto sobre el tile.
  await expect(card.locator('.product-body h3')).toBeVisible();
  await expect(card.locator('.thumb .thumb-name')).toHaveCount(0);

  // Breadcrumb compacto en vez del botón grande "Inicio".
  await expect(page.locator('[data-view="catalog"] .crumbs .crumb-link')).toBeVisible();
  await expect(page.locator('[data-view="catalog"] .section-head .secondary-button')).toHaveCount(0);

  await guards.assertClean();
});

test('home muestra acceso al pedido en curso tras confirmar', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'Tocar timbre',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  await page.locator('.desktop-nav [data-nav-view="home"]').click();
  const banner = page.locator('[data-home-active-order] .active-order-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('LT-0002');
  await banner.click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  await guards.assertClean();
});

test('flujo cliente con delivery', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await page.getByLabel('Delivery').check();

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Ingresá el nombre del cliente.');

  await fillCheckout(page, {
    name: '',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Ingresá el nombre del cliente.');

  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '',
    address: 'Roca 123',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Ingresá un teléfono de contacto.');

  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '2995550000',
    address: '',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Ingresá la dirección para el envío.');

  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '2995550000',
    address: 'Roca 123',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Copiar pedido/i }).click();
  await waitForToast(page, 'Pedido copiado al portapapeles.');
  const clipboardText = await page.evaluate(() => window.__clipboardText);
  expect(clipboardText).toContain('Walter QA');
  expect(clipboardText).toContain('Envío a domicilio');
  expect(clipboardText).toContain('Total:');

  // CTA principal: confirma el pedido interno y NO abre WhatsApp automáticamente.
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido creado. Ya podés seguirlo en tiempo real.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
  const autoOpened = await page.evaluate(() => window.__openedUrls.length);
  expect(autoOpened).toBe(0);

  // WhatsApp queda como acción secundaria: copia del pedido ya creado.
  await page.getByRole('button', { name: /Enviar copia por WhatsApp/i }).click();
  await waitForToast(page, 'Abriendo WhatsApp con la copia del pedido.');
  const openedUrl = await page.evaluate(() => window.__openedUrls.at(-1));
  expect(openedUrl).toContain('wa.me/');
  expect(openedUrl).toContain(encodeURIComponent('Walter QA'));
  expect(openedUrl).toContain(encodeURIComponent('Roca 123'));
  expect(openedUrl).toContain(encodeURIComponent('Subtotal'));

  await guards.assertClean();
});

test('flujo retiro en local', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
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
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido creado. Ya podés seguirlo en tiempo real.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
  const autoOpened = await page.evaluate(() => window.__openedUrls.length);
  expect(autoOpened).toBe(0);

  // Copia opcional por WhatsApp del pedido de retiro.
  await page.getByRole('button', { name: /Enviar copia por WhatsApp/i }).click();
  const openedUrl = await page.evaluate(() => window.__openedUrls.at(-1));
  expect(openedUrl).toContain(encodeURIComponent('Retiro en local'));
  expect(openedUrl).not.toContain(encodeURIComponent('Roca 123'));
  expect(openedUrl).toContain(encodeURIComponent('Total:'));

  await guards.assertClean();
});

test('modo negocio y delivery', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/');
  await expect(page.locator('[data-view="business"]')).toBeHidden();
  await expect(page.locator('[data-view="rider"]')).toBeHidden();

  await page.locator('[data-admin-toggle]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('0000');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-pin-error]')).toBeVisible();

  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-business-dashboard]')).toContainText('Ventas del día');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Stock del catálogo');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Pedidos para preparar');

  const advanceButton = page.locator('[data-order-advance]').first();
  await expect(advanceButton).toBeVisible();
  await advanceButton.click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Enviar con repartidor');

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

  await page.getByRole('button', { name: /^Salir$/i }).click();
  await expect(page.locator('[data-view="business"]')).toBeHidden();
  await expect(page.locator('[data-view="home"]')).toBeVisible();

  await page.locator('[data-admin-toggle]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await page.getByRole('button', { name: /Vista rider/i }).click();
  await expect(page.locator('[data-view="rider"]')).toBeVisible();
  await expect(page.locator('[data-delivery-panel]')).toContainText('Pedido');

  const deliveryLeave = page.locator('[data-delivery-leave]').first();
  if (await deliveryLeave.count()) {
    await expect(deliveryLeave).toBeVisible();
    await deliveryLeave.click();
    await waitForToast(page, 'Pedido marcado como en camino.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('En camino');
    await page.locator('[data-delivery-arrive]').first().click();
    await waitForToast(page, 'Llegada al domicilio registrada.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('Llegando');
    await page.locator('[data-delivery-done]').first().click();
    await waitForToast(page, 'Pedido marcado como entregado.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('No hay pedidos para repartir.');
  }

  await guards.assertClean();
});

test('bottom nav cambia pantallas sin navegar por scroll', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);

  await installBrowserStubs(page);
  await page.goto('/');
  await expect(page.locator('[data-view="home"]')).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 520));
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect(page.locator('[data-view="home"]')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(new URL(page.url()).hash).toBe('#cart');

  await page.locator('.mobile-nav [data-nav-view="tracking"]').click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('.mobile-nav')).toBeHidden();

  await page.goto('/#profile');
  await expect(page.locator('[data-view="profile"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.locator('.mobile-nav [data-nav-view="home"]').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await guards.assertClean();
  await context.close();
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
    const catalogNav = viewport.width <= 760 ? '.mobile-nav [data-nav-view="catalog"]' : '.desktop-nav [data-nav-view="catalog"]';
    if (viewport.width <= 760) {
      await page.goto('/#catalog');
    } else {
      await page.locator(catalogNav).click();
    }
    await expect(page.locator('[data-view="catalog"]')).toBeVisible();
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    await expect.poll(() => page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);

    await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
    if (viewport.width <= 760) {
      await page.locator('.mobile-nav [data-nav-view="cart"]').click();
    } else {
      await page.locator('.desktop-nav [data-nav-view="cart"]').click();
    }
    await expect(page.locator('[data-checkout-form]')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(overflow).toBeTruthy();

    if (viewport.width <= 760) {
      await page.goto('/#catalog');
    } else {
      await page.locator(catalogNav).click();
    }
    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await expect(page.locator('[data-product-modal]')).toBeVisible();
    await page.locator('[data-close-modal]').click();

    if (viewport.width <= 760) {
      await page.locator('.mobile-nav [data-nav-view="profile"]').click();
      await page.locator('[data-view="profile"] [data-open-admin-view="business"]').click();
    } else {
      await page.locator('[data-admin-toggle]').click();
    }
    await expect(page.locator('[data-pin-modal]')).toBeVisible();

    await guards.assertClean();
    await context.close();
  });
}
