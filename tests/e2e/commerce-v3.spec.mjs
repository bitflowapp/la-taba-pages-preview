import { test, expect } from '@playwright/test';
import { installBrowserStubs, gotoDemoReset, seedCheckoutProfile, DEFAULT_CHECKOUT_ADDRESSES } from './helpers.mjs';

test('Commerce V3: búsqueda visible, dos cards legibles y sin overflow en los anchos de compra', async ({ page }, info) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?demo=1&reset=1#home');
  for (const width of [360, 375, 390, 393, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const search = page.locator('[data-view="home"] [data-search-input]');
    await expect(search).toBeVisible();
    const searchBox = await search.boundingBox();
    expect(searchBox.y).toBeLessThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const card = page.locator('[data-home-best-sellers] .home-best-card').first();
    await expect(card).toHaveCSS('background-color', 'rgb(248, 246, 241)');
    if (width <= 430) expect((await card.boundingBox()).width).toBeGreaterThanOrEqual(150);
    const add = card.locator('[data-add-product]');
    expect((await add.boundingBox()).width).toBeGreaterThanOrEqual(44);
    expect((await add.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(add.locator('.add-text')).toBeHidden();
    if ([390, 430, 1280].includes(width)) await page.screenshot({ path: info.outputPath(`home-${width}.png`) });
  }
});

test('Commerce V3: agregar, sumar, restar y vaciar mantienen cantidades y total', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?demo=1&reset=1#catalog');
  await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES });
  const add = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
  const id = await add.getAttribute('data-add-product');
  await add.click();
  await page.locator(`[data-product-grid] [data-cart-inc="${id}"]`).click();
  await expect(page.locator('[data-floating-cart]')).toBeVisible();
  await expect(page.locator('[data-floating-cart-count]')).toHaveText('2 productos');
  await page.screenshot({ path: info.outputPath('catalog-cart-390.png') });
  await page.locator('[data-floating-cart]').click();
  await expect(page.locator('[data-checkout-submit]')).toBeVisible();
  await expect(page.locator('[data-checkout-submit]')).toContainText(await page.locator('[data-order-summary] .summary-row.total strong').innerText());
  await page.screenshot({ path: info.outputPath('cart-checkout-390.png'), fullPage: true });
  const count = () => page.evaluate(async () => (await import('/js/cart.js')).getCartSummary('pickup'));
  const before = await count();
  await page.locator(`[data-cart-list] [data-cart-dec="${id}"]`).click();
  expect((await count()).subtotal).toBe(before.subtotal / 2);
  await page.locator(`[data-cart-list] [data-cart-dec="${id}"]`).click();
  await expect(page.locator('[data-checkout-submit]')).toBeHidden();
  await expect(page.locator('[data-cart-list]')).toContainText('Tu pedido está vacío');
});

test('Commerce V3: dirección principal y edición dentro de la hoja conservan el checkout', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?demo=1&reset=1#catalog');
  await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES });
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('[data-floating-cart]').click();
  await page.locator('[data-address-sheet-open="checkout"]').click();
  const sheet = page.locator('[data-address-sheet]');
  await sheet.getByRole('button', { name: 'Usar Trabajo como principal' }).click();
  await expect(sheet).toContainText('Dirección principal guardada');
  await sheet.getByRole('button', { name: 'Editar Trabajo', exact: true }).click();
  await expect(sheet.locator('input').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('address-edit-390.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  await expect(page.locator('[data-checkout-submit]')).toBeVisible();
});

