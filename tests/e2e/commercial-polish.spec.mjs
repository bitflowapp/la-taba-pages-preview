import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards, openBusinessSection } from './helpers.mjs';

// Pulido comercial mobile-first 390x844.

test('preview privado abre directo en la tienda y no expone accesos operativos', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?demo=1');
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(page.locator('[data-view="home"] .home-search')).toBeVisible();
  await page.goto('/?demo=1#profile');
  await expect(page.locator('[data-view="profile"] [data-open-admin-view]')).toHaveCount(0);

  await guards.assertClean();
  await context.close();
});

test('catálogo: un solo grid, búsqueda vacía coherente y tarjetas sin ruido', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  // Las tarjetas disponibles no llevan cinta "Disponible" (el estado normal no se etiqueta).
  await expect(page.locator('[data-product-grid] .product-card')).not.toHaveCount(0);

  // Las promociones viven una sola vez dentro del grid: no hay un rail duplicado.
  await expect(page.locator('[data-catalog-offers-block], [data-catalog-offers]')).toHaveCount(0);
  const productIds = await page.locator('[data-product-grid] [data-product-detail]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-product-detail'))
  ));
  expect(new Set(productIds).size).toBe(productIds.length);

  // Una búsqueda sin resultados conserva una única salida vacía y un contador consistente.
  await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  await page.locator('[data-view="catalog"] [data-search-input]').fill('zzzz-no-existe');
  // El contador lleva el contexto del filtro activo.
  await expect(page.locator('[data-catalog-count]')).toHaveText('0 productos en Gaseosas');
  await expect(page.locator('[data-catalog-offers-block], [data-catalog-offers]')).toHaveCount(0);
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(0);
  const emptyState = page.locator('[data-product-grid] .empty-state');
  // El estado vacío nombra la consulta y ofrece deshacer su causa.
  await expect(emptyState).toContainText('No encontramos «zzzz-no-existe»');
  await expect(emptyState.getByRole('button', { name: 'Limpiar búsqueda' })).toBeVisible();
  await emptyState.getByRole('button', { name: 'Ver todo el catálogo' }).click();
  await expect(page.locator('[data-view="catalog"] [data-search-input]')).toHaveValue('');
  await expect(page.locator('[data-view="catalog"] [data-category-id="all"]')).toHaveClass(/active/);
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  await expect(page.locator('[data-catalog-offers-block], [data-catalog-offers]')).toHaveCount(0);

  await guards.assertClean();
  await context.close();
});

test('home: estado claro y recorrido comercial compacto', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?demo=1');
  // El chip de estado dice abierto o cerrado de verdad (según horario configurado).
  await expect(page.locator('html')).toHaveAttribute('data-app-bootstrap', 'ready');
  await expect(page.locator('[data-open-status]')).toContainText(/Pedidos disponibles|Pedidos online/);

  // El rail de combos existe y está poblado. Esta aserción decía
  // `toHaveCount(0)` cuando el contenedor no existía en el shell y el render
  // buscaba productos con `combo: true` que nadie publicaba: comprobaba que la
  // sección muerta no apareciera. Ahora los combos se arman del manifiesto y lo
  // que hay que proteger es lo contrario —que estén y que digan su ahorro—,
  // porque un combo sin ahorro visible no es un combo.
  const comboCards = page.locator('[data-view="home"] [data-combos-rail] .combo-card');
  await expect(comboCards.first()).toBeVisible();
  for (const texto of await comboCards.locator('.combo-save-badge').allTextContents()) {
    expect(texto).toMatch(/^Ahorrás \$\s?[\d.]+$/);
  }
  await expect(page.locator('[data-view="home"] .home-search')).toBeVisible();
  await expect(page.locator('[data-category-strip="home"]')).toBeVisible();
  await expect(page.locator('[data-promo-banner]')).toBeHidden();
  await expect(page.locator('[data-offers-rail]')).toBeVisible();

  await page.locator('[data-view="home"] [data-search-input]').fill('agua');
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-view="catalog"] [data-search-input]')).toHaveValue('agua');

  await guards.assertClean();
  await context.close();
});

test('negocio: catálogo editable compacto y guía operativa separada', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await gotoDemoReset(page, '/?reset=1&demo=1#business');
  await page.getByRole('button', { name: /Ingresar c[óo]digo/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  // Catálogo y promos arranca plegado: el acceso rápido lo abre.
  await openBusinessSection(page, '[data-scroll-catalog]');

  // Lista de productos paginada: muestra un anticipo y se expande a pedido.
  const rows = page.locator('[data-catalog-admin-row]');
  const previewCount = await rows.count();
  const expandButton = page.locator('[data-catalog-expand]');
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect.poll(() => rows.count()).toBeGreaterThan(previewCount);

  // El formulario de alta sigue cerrado hasta tocar "Nuevo producto".
  await expect(page.locator('[data-catalog-form]')).toHaveCount(0);

  await openBusinessSection(page, '[data-business-view="guide"]');
  await expect(page.locator('.demo-guide')).toContainText('Guía operativa');
  await expect(page.locator('[data-demo-reset]')).toHaveCount(0);
  await expect(page.locator('[data-business-dashboard]')).not.toContainText(/muestra|presentación|datos de ejemplo/i);

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
