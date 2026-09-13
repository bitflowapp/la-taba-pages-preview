import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, seedCartAboveMinimum, seedCheckoutProfile } from './helpers.mjs';

test('recommended products use the available mobile width', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.evaluate(async () => {
    const { setState } = await import('/js/state.js');
    const { renderCart } = await import('/js/ui.js');
    const products = [
      { id: 'layout-beer', name: 'Cerveza de prueba', categoryId: 'cervezas', alcoholic: true, available: true, stock: 6, price: 1000 },
      { id: 'layout-ice', name: 'Hielo en cubos', categoryId: 'hielo-y-extras', available: true, stock: 8, price: 500 },
      { id: 'layout-snack', name: 'Snacks de prueba', categoryId: 'snacks', available: true, stock: 8, price: 700 },
    ];
    setState({ products, cart: [{ productId: 'layout-beer', quantity: 1 }] });
    renderCart();
  });
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await expect(page.locator('.recommendation-card').first()).toBeVisible();
  for (const width of [360, 375, 390, 393, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.locator('[data-cart-recommendations]').evaluate((section) => {
      const cards = [...section.querySelectorAll('.recommendation-card')];
      const rail = section.querySelector('.recommendations-rail');
      return {
        section: section.getBoundingClientRect().width,
        rail: rail.getBoundingClientRect().width,
        card: cards[0].getBoundingClientRect().width,
        secondX: cards[1].getBoundingClientRect().x,
        firstX: cards[0].getBoundingClientRect().x,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.rail).toBeGreaterThan(geometry.section * 0.9);
    expect(geometry.card).toBeGreaterThanOrEqual(130);
    expect(geometry.secondX).toBeGreaterThan(geometry.firstX);
    expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  }
});

test('saved identity reaches final checkout fields and survives address navigation', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await seedCartAboveMinimum(page);
  await seedCheckoutProfile(page, { name: '', phone: '', addresses: [] });
  await page.evaluate(() => { window.location.hash = '#cart'; });
  const identity = page.locator('[data-profile-identity-form]');
  await expect(identity).toBeVisible();
  await identity.locator('[name="checkoutIdentityName"]').fill('Marco Test');
  await expect(identity.locator('[name="checkoutIdentityName"]')).toHaveValue('Marco Test');
  await identity.locator('[name="checkoutIdentityPhone"]').fill('299 620 9136');
  await expect(identity.locator('[name="checkoutIdentityName"]')).toHaveValue('Marco Test');
  await identity.locator('[data-profile-checkout-action="save-identity"]').click();
  await expect(identity).toHaveCount(0);
  await expect(page.locator('[data-checkout-form] [name="customerName"]')).toHaveValue('Marco Test');
  await expect(page.locator('[data-checkout-form] [name="customerPhone"]')).toHaveValue(/299 620 9136/);
  await page.locator('[data-profile-checkout-action="new-address"]').first().click();
  const editor = page.locator('[data-address-capture="checkout"]');
  await expect(editor).toBeVisible();
  await editor.locator('[name="captureAddressStreet"]').fill('Río Limay');
  await editor.locator('[name="captureAddressNumber"]').fill('64');
  await editor.locator('[data-profile-action="open-location-map"]').click();
  await editor.locator('[data-location-nudge="norte"]').click();
  await expect(editor.locator('[data-profile-action="confirm-location"]')).toHaveCount(0);
  await expect(editor.locator('[data-location-coords]')).toHaveCount(0);
  await editor.locator('[data-address-capture-save]').click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-profile-summary]')).toContainText('Marco Test');
  await expect(page.locator('[data-checkout-form] [name="customerName"]')).toHaveValue('Marco Test');
  await expect(page.locator('[data-checkout-form] [name="customerPhone"]')).toHaveValue(/299 620 9136/);
  await expect(page.locator('[data-profile-checkout]')).toContainText('Río Limay 64');
  await page.locator('[data-checkout-submit]').click();
  await expect(page.locator('[data-checkout-warning]')).not.toContainText('Ingresá un nombre de al menos 2 caracteres');
});

test('known phone is not requested again, and a failed save keeps the name', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await seedCartAboveMinimum(page);
  await seedCheckoutProfile(page, { name: '', phone: '2996209136', addresses: [] });
  await page.evaluate(() => { window.location.hash = '#cart'; });
  const identity = page.locator('[data-profile-identity-form]');
  await expect(identity.locator('[name="checkoutIdentityName"]')).toBeVisible();
  await expect(identity.locator('[name="checkoutIdentityPhone"]')).toHaveCount(0);
  await page.evaluate(async () => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    const repo = getOrderRepository().customerProfiles;
    const original = repo.saveProfile;
    repo.saveProfile = async () => ({ ok: false, message: 'No pudimos guardar tus datos. Probá de nuevo.' });
    window.__restoreProfileSave = () => { repo.saveProfile = original; };
  });
  await identity.locator('[name="checkoutIdentityName"]').fill('Marco Test');
  await identity.locator('[data-profile-checkout-action="save-identity"]').click();
  await expect(identity.locator('[role="alert"]')).toContainText('No pudimos guardar');
  await expect(identity.locator('[name="checkoutIdentityName"]')).toHaveValue('Marco Test');
  await page.evaluate(() => window.__restoreProfileSave());
  await identity.locator('[data-profile-checkout-action="save-identity"]').click();
  await expect(identity).toHaveCount(0);
  await expect(page.locator('[name="customerName"]')).toHaveValue('Marco Test');
});

test('rapid quantity taps keep cart count and total in sync', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  const add = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
  const id = await add.getAttribute('data-add-product');
  await add.click();
  const result = await page.evaluate(async (productId) => {
    const { getState } = await import('/js/state.js');
    const { getCartSummary } = await import('/js/cart.js');
    for (let n = 0; n < 5; n += 1) {
      document.querySelector(`[data-product-grid] [data-cart-inc="${productId}"]`)?.click();
    }
    const line = getState().cart.find((item) => item.productId === productId);
    return { quantity: line?.quantity, total: getCartSummary('pickup').total };
  }, id);
  expect(result.quantity).toBe(6);
  await expect(page.locator('[data-floating-cart-count]')).toHaveText('6 productos');
  await expect(page.locator('[data-floating-cart-summary]')).toContainText(String(result.total).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
});

test('mobile identity and address fields stay readable with a short visual viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await seedCartAboveMinimum(page);
  await seedCheckoutProfile(page, { name: '', phone: '', addresses: [] });
  await page.evaluate(() => { window.location.hash = '#cart'; });
  for (const name of ['checkoutIdentityName', 'checkoutIdentityPhone']) {
    const field = page.locator(`[name="${name}"]`);
    await field.focus();
    await field.scrollIntoViewIfNeeded();
    expect(await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect((await field.boundingBox()).y).toBeGreaterThanOrEqual(0);
  }
  await seedCheckoutProfile(page, { name: 'Marco Test', phone: '2996209136', addresses: [] });
  await page.locator('[data-profile-checkout-action="new-address"]').first().click();
  for (const name of ['captureAddressStreet', 'captureAddressNumber']) {
    const field = page.locator(`[data-address-capture="checkout"] [name="${name}"]`);
    await field.focus();
    await field.scrollIntoViewIfNeeded();
    expect(await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect((await field.boundingBox()).y).toBeGreaterThanOrEqual(0);
  }
  await expect(page.locator('[data-address-capture-save]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
