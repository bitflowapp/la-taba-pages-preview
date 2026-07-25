import { test, expect } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

test('la experiencia pública es TABA Bebidas y los fixtures están marcados QA', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?demo=1');

  await expect(page.locator('body')).toContainText('TABA Bebidas');
  await expect(page.locator('body')).not.toContainText('La Taba Pizzería');
  await page.goto('/?demo=1#catalog');
  for (const category of [
    'Promos', 'Gaseosas', 'Aguas', 'Jugos', 'Energéticas', 'Isotónicas',
    'Cervezas', 'Vinos y espumantes', 'Gins y vodkas',
    'Whisky y destilados', 'Picadas y deli', 'Hielo y extras',
  ]) {
    await expect(page.locator('[data-view="catalog"] [data-category-strip]')).toContainText(category);
  }
  await expect(page.locator('[data-product-grid] .product-card').first()).toContainText('QA');
  await guards.assertClean();
});
