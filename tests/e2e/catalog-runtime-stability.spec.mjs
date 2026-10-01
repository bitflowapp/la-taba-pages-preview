import { expect, test } from '@playwright/test';
import { GRID, snapshot, openRuntimeCatalog, instrumentCatalog, scrollCatalog, readProbe, clickCatalogCategory } from './catalog-runtime-fixture.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('las variantes pendientes no afirman agotado ni filtran importes residuales', async ({ page }) => {
  const rows = snapshot.products.filter(p => p.sku.startsWith('sprite-'));
  expect(rows).toHaveLength(2);
  await page.addInitScript(() => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = null;
    localStorage.setItem('TABA_INSTALL_PROMPT_V1',JSON.stringify({v:1,decision:'declined',at:'2026-01-01',platform:'e2e'}));
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup', 'ready');
  await page.evaluate(async (rows) => {
    const { setState } = await import('/js/state.js');
    const { showProductModal } = await import('/js/ui.js');
    setState({ products: rows.map(p=>({...p,categoryId:'gaseosas',capacityValue:p.capacity_value,
      capacityUnit:p.capacity_unit,unitsPerPack:1,stock:0,stockPending:true,available:false,
      price:99999,price_status:'pending',pricePending:true,image:'',imageThumbnail:'',variants:rows.map(row=>row.id)})) });
    showProductModal(rows[0].id);
  }, rows);
  const modal = page.locator('[data-product-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.modal-variant-card')).toHaveCount(2);
  await expect(modal).not.toContainText('$');
  await expect(modal).not.toContainText('99.999');
  await expect(modal).not.toContainText('Sin stock');
  await expect(modal).not.toContainText('Agotado');
});

