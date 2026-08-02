import { expect, test } from '@playwright/test';
import { gotoDemoReset, installPageGuards } from './helpers.mjs';

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
    const { getState } = await import('/js/state.js');
    return getState().products.length;
  })).toBe(22);
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

  // El estado recupera el catálogo base completo, pero el storefront unitario
  // oculta los cinco assets que representan multipacks.
  await expect(page.locator('[data-catalog-count]')).toContainText('21 productos');
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
});

test('reset query renders first, removes itself, and does not loop', async ({ page }) => {
  await gotoDemoReset(page, '/?reset=1&demo=1#home');
  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
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
  await page.route('**/js/app.js?v=37', (route) => route.fulfill({
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
