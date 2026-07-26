import { test, expect } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

test('la home presenta una sola marca Demo y un storefront comercial limpio', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?reset=1&demo=1');

  await expect(page.locator('[data-demo-mode-banner]')).toHaveText('Demo');
  await expect(page.locator('.topbar .brand-word')).toHaveText('TABA');
  await expect(page.locator('[data-view="home"] .home-search')).toBeVisible();
  const realCategories = [
    ['promos', 'Promos'],
    ['gaseosas', 'Gaseosas'],
    ['aguas', 'Aguas'],
    ['jugos', 'Jugos'],
    ['energeticas', 'Energéticas'],
    ['isotonicas', 'Isotónicas'],
    ['cervezas', 'Cervezas'],
    ['vinos-y-espumantes', 'Vinos y espumantes'],
    ['gins-y-vodkas', 'Gins y vodkas'],
    ['whisky-y-destilados', 'Whisky y destilados'],
    ['picadas-y-deli', 'Picadas y deli'],
    ['hielo-y-extras', 'Hielo y extras'],
  ];
  const homeCategories = page.locator('[data-view="home"] .category-tiles .category-button');
  await expect(homeCategories).toHaveCount(realCategories.length);
  for (const [id, label] of realCategories) {
    await expect(page.locator(`[data-view="home"] .category-tiles [data-category-id="${id}"]`)).toHaveText(label);
  }

  // La promo del home usa el producto disponible del catálogo, no copy estática.
  const promoBanner = page.locator('[data-view="home"] [data-promo-banner]');
  await expect(promoBanner).toBeVisible();
  const promoTitle = (await promoBanner.locator('[data-promo-banner-title]').innerText()).trim();
  const promoPrice = (await promoBanner.locator('[data-promo-banner-price]').innerText()).trim();
  expect(promoTitle).not.toBe('');
  expect(promoPrice).toMatch(/\d/);
  await expect(promoBanner.locator('[data-promo-banner-includes]')).not.toHaveText('');
  await promoBanner.click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Promos');
  const promotedProduct = page.locator('[data-product-grid] .product-card', { hasText: promoTitle }).first();
  await expect(promotedProduct).toBeVisible();
  await expect(promotedProduct).toContainText(promoPrice);

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
  await expect(catalogCategories).toHaveCount(realCategories.length);
  for (const [id, label] of realCategories) {
    await expect(page.locator(`[data-view="catalog"] [data-category-id="${id}"]`)).toHaveText(label);
  }
  await expect(page.locator('[data-product-grid] .product-card').first()).not.toContainText('QA');
  const activeCatalogText = await page.locator('[data-product-grid]').innerText();
  expect(activeCatalogText).not.toMatch(/\b(?:pizza|muzzarella|fugazzeta|calabresa|pepperoni|combo-pizza)\b/i);
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
    await expect(page.locator('.topbar-actions .cart-button')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
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
