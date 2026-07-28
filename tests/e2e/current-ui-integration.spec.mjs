import { test, expect } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

test('current UI renders the 14-product premium catalog with local images and gray banner', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?reset=1&demo=1#catalog');

  const cards = page.locator('[data-product-grid] .product-card');
  await expect(cards).toHaveCount(14);
  await expect(page.locator('[data-catalog-count]')).toContainText('14 productos');
  await expect(page.locator('[data-product-grid] .uses-placeholder')).toHaveCount(0);

  const images = page.locator('[data-product-grid] .thumb.has-photo .thumb-img');
  await expect(images).toHaveCount(14);
  await expect.poll(() => images.evaluateAll((nodes) => nodes.every(
    (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
  ))).toBe(true);

  const imageUrls = await images.evaluateAll((nodes) => nodes.map((image) => image.currentSrc || image.src));
  expect(new Set(imageUrls).size).toBeGreaterThan(0);
  for (const imageUrl of imageUrls) {
    const parsed = new URL(imageUrl);
    expect(parsed.origin).toBe(new URL(page.url()).origin);
    expect(parsed.pathname).toMatch(/^\/assets\/catalog\/(?:products|thumbnails)\//);
  }

  const banner = page.locator('[data-current-ui-bottom-banner]');
  await expect(banner).toBeVisible();
  const bannerVisual = await banner.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      bottomGap: window.innerHeight - rect.bottom,
      height: rect.height,
    };
  });
  expect(bannerVisual.backgroundColor).toBe('rgba(56, 59, 65, 0.96)');
  expect(Number.parseFloat(bannerVisual.borderRadius)).toBeGreaterThanOrEqual(28);
  expect(bannerVisual.bottomGap).toBeGreaterThanOrEqual(8);
  expect(bannerVisual.height).toBeGreaterThanOrEqual(70);
  await guards.assertClean();
});