test('búsqueda rápida, filtros y orden conservan nodos y el último resultado', async ({ page }) => {
  await openRuntimeCatalog(page);
  await instrumentCatalog(page);
  await page.evaluate(() => {
    const input=document.querySelector('[data-view="catalog"] [data-search-input]');
    for(const query of ['h','heineken','','FERNET','','azúcar','','sprite']) {
      input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(2);
  await expect(page.locator(`${GRID} .product-card`).first()).toContainText('Sprite');
  const search=page.locator('[data-view="catalog"] [data-search-input]');
  await search.fill('');
  const filters=page.locator('[data-catalog-filters]');
  await filters.locator('summary').click();
  await filters.locator('[data-catalog-filter="brand"]').selectOption('heineken');
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(1);
  await expect(page.locator(`${GRID} .product-card`)).toContainText('Heineken');
  await filters.locator('[data-reset-catalog-filters]').click();
  await filters.locator('[data-close-catalog-filters]').click();
  await page.locator('[data-sort-select]').selectOption('price_asc');
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(46);
  const metrics=await readProbe(page);
  expect(metrics.cardReplacements).toBe(0);
  expect(metrics.imageReplacements).toBe(0);
  expect(metrics.categoryReplacements).toBe(0);
  expect(metrics.filterOptionReplacements).toBe(0);
  expect(metrics.imagesWithChildText).toBe(0);
});

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
  expect(metrics.categoryReplacements).toBe(0);
  expect(metrics.filterOptionReplacements).toBe(0);
});

test('Realtime caído: treinta segundos de polling idéntico y un cambio aislado', async ({ page }, info) => {
  test.setTimeout(100000);
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
  await info.attach('polling-read-times', { body: JSON.stringify(backend.counters.reads), contentType: 'application/json' });
  await expect.poll(() => backend.counters.products, { timeout: 35000 }).toBeGreaterThanOrEqual(6);
  await page.evaluate(() => clearInterval(window.__runtimeScrollTimer));
  expect(backend.counters.products).toBeGreaterThanOrEqual(6);
  const beforeChange = await readProbe(page);
  await info.attach('polling-metrics', { body: JSON.stringify(beforeChange), contentType: 'application/json' });
  expect(beforeChange.cardReplacements).toBe(0);
  expect(beforeChange.imageReplacements).toBe(0);
  expect(beforeChange.removedCards).toBe(0);
  expect(beforeChange.skeletons).toBe(0);
  expect(beforeChange.opacityResets).toBe(0);
  expect(beforeChange.categoryReplacements).toBe(0);
  expect(beforeChange.filterOptionReplacements).toBe(0);
  expect(beforeChange.imagesWithChildText).toBe(0);
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
  test.setTimeout(300000);
  const backend = await openRuntimeCatalog(page);
  await instrumentCatalog(page);
  const started = Date.now();
  const categories = ['cervezas', 'gaseosas', 'aguas', 'vinos', 'energizantes'];
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-nav-view="home"]:visible').first().click();
    await page.locator('[data-nav-view="catalog"]:visible').first().click();
    // User actions pass through the real event handlers; no catalog functions are mocked.
    await clickCatalogCategory(page, categories[i % categories.length]);
    await scrollCatalog(page);
    await clickCatalogCategory(page, 'all');
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
    await clickCatalogCategory(page, categories[(i + 1) % categories.length]);
    await clickCatalogCategory(page, 'all');
    backend.emit();
  }
  while (Date.now() - started < 120000) {
    await page.evaluate(() => scrollBy({ top: 800, behavior: 'instant' }));
    await page.waitForTimeout(2000);
    await page.evaluate(() => scrollBy({ top: -800, behavior: 'instant' }));
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

test('una nueva sesión de ficha descarta notas consumidas y canceladas', async ({ page }) => {
  const backend = await openRuntimeCatalog(page);
  const product = backend.rows
    .filter((row) => row.is_alcoholic === false && row.image_url && !row.sold_as_pack)
    .sort((left, right) => left.name.length - right.name.length)[0];
  const detail = page.locator(GRID + ' [data-product-detail="' + product.id + '"]').first();
  const modal = page.locator('[data-product-modal]');
  const note = modal.locator('[data-product-note]');
  await detail.click();
  await note.fill('nota-qa!');
  await modal.locator('[data-add-product]').click();
  await expect(modal).not.toBeVisible();
  const checkoutNote = page.locator('[name="customerNotes"]');
  const consumed = await checkoutNote.inputValue();
  expect(consumed).toContain(product.name);
  await detail.click();
  await expect(note).toHaveValue('');
  await modal.locator('[data-cart-dec]').click();
  await expect(modal.locator('[data-add-product]')).toBeVisible();
  await modal.locator('[data-add-product]').click();
  await expect(modal).not.toBeVisible();
  await expect(checkoutNote).toHaveValue(consumed);
  await detail.click();
  await note.fill('descartada con X');
  await modal.locator('[data-close-modal]').click();
  await detail.click();
  await expect(note).toHaveValue('');
  await note.fill('descartada con Escape');
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await detail.click();
  await expect(note).toHaveValue('');
});

test('Realtime conserva el borrador y la imagen de la ficha abierta', async ({ page }) => {
  const backend = await openRuntimeCatalog(page);
  const product = backend.rows.find((row) => row.is_alcoholic === false && row.image_url && !row.sold_as_pack);
  const detail = page.locator(GRID + ' [data-product-detail="' + product.id + '"]').first();
  const modal = page.locator('[data-product-modal]');
  await detail.click();
  const note = modal.locator('[data-product-note]');
  const originalNote = await note.elementHandle();
  const originalImage = await modal.locator('img').elementHandle();
  await note.fill('borrador vigente');
  product.price = 3519;
  backend.emit();
  await expect(modal.locator('.modal-price')).toContainText('3.519');
  await expect(note).toHaveValue('borrador vigente');
  expect(await note.evaluate((node, original) => node === original, originalNote)).toBe(true);
  expect(await modal.locator('img').evaluate((node, original) => node === original, originalImage)).toBe(true);
  await modal.locator('[data-close-modal]').click();
  await detail.click();
  await expect(note).toHaveValue('');
});

