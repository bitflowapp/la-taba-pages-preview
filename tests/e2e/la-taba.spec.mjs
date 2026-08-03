import { expect, test } from '@playwright/test';
import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, openBusinessSection, openFirstProductModal, seedCheckoutProfile, waitForToast } from './helpers.mjs';

const TRACKING_GPS_NOTE = 'Seguimiento por estados, sin GPS ni ubicación en vivo.';

test.beforeEach(async ({ page }) => {
  await installBrowserStubs(page);
});

test('carga inicial, home sin lista infinita y catálogo por categorías', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/?demo=1');
  await expect(page.locator('[data-cart-count]').first()).toHaveText('0');
  await expect(page.locator('[data-cart-total-small]')).toHaveText(/\$\s*0/);
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(page.locator('[data-view="cart"]')).toBeHidden();
  await expect(page.locator('[data-view]')).toHaveCount(7);

  // El home no muestra el grid de productos completo (sin lista infinita).
  await expect(page.locator('[data-view="home"] [data-product-grid]')).toHaveCount(0);
  await expect(page.locator('[data-view="home"] .category-strip')).toBeVisible();
  await expect(page.locator('[data-home-active-order]')).toBeHidden();

  // Entrar al catálogo desde el CTA del home.
  await page.locator('[data-view="home"] [data-nav-view="catalog"]').first().click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  await expect.poll(() => page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);

  // Seleccionar la categoría de gaseosas.
  await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  // Seleccionar la categoría de aguas.
  await page.locator('[data-view="catalog"] [data-category-id="mixers"]').click();
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

  await page.goto('/?demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();

  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await waitForToast(page, /agregado al pedido/);
  await expect(page.locator('[data-cart-count]').first()).not.toHaveText('0');
  const desktopCart = page.locator('.topbar [data-open-cart]');
  await expect(desktopCart).toBeVisible();
  await expect(page.locator('[data-cart-total-small]')).toContainText('$');
  await desktopCart.click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();

  // La tarjeta del producto agregado muestra el stepper de cantidad.
  const card = page.locator('[data-product-grid] .product-card.in-cart').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.qty-stepper strong')).toHaveText('1');
  await card.locator('[data-cart-inc]').click();
  await expect(card.locator('.qty-stepper strong')).toHaveText('2');
  await expect(page.locator('[data-cart-count]').first()).toHaveText('2');
  await card.locator('[data-cart-dec]').click();
  await expect(card.locator('.qty-stepper strong')).toHaveText('1');

  await guards.assertClean();
});

test('catálogo: tiles limpios (nombre debajo) y breadcrumb compacto', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/?demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-view="catalog"] [data-category-id="energizantes"]').click();

  const card = page.locator('[data-product-grid] .product-card').first();
  await expect(card).toBeVisible();
  // El nombre del producto vive en el cuerpo (h3), no superpuesto sobre el tile.
  await expect(card.locator('.product-body h3')).toBeVisible();
  await expect(card.locator('.product-media img')).toBeVisible();

  await expect(page.locator('[data-view="catalog"] .section-head .secondary-button')).toHaveCount(0);

  await guards.assertClean();
});

test('carrito vacío oculta el formulario de checkout y lo muestra al cargar productos', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/?demo=1#cart');
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  // Con el carrito vacío no debe verse el formulario "Datos para finalizar" ni vaciar.
  await expect(page.locator('[data-cart-list]')).toContainText('Tu pedido está vacío');
  await expect(page.locator('[data-checkout-form]')).toBeHidden();
  await expect(page.locator('[data-clear-cart]')).toBeHidden();
  await expect(page.locator('[data-cart-list] [data-nav-view="catalog"]')).toBeVisible();

  // Al agregar un producto, el formulario aparece para completar el pedido.
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-checkout-form]')).toBeVisible();
  await expect(page.locator('[data-clear-cart]')).toBeVisible();

  await guards.assertClean();
});