test('Commerce V3: Mis pedidos repite con precio actual, informa ausentes y nunca confirma solo', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?demo=1&reset=1');
  const expected = await page.evaluate(async () => {
    const { getState, setState } = await import('/js/state.js');
    const { recordCustomerOrder } = await import('/js/core/customer-history.js');
    const { isProductOrderable } = await import('/js/core/catalog-store.js');
    const product = getState().products.find((item) => isProductOrderable(item));
    recordCustomerOrder({ id: 'LT-V3-HISTORY', createdAt: new Date().toISOString(), status: 'delivered', deliveryMode: 'pickup', total: 100,
      items: [{ productId: product.id, name: product.name, quantity: 1, unitPrice: 100 }, { productId: 'missing-product', name: 'Producto retirado', quantity: 1, unitPrice: 500 }] });
    setState({ cart: [], comboSelections: [] });
    return { id: product.id, price: product.price, orders: getState().orders.length };
  });
  await page.locator('.mobile-nav [data-nav-view="orders"]').click();
  await expect(page.locator('[data-customer-history]')).toContainText('LT-V3-HISTORY');
  await page.screenshot({ path: info.outputPath('history-390.png') });
  await page.locator('[data-customer-history] [data-repeat-order]').click();
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  const actual = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js'); const { getCartSummary } = await import('/js/cart.js');
    return { cart: getState().cart, subtotal: getCartSummary('pickup').subtotal, orders: getState().orders.length };
  });
  expect(actual.cart).toEqual([{ productId: expected.id, quantity: 1 }]);
  expect(actual.subtotal).toBe(expected.price);
  expect(actual.orders).toBe(expected.orders);
  await expect(page.locator('[data-cart-reorder-notice]')).toContainText('Producto retirado');
  await expect(page.locator('[data-cart-reorder-notice]')).toContainText('Cambió algún precio');
});

test('Commerce V3: alta real conserva campos, guarda un borrador incompleto y bloquea peso variable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?demo=1&reset=1');
  await page.evaluate(async () => {
    const ops = await import('/js/business/business-operations-center.js');
    const root = document.querySelector('main');
    document.body.dataset.activeView = 'business';
    const draft = { id: 'draft-test', status: 'pending_review', source: 'manual', commercial_details: {} };
    const draw = () => { root.innerHTML = ops.renderBusinessOperations('product-create'); };
    ops.configureBusinessOperations({ role: 'owner', businessId: 'fixture-business', operatorId: 'fixture-operator', onChange: draw,
      listProductDrafts: async () => ({ ok: true, data: [] }),
      createManualProductDraft: async () => ({ ok: true, data: draft }),
      saveProductDraft: async ({ details }) => { window.__savedDraft = details; return { ok: true, data: { ...draft, commercial_details: details } }; },
    });
    root.addEventListener('click', (event) => { event.stopPropagation(); void ops.handleBusinessOperationsAction(event.target); });
    draw();
  });
  await page.locator('[data-create-manual-draft]').click();
  await page.locator('[name="productName"]').fill('Producto de prueba');
  await page.locator('[name="productCategory"]').selectOption('Carnes');
  await page.locator('[name="productPricingMode"]').selectOption('variable_weight');
  await page.locator('[data-product-preview]').click();
  await expect(page.locator('[name="productName"]')).toHaveValue('Producto de prueba');
  await expect(page.locator('.production-intake-error')).toContainText('pesaje y cobro');
  await page.locator('[data-product-save-draft]').click();
  expect(await page.evaluate(() => window.__savedDraft.stock)).toBe('');
  expect(await page.evaluate(() => window.__savedDraft.pricingMode)).toBe('variable_weight');
  await page.screenshot({ path: info.outputPath('admin-product-390.png'), fullPage: true });
});

test('Commerce V3: el PIN demo espera al panel sin rechazar el primer envío', async ({ page }) => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/js/business.js', async route => { await delayed; await route.continue(); });
  await installBrowserStubs(page);
  try {
    await page.goto('/?demo=1#business', { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: /Ingresar c[óo]digo/i }).click();
    await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
    await expect(page.locator('[data-pin-error]')).toBeHidden();
    release();
    await expect(page.locator('[data-pin-modal]')).not.toBeVisible();
    await expect(page.locator('[data-view="business"] [data-admin-unlocked]')).toBeVisible();
  } finally { release(); }
});
