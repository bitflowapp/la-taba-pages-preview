import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

test('demo aprobado muestra 22 SKU, packs y assets locales sin hotlinks', async ({ page }) => {
  const guards = installPageGuards(page);
  const requestedUrls = [];
  page.on('request', (request) => requestedUrls.push(request.url()));
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(22);
  await expect(page.locator('[data-view="catalog"] [data-category-id="mixers"]')).toBeVisible();
  await expect(page.locator('[data-view="catalog"] [data-category-id="energizantes"]')).toBeVisible();
  const pack = page.locator('[data-product-grid] .product-card').filter({ hasText: 'Coca-Cola Original' }).first();
  await expect(pack).toContainText('Pack x12');
  const packImage = pack.locator('img');
  await expect(packImage).toHaveAttribute('src', /assets\/catalog\/beverages\//);
  await expect(packImage).toHaveAttribute('loading', 'lazy');
  await expect(packImage).toHaveAttribute('width', '400');
  const pendingCard = page.locator('[data-product-grid] .product-card').filter({
    has: page.locator('[data-add-product="red-bull-original-lata-250ml-pack-4"]'),
  });
  const pendingMessage = pendingCard.locator('[data-price-pending-message]');
  await expect(pendingMessage).toHaveCount(1);
  await expect(pendingMessage).toContainText('Precio a confirmar');
  await expect(pendingMessage).toContainText('Todavía no se puede agregar.');
  await expect(pendingCard).not.toContainText('Precio pendiente');
  const pendingAction = pendingCard.locator('[data-add-product="red-bull-original-lata-250ml-pack-4"]');
  await expect(pendingAction).toBeDisabled();
  await expect(pendingAction).toHaveText('A confirmar');
  await expect(pendingCard).not.toContainText('$ 0');
  await pendingCard.locator('[data-product-detail]').click();
  const pendingModal = page.locator('[data-modal-product-id="red-bull-original-lata-250ml-pack-4"]');
  await expect(pendingModal).toBeVisible();
  await expect(pendingModal.locator('[data-price-pending-message]')).toHaveCount(1);
  await expect(pendingModal.locator('[data-price-pending-message]')).toContainText('Precio a confirmar');
  await expect(pendingModal.locator('[data-price-pending-message]')).toContainText('Todavía no se puede agregar.');
  await expect(pendingModal).not.toContainText('Precio pendiente');
  await expect(pendingModal.locator('[data-add-product="red-bull-original-lata-250ml-pack-4"]')).toBeDisabled();
  await pendingModal.locator('[data-close-modal]').click();
  const qaMarker = ['q', 'a', '-'].join('');
  const renderedQaReferences = await page.locator(`[data-product-id^="${qaMarker}"], [data-product-sku^="${qaMarker}"], img[src*="/${qaMarker}"]`).count();
  expect(renderedQaReferences).toBe(0);
  expect(requestedUrls.some((url) => url.includes(`/${qaMarker}`))).toBe(false);
  await guards.assertClean();
});

test('carrito preserva una oferta pack y exige edad para cerveza', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  await page.locator('[data-product-grid] [data-add-product="coca-cola-original-pet-500ml-pack-12"]').click();
  await page.locator('[data-product-grid] [data-add-product="red-bull-original-lata-250ml"]').click();
  await page.locator('[data-open-cart]').first().click();
  await expect(page.locator('[data-view="cart"]')).toContainText('Pack x12');
  await expect(page.locator('[data-view="cart"]')).toContainText('Unidad');
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  await page.locator('[data-product-grid] [data-add-product="heineken-original-lata-473ml"]').click();
  await page.locator('[data-open-cart]').first().click();
  await expect(page.locator('[data-age-confirmation]')).toBeVisible();
  await expect(page.locator('[name="ageConfirmed"]')).toHaveAttribute('required', '');
});