test('pedido demo no muestra rider falso, GPS, mapa ni ETA', async ({ page }) => {
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Cliente Demo',
    phone: '2995557777',
    street: 'Roca 123',
    neighborhood: 'Neuquen centro',
    reference: 'Casa azul',
    notes: 'Tocar timbre',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');

  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido fue confirmado');
  await expect(tracking).not.toContainText(/pedido de muestra|no se envió|presentación/i);
  await expect(tracking).toContainText('Roca 123, Neuquen centro');
  await expect(tracking).not.toContainText('Juli');
  await expect(tracking).not.toContainText('2991112233');
  await expect(tracking.locator('[data-delivery-code-card]')).toHaveCount(0);
  await expect(tracking.locator('[data-real-map], .lt-rider-marker')).toHaveCount(0);
  await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText('El pedido sigue en el local. La ubicación aparecerá cuando comience el reparto.');

  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.getByRole('button', { name: /Vista rider/i }).click();
  const rider = page.locator('[data-delivery-panel]');
  await expect(rider).toContainText('Pedido listo para repartir');
  await expect(rider.locator('[data-rider-assignment-preview="LT-0002"]')).toBeVisible();
  await expect(rider).not.toContainText('Roca 123, Neuquen centro');
  await rider.locator('[data-rider-accept="LT-0002"]').click();
  await expect(rider).toContainText('Entrega aceptada.');
  await expect(rider.locator('[data-real-map]')).toHaveCount(0);
  await expect(rider.locator('[data-sim-gps]')).toHaveCount(0);
  await rider.locator('[data-delivery-leave="LT-0002"]').click();
  await waitForToast(page, 'Pedido marcado como en camino.');
  await expect(rider.locator('[data-sim-gps]')).toHaveCount(1);

  await guards.assertClean();
});

test('home muestra acceso al pedido en curso tras confirmar', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/?demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '2995550000',
    street: 'Roca 123',
    neighborhood: 'Neuquen centro',
    reference: 'Porton negro',
    notes: 'Tocar timbre',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  await page.getByRole('button', { name: 'Ir al inicio del comercio' }).click();
  const banner = page.locator('[data-home-active-order] .active-order-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('LT-0002');
  await banner.click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  await guards.assertClean();
});

test('flujo cliente con delivery', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/?demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await page.getByLabel('Delivery').check();

  // Contrato nuevo: el checkout no valida datos de cliente al confirmar, porque
  // ya no los pide. Un Perfil incompleto o sin dirección se bloquea antes, con
  // un camino explícito hacia Perfil.
  await seedCheckoutProfile(page, { name: '', phone: '', addresses: [] });
  await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  await expect(
    page.locator('[data-profile-block="incomplete"] [data-profile-checkout-action="edit-profile"]'),
  ).toBeVisible();

  await seedCheckoutProfile(page, { name: 'Walter QA', phone: '2995550000', addresses: [] });
  await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
  await expect(
    page.locator('[data-profile-block="no-address"] [data-profile-checkout-action="add-address"]'),
  ).toBeVisible();

  await fillCheckout(page, {
    name: 'Walter QA',
    phone: '2995550000',
    street: 'Roca 123',
    neighborhood: 'Neuquen centro',
    reference: 'Porton negro',
    notes: 'Sin hueso',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  const paymentMethod = page.getByLabel('Forma de pago');
  await expect(paymentMethod).toBeVisible();
  await expect(paymentMethod).toHaveValue('transfer');
  await expect(paymentMethod.locator('option[value="coordinate"]')).toHaveText('A coordinar con el local');
  await expect(page.locator('[data-order-summary]')).toContainText('Envío a domicilio');
  await expect(page.locator('[data-order-summary]')).toContainText('Total');
  await expect(page.getByRole('button', { name: /Copiar pedido/i })).toHaveCount(0);

  // CTA principal: confirma el pedido interno y NO abre WhatsApp automáticamente.
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
  await expect(page.locator('[data-tracking-panel]')).toContainText('Envío a domicilio');
  await expect(page.locator('[data-tracking-panel]')).toContainText('Roca 123, Neuquen centro');
  await expect(page.locator('[data-tracking-panel]')).toContainText('Porton negro');
  const confirmedOrder = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('la_taba_mvp_v4_state'));
    const order = state.orders.find((candidate) => candidate.id === state.lastOrderId);
    return {
      id: order?.id,
      status: order?.status,
      paymentMethodCode: order?.paymentMethodCode,
    };
  });
  expect(confirmedOrder).toEqual({
    id: 'LT-0002',
    status: 'received',
    paymentMethodCode: 'transfer',
  });
  const autoOpened = await page.evaluate(() => window.__openedUrls.length);
  expect(autoOpened).toBe(0);

  await expect(page.getByRole('button', { name: /Enviar copia por WhatsApp/i })).toBeHidden();

  await guards.assertClean();
});

