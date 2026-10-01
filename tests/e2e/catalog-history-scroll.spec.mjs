import { expect, test } from '@playwright/test';
import { GRID, openRuntimeCatalog, clickCatalogCategory } from './catalog-runtime-fixture.mjs';

test.use({ viewport: { width: 390, height: 844 } });

async function settleNavigation(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function filteredCatalog(page) {
  await openRuntimeCatalog(page);
  await clickCatalogCategory(page, 'gaseosas');
  await page.locator('[data-view="catalog"] [data-search-input]').fill('a');
  await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
  await settleNavigation(page);
  await page.evaluate(() => scrollTo({ top: 450, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(450);
}

async function expectCatalogSelection(page) {
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-view="catalog"] [data-search-input]')).toHaveValue('a');
  await expect.poll(() => page.evaluate(async () => (await import('/js/state.js')).getState().activeCategory)).toBe('gaseosas');
}

test('historial del catálogo restaura posición, búsqueda y categoría en Back y Forward', async ({ page }, info) => {
  await filteredCatalog(page);
  await page.locator('.mobile-nav [data-nav-view="home"]').click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  // Se crea otra entrada: Forward debe restaurar el catálogo, no sólo Back.
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await settleNavigation(page);
  await page.evaluate(() => scrollTo({ top: 650, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(650);
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await page.goBack();
  await expectCatalogSelection(page);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(450);
  await page.goForward();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await page.goForward();
  await expectCatalogSelection(page);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(650);
  await info.attach('history-restoration', { body: JSON.stringify({ back: 450, forward: 650, search: 'a', category: 'gaseosas' }), contentType: 'application/json' });
});

test('un acceso nuevo al catálogo comienza arriba y conserva la selección', async ({ page }) => {
  await filteredCatalog(page);
  await page.locator('.mobile-nav [data-nav-view="home"]').click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await settleNavigation(page);
  await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await expectCatalogSelection(page);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('un enlace hash nuevo al catálogo comienza arriba', async ({ page }) => {
  await filteredCatalog(page);
  await page.locator('.mobile-nav [data-nav-view="home"]').click();
  await settleNavigation(page);
  await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => { location.hash = '#catalog'; });
  await expectCatalogSelection(page);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});
