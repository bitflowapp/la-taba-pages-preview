import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

test('la home presenta TABA sin etiquetas internas y un storefront comercial limpio', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?reset=1&demo=1');

  await expect(page.locator('[data-demo-mode-banner]')).toHaveCount(0);
  await expect(page.locator('.topbar .brand-word')).toHaveText('TABA');
  await expect(page.getByRole('heading', { name: '¿Qué vas a pedir hoy?' })).toBeVisible();
  await expect(page.locator('[data-view="home"] .taba-home-search')).toBeVisible();
  const homeCategoryLabels = [
    ['gaseosas', 'Gaseosas'],
    ['gins-y-vodkas', 'Fernet'],
    ['cervezas', 'Cervezas'],
    ['aguas', 'Aguas'],
    ['energeticas', 'Energéticas'],
    ['promos', 'Promos'],
  ];
  const homeCategories = page.locator('[data-view="home"] .home-category-card');
  await expect(homeCategories).toHaveCount(homeCategoryLabels.length);
  for (const [id, label] of homeCategoryLabels) {
    await expect(page.locator(`[data-view="home"] [data-home-category-strip] [data-category-id="${id}"]`)).toHaveText(label);
  }
  await expect(page.locator('[data-home-category-strip] [data-category-id="gaseosas"]')).toHaveClass(/active/);

  // El banner administrativo sigue reservado a promociones aprobadas; las
  // tarjetas de preview usan condiciones visuales explícitas sobre SKUs unitarios.
  const promoBanner = page.locator('[data-view="home"] [data-promo-banner]');
  await expect(promoBanner).toBeHidden();
  await expect(page.locator('[data-home-promotions] .home-promo-card')).toHaveCount(3);
  await expect(page.locator('[data-home-promotions]')).toContainText(/% OFF/i);
  await expect(page.getByRole('heading', { name: 'Los más vendidos' })).toBeVisible();
  await expect(page.locator('[data-home-catalog-preview] .home-catalog-card')).toHaveCount(4);
  await expect(page.locator('[data-view="home"]')).not.toContainText(/\b(?:pack|x\s?\d+)\b/i);

  await expect(page.locator('[data-view="home"] .role-intro')).toHaveCount(0);
  await expect(page.locator('[data-view="home"] .product-intro')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('La Taba Pizzería');
  for (const forbidden of [
    'TABA Bebidas · QA',
    'Catálogo técnico no comercial',
    'Presentación comercial',
    'Fixture técnico QA',
    'Sin valor comercial',
    'No publicar',
  ]) {
    await expect(page.locator('[data-view="home"]')).not.toContainText(forbidden);
  }
  await page.goto('/?reset=1&demo=1#catalog');
  const catalogCategories = page.locator(
    '[data-view="catalog"] [data-category-strip] .category-button:not([data-category-id="all"]):not([data-category-id="favorites"])',
  );
  await expect(catalogCategories).toHaveCount(6);
  await expect(page.locator('[data-category-more]')).toBeVisible();
  for (const [id, label] of [
    ['gaseosas', 'Gaseosas'],
    ['aguas', 'Aguas'],
    ['energeticas', 'Energéticas'],
    ['cervezas', 'Cervezas'],
    ['gins-y-vodkas', 'Gins y vodkas'],
  ]) {
    await expect(page.locator(`[data-view="catalog"] [data-category-id="${id}"]`)).toHaveText(label);
  }
  await expect(page.locator('[data-product-grid] .product-card').first()).not.toContainText('QA');
  const activeCatalogText = await page.locator('[data-product-grid]').innerText();
  expect(activeCatalogText).not.toMatch(/\b(?:pizza|muzzarella|fugazzeta|calabresa|pepperoni|combo-pizza)\b/i);
  expect(activeCatalogText).not.toMatch(/\b(?:pack|x\s?\d+)\b/i);
  await guards.assertClean();
});

for (const viewport of [
  { name: '320', width: 320, height: 700 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`home compacta debajo de 2000 px en ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installBrowserStubs(page);
    await page.goto('/?reset=1&demo=1');
    const homeHeight = await page.locator('[data-view="home"]').evaluate((node) => Math.ceil(node.getBoundingClientRect().height));
    expect(homeHeight).toBeLessThan(2000);
    await expect(page.locator('.topbar .brand-word')).toHaveText('TABA');
    await expect(page.locator('.topbar .brand-text small')).toBeHidden();
    await expect(page.locator('.topbar-actions .cart-button')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`home final de bebidas mantiene layout físico en ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installBrowserStubs(page);
    await page.goto('/?reset=1&demo=1&home=v36');
    await expect(page.locator('[data-view="home"]')).toBeVisible();
    await expect(page.locator('.mobile-nav [data-nav-view="home"]')).toHaveClass(/active/);
    await expect(page.locator('[data-home-promotions]')).toBeVisible();

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      homeRight: document.querySelector('[data-view="home"]')?.getBoundingClientRect().right || 0,
      navBottom: document.querySelector('.mobile-nav')?.getBoundingClientRect().bottom || 0,
      innerHeight: window.innerHeight,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.homeRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.innerHeight - geometry.navBottom).toBeGreaterThanOrEqual(9);
    expect(geometry.innerHeight - geometry.navBottom).toBeLessThanOrEqual(11);

    const productImages = page.locator('[data-view="home"] .thumb-img');
    await expect(productImages.first()).toBeVisible();
    expect(await productImages.evaluateAll((images) => images.every((image) => (
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
    )))).toBeTruthy();

    const captureDir = process.env.TABA_HOME_CAPTURE_DIR;
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      await page.screenshot({
        path: path.join(captureDir, `home-final-${viewport.width}x${viewport.height}.png`),
      });
    }

    const finalCard = page.locator('[data-home-catalog-preview] .home-catalog-card').last();
    await finalCard.scrollIntoViewIfNeeded();
    const [finalCardBox, navBox] = await Promise.all([
      finalCard.boundingBox(),
      page.locator('.mobile-nav').boundingBox(),
    ]);
    expect(finalCardBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(finalCardBox.y + finalCardBox.height).toBeLessThanOrEqual(navBox.y + 1);
  });
}

test('confirmación de edad aparece y es obligatoria sólo con alcohol', async ({ page }) => {
  await installBrowserStubs(page);

  await page.goto('/?reset=1&demo=1#catalog');
  await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-age-confirmation]')).toBeHidden();
  await expect(page.locator('[name="ageConfirmed"]')).not.toHaveAttribute('required');

  await page.goto('/?reset=1&demo=1#catalog');
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-age-confirmation]')).toBeVisible();
  await expect(page.locator('[name="ageConfirmed"]')).toHaveAttribute('required', '');
});

test('la CTA móvil del pedido queda sobre la navegación sin superponerse', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBrowserStubs(page);
  await page.goto('/?reset=1&demo=1#catalog');
  await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();

  const floatingCart = page.locator('[data-floating-cart]');
  const mobileNav = page.locator('.mobile-nav');
  await expect(floatingCart).toBeVisible();
  await expect(floatingCart.locator('[data-floating-cart-summary]')).toContainText(/^Ver pedido · \$/);
  await expect(mobileNav).toBeVisible();

  const [floatingBox, navBox] = await Promise.all([
    floatingCart.boundingBox(),
    mobileNav.boundingBox(),
  ]);
  expect(floatingBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(floatingBox.y + floatingBox.height).toBeLessThanOrEqual(navBox.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});