test('mobile cliente elige forma de pago y crea pedido simulado', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);

  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();

  await fillCheckout(page, {
    name: 'Cliente Mobile',
    phone: '2995551010',
    street: 'Roca 123',
    neighborhood: 'Neuquen centro',
    reference: 'Porton negro',
    notes: 'Entregar bien frio',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  const paymentMethod = page.getByLabel('Forma de pago');
  await expect(paymentMethod).toBeVisible();
  await expect(paymentMethod).toHaveValue('transfer');
  await expect(paymentMethod.locator('option[value="coordinate"]')).toHaveText('A coordinar con el local');
  await expect(page.locator('[data-checkout-mode-note]')).toContainText('El medio de pago se coordina con el local.');
  await expect(page.locator('[name="couponCode"]')).toHaveCount(0);

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido confirmado/);
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido fue confirmado');
  await expect(tracking).not.toContainText(/pedido de muestra|no se envió|presentación/i);
  await tracking.locator('[data-order-summary-details] > summary').click();
  await expect(tracking.locator('.summary-row').filter({ hasText: 'Pago' })).toContainText('Transferencia');
  await expect(tracking).not.toContainText('Cupón');
  await expect(tracking).toContainText('Entregar bien frio');

  await page.goto('/?demo=1#business');
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Transferencia');
  await expect(page.locator('[data-business-dashboard]')).not.toContainText('TABA10');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Entregar bien frio');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(overflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});

test('flujo retiro en local', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/?demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await page.getByLabel('Retiro en local').check();

  await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  await expect(page.locator('[data-customer-addresses] .profile-address-list')).toHaveCount(0);
  await expect(page.locator('[data-checkout-details-title]')).toHaveText('Datos para retirar');
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
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('LT-0002');
  const autoOpened = await page.evaluate(() => window.__openedUrls.length);
  expect(autoOpened).toBe(0);

  await expect(page.getByRole('button', { name: /Enviar copia por WhatsApp/i })).toBeHidden();

  await guards.assertClean();
});

