import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

// Commercial polish v1: presentación comercial, catálogo sin ruido y
// herramientas del presentador. Mobile-first 390x844.

test('presentación comercial: se abre con ?pitch=1, se cierra y no vuelve sola', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?pitch=1&demo=1');
  const pitch = page.locator('[data-pitch-modal]');
  await expect(pitch).toBeVisible();
  await expect(pitch).toContainText('Tu propio canal de pedidos');
  await expect(pitch).toContainText('Pedidos ordenados');
  await expect(pitch).toContainText('Vista del repartidor');

  await pitch.getByRole('button', { name: 'Probar la experiencia' }).click();
  await expect(pitch).toBeHidden();
  await expect(page.locator('[data-view="home"]')).toBeVisible();

  // Sin el parámetro, la presentación no aparece sola (no molesta a recurrentes).
  await page.goto('/?demo=1');
  await expect(pitch).toBeHidden();

  // Desde Local se puede reabrir a demanda.
  await page.goto('/?demo=1#profile');
  await page.locator('[data-view="profile"] [data-open-pitch]').click();
  await expect(pitch).toBeVisible();
  await pitch.getByRole('button', { name: 'Probar la experiencia' }).click();

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
  await expect(page.locator('[data-product-grid] .stock-pill', { hasText: 'Disponible' })).toHaveCount(0);

  // Las promociones viven una sola vez dentro del grid: no hay un rail duplicado.
  await expect(page.locator('[data-catalog-offers-block], [data-catalog-offers]')).toHaveCount(0);
  const productIds = await page.locator('[data-product-grid] [data-product-detail]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-product-detail'))
  ));
  expect(new Set(productIds).size).toBe(productIds.length);

  // Una búsqueda sin resultados conserva una única salida vacía y un contador consistente.
  await page.locator('[data-view="catalog"] [data-search-input]').fill('zzzz-no-existe');
  await expect(page.locator('[data-catalog-count]')).toHaveText('0 productos');
  await expect(page.locator('[data-catalog-offers-block], [data-catalog-offers]')).toHaveCount(0);
  await expect(page.locator('[data-product-grid] .product-card')).toHaveCount(0);
  await expect(page.locator('[data-product-grid]')).toContainText('No hay productos en esta búsqueda.');

  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
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
  await expect(page.locator('[data-open-status]')).toContainText(/Pedidos disponibles|Pedidos online/);

  // Ofertas y combos destacados no repiten el mismo producto en el home.
  await expect(page.locator('[data-view="home"] [data-combos-rail]')).toHaveCount(0);
  await expect(page.locator('[data-view="home"] .home-search')).toBeVisible();
  await expect(page.locator('[data-view="home"] .promo-banner-neutral')).toBeVisible();

  await guards.assertClean();
  await context.close();
});

test('negocio: catálogo editable arranca compacto y el presentador tiene reinicio de demo', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await page.goto('/?reset=1&demo=1#business');
  await page.getByRole('button', { name: /Ingresar c[óo]digo/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  // Catálogo y promos arranca plegado: el acceso rápido lo abre.
  await page.locator('[data-scroll-catalog]').click();

  // Lista de productos paginada: muestra un anticipo y se expande a pedido.
  const rows = page.locator('[data-catalog-admin-row]');
  const previewCount = await rows.count();
  const expandButton = page.locator('[data-catalog-expand]');
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect.poll(() => rows.count()).toBeGreaterThan(previewCount);

  // El formulario de alta sigue cerrado hasta tocar "Nuevo producto".
  await expect(page.locator('[data-catalog-form]')).toHaveCount(0);

  // Guía del presentador: existe el reinicio de demo (no se ejecuta acá).
  await page.locator('.demo-guide summary').click();
  await expect(page.locator('[data-demo-reset]')).toBeVisible();

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBeTruthy();

  await guards.assertClean();
  await context.close();
});
