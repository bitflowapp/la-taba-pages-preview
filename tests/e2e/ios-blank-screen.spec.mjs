import { expect, test } from '@playwright/test';
import { installPageGuards } from './helpers.mjs';

const stateKey = 'la_taba_mvp_v4_state';

test('clean sandbox paints the customer surface and hides recovery after bootstrap', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/?demo=1#home');

  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
  await expect.poll(() => page.evaluate(async () => {
    const [{ getState }, { products }] = await Promise.all([
      import('/js/state.js'),
      import('/js/beverage-qa-data.js'),
    ]);
    return getState().products.length === products.length;
  })).toBe(true);
  await guards.assertClean();
});

test('an old or empty local catalog is rebuilt without losing the first render', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 5,
      dataVersion: 'la-taba-runtime-v3',
      appMode: 'demo',
      products: [],
      cart: [],
      orders: [],
      lastOrderId: null,
      activeCategory: 'all',
    }));
  }, stateKey);
  await page.goto('/?demo=1#catalog');

  const expectedCatalogCount = await page.evaluate(async () => {
    const [{ getState }, { getCustomerCatalogProducts }, { isUnitStorefrontProduct }] = await Promise.all([
      import('/js/state.js'),
      import('/js/core/catalog-store.js'),
      import('/js/core/storefront-filters.js'),
    ]);
    return getCustomerCatalogProducts(getState().products).filter(isUnitStorefrontProduct).length;
  });
  await expect(page.locator('[data-catalog-count]')).toHaveText(`${expectedCatalogCount} productos`);
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(expectedCatalogCount);
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
});

test('reset query renders first, removes itself, and does not loop', async ({ page }) => {
  await page.goto('/?reset=1&demo=1#home');
  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  await expect.poll(() => page.url()).toMatch(/\?demo=1#home$/);
  await expect(page.url()).not.toContain('reset=1');
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
});

test('a rejected IndexedDB still leaves a usable in-memory sandbox without blocking first paint', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open() { throw new Error('IndexedDB rejected by browser'); } },
    });
  });
  await page.goto('/?demo=1#home');

  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
  await guards.assertClean();
});

test('a failed application module leaves an actionable recovery shell instead of a blank main', async ({ page }) => {
  await page.route('**/js/app.js?v=39', (route) => route.fulfill({
    status: 503,
    contentType: 'text/javascript',
    body: '/* unavailable for recovery test */',
  }));
  await page.goto('/?demo=1#home');

  await expect(page.locator('[data-app-recovery]')).toBeVisible();
  await expect(page.locator('[data-app-recovery]')).toContainText('No pudimos cargar TABA');
  await expect(page.locator('[data-app-recovery-retry]')).toBeVisible();
  await expect(page.locator('[data-app-recovery-reset]')).toBeVisible();
  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeHidden();
});

test('production without demo remains fail-closed and never selects the sandbox repository', async ({ page }) => {
  await page.goto('/#home');
  await expect(page.locator('[data-sandbox-tools]')).toHaveCount(0);
  await expect(page.locator('[data-production-catalog-gate]').first()).toBeVisible();
  const mode = await page.evaluate(async () => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    return getOrderRepository().mode;
  });
  expect(mode).not.toBe('sandbox');
});