test('modo negocio y delivery', async ({ page }) => {
  const guards = installPageGuards(page);

  await page.goto('/?demo=1');
  await page.locator('.desktop-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await fillCheckout(page, {
    name: 'Cliente Calle',
    phone: '2995552222',
    street: 'Mitre 456',
    neighborhood: 'Area centro',
    reference: 'Casa verde',
    notes: 'Dejar en recepcion',
    payment: 'cash',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  await expect(page.locator('[data-view="business"]')).toBeHidden();
  await expect(page.locator('[data-view="rider"]')).toBeHidden();

  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('0000');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-pin-error]')).toBeVisible();

  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-view="business"]')).toContainText('Central de pedidos');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Nuevos');
  await expect(page.locator('[data-business-dashboard]')).toContainText('En preparación');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Listos');
  // La banda operativa es el único control del estado del reparto: las
  // tarjetas de métrica que decían "En camino" se fusionaron con el filtro,
  // que ya nombraba lo mismo como "En reparto".
  await expect(page.locator('[data-business-dashboard]')).toContainText('En reparto');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Mitre 456, Area centro');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Casa verde');

  const advanceButton = page.locator('[data-order-advance]').first();
  await expect(advanceButton).toBeVisible();
  await advanceButton.click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Listo para entregar');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await waitForToast(page, 'Estado del pedido actualizado.');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Abrir reparto');

  // Catálogo y promos arranca plegado: el acceso rápido lo abre.
  await openBusinessSection(page, '[data-scroll-catalog]');
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

  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await page.getByRole('button', { name: /Vista rider/i }).click();
  await expect(page.locator('[data-view="rider"]')).toBeVisible();
  await expect(page.locator('[data-delivery-panel]')).toContainText('Pedido');
  await expect(page.locator('[data-delivery-panel]')).not.toContainText('Mitre 456, Area centro');
  await page.locator('[data-rider-accept="LT-0002"]').click();
  await waitForToast(page, 'Entrega aceptada. Ya podés ver los datos del pedido.');
  await expect(page.locator('[data-delivery-panel]')).toContainText('Mitre 456, Area centro');
  await expect(page.locator('[data-delivery-panel]')).toContainText('Casa verde');

  const deliveryLeave = page.locator('[data-delivery-leave]').first();
  if (await deliveryLeave.count()) {
    await expect(deliveryLeave).toBeVisible();
    await deliveryLeave.click();
    await waitForToast(page, 'Pedido marcado como en camino.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('En camino');
    await page.locator('[data-delivery-arrive]').first().click();
    await waitForToast(page, 'Llegada al domicilio registrada.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('Llegando');
    await page.goto('/?demo=1#tracking');
    const deliveryCode = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
    expect(deliveryCode).toMatch(/^\d{4}$/);
    await page.goto('/?demo=1#rider');
    await page.locator('[data-delivery-code-input]').fill(deliveryCode);
    await page.locator('[data-delivery-code-confirm]').click();
    await waitForToast(page, 'Código de entrega confirmado.');
    await page.locator('[data-delivery-done]').first().click();
    await waitForToast(page, 'Pedido marcado como entregado.');
    await expect(page.locator('[data-delivery-panel]')).toContainText('Sin entregas disponibles');
  }

  await guards.assertClean();
});

