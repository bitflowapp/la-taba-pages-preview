import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs } from './helpers.mjs';

test('las búsquedas argentinas encuentran la familia correcta y no inventan vodka', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  const grid = page.locator('[data-product-grid]');

  for (const [query, expectedText] of [
    ['fernet', 'Fernet'],
    ['coca', 'Coca-Cola'],
    ['heineken', 'Heineken'],
    ['imperial', 'Imperial'],
  ]) {
    await search.fill(query);
    await expect(grid.locator('.product-card')).not.toHaveCount(0);
    await expect(grid.locator('.product-card').first()).toContainText(expectedText);
  }

  for (const query of ['cerveza', 'energizante', 'hielo']) {
    await search.fill(query);
    await expect(grid.locator('.product-card')).not.toHaveCount(0);
  }

  await search.fill('vodka');
  await expect(grid.locator('.product-card')).toHaveCount(0);
  await expect(grid.locator('.empty-state')).toContainText('No encontramos');
});
