import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

test('la home presenta TABA con marca interna discreta y un storefront comercial limpio', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?reset=1&demo=1');

  await expect(page.locator('[data-demo-mode-banner]')).toHaveCount(0);
  await expect(page.locator('.topbar .brand-word')).toHaveText('TABA');
  await expect(page.getByRole('heading', { name: '¿Qué vas a pedir hoy?' })).toBeVisible();
  await expect(page.locator('[data-view="home"] .taba-home-search')).toBeVisible();
  const homeCategoryLabels = [
    ['gaseosas', 'Gaseosas'],
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
  await expect(page.locator('[data-home-category-strip] [data-category-id="fernet"]')).toHaveCount(0);
  await expect(page.locator('.home-preview-label')).toHaveText('PREVIEW INTERNA');

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
  await expect(catalogCategories).toHaveCount(8);
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

test('Todos, contador, búsqueda y categorías comparten el catálogo unitario válido', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?reset=1&demo=1#catalog');

  const expectedProducts = await page.evaluate(async () => {
    const [{ getState }, { getCustomerCatalogProducts }, { isUnitStorefrontProduct }] = await Promise.all([
      import('/js/state.js'),
      import('/js/core/catalog-store.js'),
      import('/js/core/storefront-filters.js'),
    ]);
    return getCustomerCatalogProducts(getState().products)
      .filter(isUnitStorefrontProduct)
      .map(({ id, name, categoryId }) => ({ id, name, categoryId }));
  });
  const expectedIds = expectedProducts.map(({ id }) => id).sort();
  const productCards = page.locator('[data-product-grid] .product-card');
  const renderedIds = () => page.locator('[data-product-grid] [data-add-product]').evaluateAll(
    (buttons) => buttons.map((button) => button.dataset.addProduct).sort(),
  );

  expect(expectedIds.length).toBeGreaterThan(0);
  await expect(page.locator('[data-catalog-count]')).toHaveText(`${expectedIds.length} productos`);
  await expect(productCards).toHaveCount(expectedIds.length);
  expect(await renderedIds()).toEqual(expectedIds);
  expect(new Set(await renderedIds()).size).toBe(expectedIds.length);
  await expect(page.locator('[data-product-grid]')).not.toContainText(
    /(?:\b(?:pack|multipack)\b|(?:^|\s)(?:x|×)\s*[2-9]\d*)/i,
  );

  const search = page.locator('[data-view="catalog"] [data-search-input]');
  for (const product of expectedProducts) {
    await search.fill(product.name);
    await expect(productCards).toHaveCount(1);
    await expect(page.locator(`[data-product-grid] [data-add-product="${product.id}"]`)).toBeVisible();
  }
  await search.fill('');
  await expect(productCards).toHaveCount(expectedIds.length);

  const categories = [...new Set(expectedProducts.map(({ categoryId }) => categoryId))];
  for (const categoryId of categories) {
    const expectedCategoryIds = expectedProducts
      .filter((product) => product.categoryId === categoryId)
      .map(({ id }) => id)
      .sort();
    await page.locator(`[data-view="catalog"] [data-category-id="${categoryId}"]`).click();
    expect(await renderedIds()).toEqual(expectedCategoryIds);
  }
  await page.locator('[data-view="catalog"] [data-category-id="all"]').click();
  await expect(productCards).toHaveCount(expectedIds.length);
  expect(await renderedIds()).toEqual(expectedIds);

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const productId of expectedIds) {
    const add = page.locator(`[data-product-grid] [data-add-product="${productId}"]`);
    await expect(add).toBeEnabled();
    await add.evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await add.click();
    const card = page.locator(`[data-product-grid] .product-card:has([data-product-detail="${productId}"])`);
    await expect(card).toHaveClass(/in-cart/);
    const decrement = card.locator(`[data-cart-dec="${productId}"]`);
    await decrement.evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await decrement.click();
    await expect(card).not.toHaveClass(/in-cart/);
  }
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
    await page.goto('/?reset=1&demo=1&home=v37');
    await expect.poll(() => new URL(page.url()).searchParams.has('reset')).toBe(false);
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
    await expect.poll(() => productImages.evaluateAll((images) => images.every((image) => (
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
    )))).toBe(true);

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

test('Ver todas conserva filtros reales de promociones y más vendidos', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?demo=1&home=v37');

  await page.locator('.home-section-head [data-category-id="popular"]').click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Los más vendidos');
  const popularIds = await page.locator('[data-product-grid] [data-add-product]').evaluateAll(
    (buttons) => buttons.map((button) => button.dataset.addProduct).sort(),
  );
  expect(popularIds).toEqual([
    'qa-agua-mineral',
    'qa-energetica',
    'qa-gaseosa-cola',
    'qa-promo-bebidas',
  ]);

  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();

  const homePromoIds = await page.locator('[data-home-promotions] [data-add-product]').evaluateAll(
    (buttons) => buttons.map((button) => button.dataset.addProduct),
  );
  expect(homePromoIds).toHaveLength(3);
  expect(new Set(homePromoIds).size).toBe(homePromoIds.length);
  await page.locator('.home-section-head [data-category-id="promos"]').click();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Promociones');
  await expect(page.locator('[data-catalog-count]')).toHaveText(`${homePromoIds.length} productos`);
  const catalogPromoIds = await page.locator('[data-product-grid] [data-add-product]').evaluateAll(
    (buttons) => buttons.map((button) => button.dataset.addProduct).sort(),
  );
  expect(catalogPromoIds).toEqual([...homePromoIds].sort());
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await guards.assertClean();
});

test('controles táctiles de la Home alcanzan 44 por 44 y el carrusel sincroniza indicadores', async ({ page }) => {
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1&home=v37');

  const controlSelector = [
    '.home-section-head button',
    '[data-home-promotions] .home-add-button',
    '[data-home-best-sellers] .home-add-button',
    '[data-home-catalog-preview] .home-add-button',
    '[data-home-catalog-preview] .home-favorite-button',
  ].join(', ');
  for (const viewport of [
    { width: 320, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    const controls = page.locator(controlSelector);
    await expect(controls).toHaveCount(16);
    const undersized = await controls.evaluateAll((nodes) => nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { selector: node.outerHTML.slice(0, 120), width: rect.width, height: rect.height };
      })
      .filter(({ width, height }) => width < 44 || height < 44));
    expect(undersized, `${viewport.width}x${viewport.height}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const rail = page.locator('[data-home-promotions]');
  const dots = page.locator('[data-home-paging-dots] span');
  await expect(dots).toHaveCount(2);
  await expect(dots.first()).toHaveClass(/is-active/);
  await rail.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect(dots.last()).toHaveClass(/is-active/);
  await page.setViewportSize({ width: 430, height: 932 });
  const expectedPages = await rail.evaluate((node) => (
    node.scrollWidth - node.clientWidth > 1 ? Math.ceil(node.scrollWidth / node.clientWidth) : 1
  ));
  await expect(dots).toHaveCount(expectedPages);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('[data-home-paging-dots]')).toBeHidden();
});

test('los derivados limpios se reutilizan en Home, catálogo, modal y carrito', async ({ page }) => {
  await installBrowserStubs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=1&home=v37');
  const cleanAsset = 'coca-cola-original-1-5l-clean-preview.jpg';
  const homeCard = page.locator('[data-home-catalog-preview] .home-catalog-card').filter({ hasText: 'Coca-Cola' });
  await expect(homeCard.locator(`img[src*="${cleanAsset}"]`)).toHaveCount(1);

  await homeCard.locator('[data-product-detail]').click();
  await expect(page.locator(`dialog[open] img[src*="${cleanAsset}"]`)).toBeVisible();
  await page.locator('dialog[open] .modal-close').click();

  await homeCard.locator('[data-add-product]').click();
  await page.locator('[data-open-cart]').first().click();
  await expect(page.locator(`[data-view="cart"] img[src*="${cleanAsset}"]`)).toBeVisible();

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-view="catalog"] [data-category-id="promos"]').click();
  await expect(page.locator(`[data-product-grid] img[src*="${cleanAsset}"]`)).toBeVisible();
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