test('bottom nav cambia pantallas sin navegar por scroll', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);

  await installBrowserStubs(page);
  await page.goto('/?demo=1');
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  expect(await page.evaluate(() => history.scrollRestoration)).toBe('manual');

  const mainScrollState = await page.evaluate(() => {
    const main = document.querySelector('main[data-app-main]');
    const mainStyle = getComputedStyle(main);
    return {
      root: document.scrollingElement?.tagName,
      overflowY: mainStyle.overflowY,
      mainScrollable: main.scrollHeight > main.clientHeight + 1,
    };
  });
  expect(mainScrollState.root).toBe('HTML');
  expect(mainScrollState.overflowY).not.toMatch(/auto|scroll|overlay/);
  expect(mainScrollState.mainScrollable).toBeFalsy();

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.mobile-nav [data-nav-view="home"]').click();
  await page.evaluate(() => window.scrollTo(0, 520));
  await page.locator('[data-floating-cart]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect(page.locator('[data-view="home"]')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(new URL(page.url()).hash).toBe('#cart');

  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(page.locator('[data-view="cart"]')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(new URL(page.url()).hash).toBe('#home');

  await page.locator('[data-floating-cart]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.locator('.mobile-nav [data-nav-view="tracking"]').click();
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('.mobile-nav')).toBeHidden();

  await page.goto('/?demo=1#profile');
  await expect(page.locator('[data-view="profile"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.locator('.mobile-nav [data-nav-view="home"]').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await guards.assertClean();
  await context.close();
});

test('bottom nav respeta safe-area y no cubre contenido', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  const measureNav = () => page.locator('.mobile-nav').evaluate((nav) => {
    const rect = nav.getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      height: rect.height,
      navHeightToken: rootStyle.getPropertyValue('--taba-bottom-nav-height').trim(),
      navGapToken: rootStyle.getPropertyValue('--taba-bottom-nav-gap').trim(),
      mainPaddingBottom: Number.parseFloat(
        getComputedStyle(document.querySelector('main[data-app-main]')).paddingBottom,
      ),
      buttonBottomDistances: [...nav.querySelectorAll('button')]
        .map((button) => window.innerHeight - button.getBoundingClientRect().bottom),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  try {
    await installBrowserStubs(page);
    await page.goto('/?demo=1');
    await expect(page.locator('[data-view="home"]')).toBeVisible();

    const safe0 = await measureNav();
    await page.addStyleTag({ content: ':root { --safe-area-bottom: 34px; }' });
    const safe34 = await measureNav();

    await expect(page.locator('.mobile-nav')).toBeVisible();
    await expect(page.locator('.mobile-nav button')).toHaveCount(4);
    const navHeight = Number.parseFloat(safe0.navHeightToken);
    const navGap = Number.parseFloat(safe0.navGapToken);
    expect(navHeight).toBeGreaterThan(0);
    expect(navGap).toBeGreaterThanOrEqual(0);
    expect(safe0.mainPaddingBottom).toBe(navHeight + navGap);
    expect(safe34.height - safe0.height).toBeGreaterThanOrEqual(32);
    expect(safe34.height - safe0.height).toBeLessThanOrEqual(36);
    const paddingDelta = safe34.mainPaddingBottom - safe0.mainPaddingBottom;
    expect(paddingDelta).toBeGreaterThanOrEqual(33);
    expect(paddingDelta).toBeLessThanOrEqual(35);
    expect(safe34.mainPaddingBottom).toBe(safe0.mainPaddingBottom + 34);
    expect(safe34.buttonBottomDistances.every((distance) => distance >= 42)).toBeTruthy();
    expect(safe34.scrollWidth).toBeLessThanOrEqual(safe34.viewportWidth + 1);

    const initialCta = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
      const ctaRect = document.querySelector('button.order-now-cta').getBoundingClientRect();
      return {
        overlap: ctaRect.bottom > navRect.top && ctaRect.top < navRect.bottom,
        maxScroll: root.scrollHeight - root.clientHeight,
      };
    });
    if (initialCta.overlap) {
      expect(initialCta.maxScroll).toBeGreaterThan(0);
    }

    await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      window.scrollTo({
        top: root.scrollHeight - root.clientHeight,
        behavior: 'instant',
      });
    });
    await expect.poll(() => page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return Math.abs(window.scrollY - (root.scrollHeight - root.clientHeight));
    })).toBeLessThanOrEqual(1);
    const ctaGap = await page.evaluate(() => {
      const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
      const ctaRect = document.querySelector('button.order-now-cta').getBoundingClientRect();
      return navRect.top - ctaRect.bottom;
    });
    expect(ctaGap).toBeGreaterThanOrEqual(12);

    await page.goto('/?demo=1#catalog');
    await expect(page.locator('[data-product-grid] .product-card')).not.toHaveCount(0);
    await page.evaluate(() => window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    }));
    const catalogGeometry = await page.evaluate(() => {
      const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
      const cards = [...document.querySelectorAll('[data-product-grid] .product-card')];
      const lastRowTop = Math.max(...cards.map((card) => card.getBoundingClientRect().top));
      const lastRow = cards
        .map((card) => card.getBoundingClientRect())
        .filter((rect) => Math.abs(rect.top - lastRowTop) <= 1);
      const topbarRect = document.querySelector('.topbar').getBoundingClientRect();
      const categoryStrip = document.querySelector('[data-view="catalog"] .category-strip');
      return {
        lastRowGap: navRect.top - Math.max(...lastRow.map((rect) => rect.bottom)),
        lastRowHeightDelta: Math.max(...lastRow.map((rect) => rect.height))
          - Math.min(...lastRow.map((rect) => rect.height)),
        topbarTop: topbarRect.top,
        horizontalFilterScrollable: categoryStrip.scrollWidth > categoryStrip.clientWidth,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(catalogGeometry.lastRowGap).toBeGreaterThanOrEqual(18);
    expect(catalogGeometry.lastRowHeightDelta).toBeLessThanOrEqual(1);
    expect(Math.abs(catalogGeometry.topbarTop)).toBeLessThanOrEqual(1);
    expect(catalogGeometry.horizontalFilterScrollable).toBeTruthy();
    expect(catalogGeometry.horizontalOverflow).toBeFalsy();

    await page.locator('.mobile-nav [data-nav-view="tracking"]').click();
    await expect(page.locator('.tracking-premium')).toBeVisible();
    await expect(page.locator('.mobile-nav')).toBeHidden();
    const measureMain = () => page.evaluate(() => {
      const main = document.querySelector('main[data-app-main]');
      const style = getComputedStyle(main);
      return {
        root: document.scrollingElement?.tagName,
        height: typeof main.computedStyleMap === 'function'
          ? main.computedStyleMap().get('height').toString()
          : (main.style.height || 'auto'),
        overflowY: style.overflowY,
        paddingBottom: style.paddingBottom,
        scrollable: main.scrollHeight > main.clientHeight + 1,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    const trackingState = await measureMain();
    expect(trackingState).toMatchObject({
      root: 'HTML',
      height: 'auto',
      overflowY: 'visible',
      paddingBottom: '0px',
      scrollable: false,
      horizontalOverflow: false,
    });

    for (const view of ['business', 'rider']) {
      await page.goto(`/?demo=1#${view}`);
      await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
      await expect(page.locator('.mobile-nav')).toBeHidden();
      expect(await measureMain()).toMatchObject({
        root: 'HTML',
        height: 'auto',
        overflowY: 'visible',
        paddingBottom: '0px',
        scrollable: false,
        horizontalOverflow: false,
      });
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/?demo=1');
    await expect(page.locator('.mobile-nav')).toBeHidden();
    const landscapeState = await measureMain();
    expect(landscapeState.root).toBe('HTML');
    expect(landscapeState.overflowY).not.toMatch(/auto|scroll|overlay/);
    expect(landscapeState.scrollable).toBeFalsy();
    expect(landscapeState.horizontalOverflow).toBeFalsy();
    await guards.assertClean();
  } finally {
    await context.close();
  }
});

  for (const [name, viewport] of [
    ['narrow 320x700', { width: 320, height: 700 }],
    ['Android-small 360x800', { width: 360, height: 800 }],
    ['iPhone-like 390x844', { width: 390, height: 844 }],
    ['Android-like 412x915', { width: 412, height: 915 }],
    ['tablet 768x1024', { width: 768, height: 1024 }],
    ['desktop 1280x900', { width: 1280, height: 900 }],
  ]) {
  test(`responsive smoke ${name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const guards = installPageGuards(page);

    await installBrowserStubs(page);
    await page.goto('/?demo=1');

    if (viewport.width <= 820) {
      await expect(page.locator('.mobile-nav')).toBeVisible();
      await expect(page.locator('.desktop-nav')).toBeHidden();
    } else {
      await expect(page.locator('.desktop-nav')).toBeVisible();
      await expect(page.locator('.mobile-nav')).toBeHidden();
    }
    const catalogNav = viewport.width <= 820 ? '.mobile-nav [data-nav-view="catalog"]' : '.desktop-nav [data-nav-view="catalog"]';
    if (viewport.width <= 820) {
      await page.goto('/?demo=1#catalog');
    } else {
      await page.locator(catalogNav).click();
    }
    await expect(page.locator('[data-view="catalog"]')).toBeVisible();
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    await expect.poll(() => page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);

    await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
    if (viewport.width <= 820) {
      await page.locator('[data-floating-cart]').click();
    } else {
      await page.locator('.desktop-nav [data-nav-view="cart"]').click();
    }
    await expect(page.locator('[data-checkout-form]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(overflow).toBeTruthy();

    if (viewport.width <= 820) {
      await page.goto('/?demo=1#catalog');
    } else {
      await page.locator(catalogNav).click();
    }
    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await expect(page.locator('[data-product-modal]')).toBeVisible();
    await page.locator('[data-close-modal]').click();

    await page.evaluate(() => { window.location.hash = '#business'; });
    await page.locator('[data-open-pin][data-admin-target="business"]').click();
    await expect(page.locator('[data-pin-modal]')).toBeVisible();

    await guards.assertClean();
    await context.close();
  });
}
