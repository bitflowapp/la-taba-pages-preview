import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { gotoDemoReset, installBrowserStubs } from './helpers.mjs';

const outputRoot = path.resolve('artifacts/argentina-merchandising');

async function capture(page, viewport, name, fullPage = false) {
  await page.screenshot({
    path: path.join(outputRoot, String(viewport.width), `${name}.png`),
    fullPage,
  });
}

async function captureAround(page, locator, viewport, name) {
  const top = await locator.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 60)), top);
  await page.waitForTimeout(300);
  await capture(page, viewport, name);
}

test('visual QA del surtido argentino en mobile y desktop', async ({ page }) => {
  await installBrowserStubs(page);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    mkdirSync(path.join(outputRoot, String(viewport.width)), { recursive: true });
    await page.setViewportSize(viewport);

    await gotoDemoReset(page, '/?reset=1&demo=1');
    await expect(page.locator('[data-view="home"] .home-best-card').first()).toBeVisible();
    await capture(page, viewport, '01-cold-start-home');

    await page.locator('[data-home-category-strip] [data-category-id="cervezas"]').click();
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await expect(page.locator('[data-product-modal] .modal-card')).toBeVisible();
    await page.locator('[data-close-modal]').click();
    await page.locator('[data-nav-view="home"]:visible').first().click();
    await page.waitForTimeout(500);
    await capture(page, viewport, '02-beer-intent-home');

    await expect(page.locator('[data-home-combos-section]')).toBeVisible();
    await captureAround(page, page.locator('[data-home-combos-section]'), viewport, '03-beer-packs-and-combos');

    await page.locator('[data-combo-card="combo-heineken-x6"] [data-combo-detail]').first().click();
    await expect(page.locator('[data-add-combo="combo-heineken-x6"]')).toBeVisible();
    await page.locator('[data-add-combo="combo-heineken-x6"]').click();
    await page.locator('[data-nav-view="cart"]:visible').first().click();
    await expect(page.locator('[data-cart-combo="combo-heineken-x6"]')).toBeVisible();
    await page.locator('[data-cart-combo="combo-heineken-x6"]').scrollIntoViewIfNeeded();
    await capture(page, viewport, '04-beer-pack-cart');
    await page.locator('[data-nav-view="home"]:visible').first().click();

    await page.locator('[data-home-category-strip] [data-category-id="cervezas"]').click();
    await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
    await page.locator('[data-nav-view="home"]:visible').first().click();
    await page.waitForTimeout(500);
    await capture(page, viewport, '05-beer-cart-home');

    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.locator('[data-view="home"] [data-search-input]').fill('fernet');
    await expect(page.locator('[data-view="catalog"] [data-search-input]')).toHaveValue('fernet');
    await page.locator('[data-view="catalog"] [data-category-id="all"]').click();
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    await capture(page, viewport, '06-fernet-intent-pending-catalog');

    await page.locator('[data-view="catalog"] [data-search-input]').fill('vodka');
    await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(0);
    await capture(page, viewport, '07-vodka-gap-no-authority');

    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.locator('[data-combo-detail]').first().click();
    await expect(page.locator('[data-combo-modal] .combo-modal-card')).toBeVisible();
    await capture(page, viewport, '08-combo-detail-components');
  }
});
