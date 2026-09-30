import { expect, test } from '@playwright/test';
import { GRID, openRuntimeCatalog, instrumentCatalog, scrollCatalog, readProbe } from './catalog-runtime-fixture.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('Realtime sano: diez recorridos y eventos idénticos conservan cards e imágenes', async ({ page }, info) => {
  test.setTimeout(70000);
  const backend = await openRuntimeCatalog(page);
  await expect.poll(() => backend.counters.joined).toBeGreaterThan(0);
  await instrumentCatalog(page);
  const reads = backend.counters.products;
  await scrollCatalog(page, 10);
  // SUBSCRIBED must suppress the 5-second fallback.
  await page.waitForTimeout(6000);
  expect(backend.counters.products).toBe(reads);
  for (let i = 0; i < 3; i++) { backend.emit(); await page.waitForTimeout(300); }
  await expect.poll(() => backend.counters.products).toBeGreaterThan(reads);
  const metrics = await readProbe(page);
  await info.attach('runtime-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(metrics.cardReplacements).toBe(0);
  expect(metrics.imageReplacements).toBe(0);
  expect(metrics.skeletons).toBe(0);
  expect(metrics.opacityResets).toBe(0);
});

test('Realtime caído: treinta segundos de polling idéntico y un cambio aislado', async ({ page }, info) => {
  test.setTimeout(65000);
  const backend = await openRuntimeCatalog(page, { realtime: false });
  await instrumentCatalog(page);
  await page.evaluate(() => {
    let step = 0;
    window.__runtimeScrollTimer = setInterval(() => {
      const progress = (++step % 40) / 20;
      scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * (progress <= 1 ? progress : 2 - progress));
    }, 150);
  });
  await page.waitForTimeout(31000);
  await expect.poll(() => backend.counters.products, { timeout: 15000 }).toBeGreaterThanOrEqual(6);
  await page.evaluate(() => clearInterval(window.__runtimeScrollTimer));
  expect(backend.counters.products).toBeGreaterThanOrEqual(6);
  const beforeChange = await readProbe(page);
  await info.attach('polling-metrics', { body: JSON.stringify(beforeChange), contentType: 'application/json' });
  expect(beforeChange.cardReplacements).toBe(0);
  expect(beforeChange.imageReplacements).toBe(0);
  expect(beforeChange.removedCards).toBe(0);
  expect(beforeChange.skeletons).toBe(0);
  expect(beforeChange.opacityResets).toBe(0);
  backend.rows[0].price = 4321;
  backend.rows[0].stock = 3;
  const target = page.locator(`${GRID} .product-card`).filter({ has: page.locator(`[data-product-detail="${backend.rows[0].id}"]`) });
  await expect(target).toContainText('4.321', { timeout: 10000 });
  await expect(target).toContainText('Últimas 3');
  const afterChange = await readProbe(page);
  expect(afterChange.cardReplacements).toBe(0);
  expect(afterChange.imageReplacements).toBe(0);
});

test('precio pendiente residual: ficha abierta, Realtime, búsqueda, home y vuelta', async ({ page }) => {
  const backend = await openRuntimeCatalog(page);
  const id = backend.rows[0].id;
  await page.locator(`${GRID} [data-product-detail="${id}"]`).first().click();
  const modal = page.locator('[data-product-modal]');
  await expect(modal).toContainText('2.500');
  const image = await modal.locator('img').elementHandle();
  backend.rows[0].price_status = 'pending';
  backend.rows[0].price = 99999;
  backend.emit();
  await expect(modal.locator('[data-price-pending-message]')).toBeVisible();
  await expect(modal).not.toContainText('$');
  await expect(modal).not.toContainText('99.999');
  expect(await modal.locator('img').evaluate((node, original) => node === original, image)).toBe(true);
  await modal.locator('[data-close-modal]').click();
  await page.locator('[data-view="catalog"] [data-search-input]').fill('alamos');
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(0);
  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.locator('[data-nav-view="home"]:visible').first().click();
  await expect(page.locator('[data-view="home"]')).not.toContainText('99.999');
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(45);
  await expect(page.locator(`${GRID} [data-product-detail="${id}"]`)).toHaveCount(0);
});

test('diez ciclos completos y sesión de dos minutos conservan identidades y posición', async ({ page }, info) => {
  test.setTimeout(170000);
  const backend = await openRuntimeCatalog(page);
  await instrumentCatalog(page);
  const started = Date.now();
  const categories = ['cervezas', 'gaseosas', 'aguas', 'vinos', 'energizantes'];
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-nav-view="home"]:visible').first().click();
    await page.locator('[data-nav-view="catalog"]:visible').first().click();
    // User actions pass through the real event handlers; no catalog functions are mocked.
    const chip = page.locator(`[data-view="catalog"] [data-category-id="${categories[i % categories.length]}"]`).first();
    await chip.click();
    await scrollCatalog(page);
    await page.locator('[data-view="catalog"] [data-category-id="all"]').first().click();
    const search = page.locator('[data-view="catalog"] [data-search-input]');
    await search.fill(i % 2 ? 'HEINEKEN' : 'coca');
    await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
    const detail = page.locator(`${GRID} [data-product-detail]`).first();
    await detail.click();
    const position = await page.evaluate(() => scrollY);
    await expect(page.locator('[data-product-modal]')).toBeVisible();
    await page.locator('[data-product-modal] [data-close-modal]').click();
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThanOrEqual(1);
    await search.fill('');
    await page.locator(`[data-view="catalog"] [data-category-id="${categories[(i + 1) % categories.length]}"]`).first().click();
    await page.locator('[data-view="catalog"] [data-category-id="all"]').first().click();
    backend.emit();
  }
  while (Date.now() - started < 120000) {
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(2000);
    await page.mouse.wheel(0, -800);
    backend.emit();
    await page.waitForTimeout(2000);
  }
  const metrics = await readProbe(page);
  await info.attach('long-session-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
  expect(metrics.cards).toBe(46);
  expect(metrics.cardReplacements).toBe(0);
  expect(metrics.imageReplacements).toBe(0);
  expect(metrics.skeletons).toBe(0);
  expect(metrics.opacityResets).toBe(0);
  expect(metrics.cls).toBeLessThan(0.1);
});
