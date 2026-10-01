/*
 * Campañas animadas, medidas en un navegador de verdad.
 *
 * La tienda corre en modo producción con las 46 fichas reales servidas por un
 * backend en memoria (`catalog-runtime-fixture.mjs`). Las campañas del
 * repositorio están apagadas; `useQaCampaigns` le sirve a ESTA página las
 * mismas campañas marcadas como aprobadas.
 *
 * Lo que se comprueba es lo que una hoja de estilos no puede afirmar sola: que
 * la pieza no mueve el primer precio, que no toca el carrito, que se pausa
 * fuera de pantalla, que no crea nodos ni reemplaza tarjetas, y que sin
 * animación sigue siendo una pieza completa.
 */
import { expect, test } from '@playwright/test';
import { GRID, openRuntimeCatalog, instrumentCatalog, readProbe, clickCatalogCategory } from './catalog-runtime-fixture.mjs';
import { HERO, INLINE, finishScene, sceneState, useQaCampaigns } from './campaigns-fixture.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const goHome = async (page) => {
  await page.locator('[data-nav-view="home"]:visible').first().click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  // Al cambiar de vista la tienda lleva el foco al encabezado, en el cuadro
  // siguiente. Una prueba que usa el teclado tiene que esperar a que ese cuadro
  // pase: en WebKit llega tarde y le sacaba el foco al botón que la prueba
  // acababa de enfocar. Los cuadros se atienden en orden, así que cuando corre
  // el de la prueba el de la tienda ya corrió.
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
};
const goCatalog = async (page) => {
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
};
const heroPiece = `${HERO} [data-campaign]`;

/** Dónde termina el primer «Agregar» y dónde empieza la barra inferior. */
const fold = (page) => page.evaluate(() => {
  const nav = document.querySelector('.mobile-nav');
  const navHeight = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
  const add = document.querySelector('[data-view="home"] [data-add-product]');
  const hero = document.querySelector('[data-home-hero-promo] > *');
  return {
    useful: Math.round(window.innerHeight - navHeight),
    firstAdd: add ? Math.round(add.getBoundingClientRect().bottom + window.scrollY) : null,
    heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  };
});

test('con la configuración del repositorio no hay ninguna pieza: la tienda es la de siempre', async ({ page }) => {
  await openRuntimeCatalog(page);
  await expect(page.locator('[data-campaign]')).toHaveCount(0);
  await goHome(page);
  await expect(page.locator('[data-campaign]')).toHaveCount(0);
  await expect(page.locator(`${HERO} .home-hero-promo`)).toBeVisible();
  await expect(page.locator(INLINE)).toBeHidden();
  const diagnostics = await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics());
  expect(diagnostics).toMatchObject({ active: true, campaigns: 0, running: 0, plays: 0 });
});

test('la campaña ocupa la banda de apertura sin mover el primer precio ni desbordar', async ({ page, browser }) => {
  // Línea de base: la puerta editorial, en otra página, con los mismos datos.
  const baseline = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await openRuntimeCatalog(baseline);
  await goHome(baseline);
  const editorial = await fold(baseline);
  await baseline.close();

  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  await expect(page.locator(heroPiece)).toBeVisible();
  await expect(page.locator(`${HERO} .home-hero-promo`)).toHaveCount(0);

  for (const size of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    const measured = await fold(page);
    expect(measured.overflowX, `${size.width}px: la pieza desborda a lo ancho`).toBe(false);
    expect(measured.firstAdd, `${size.width}px: el primer «Agregar» quedó bajo el pliegue`).toBeLessThanOrEqual(measured.useful);
    // Ni un texto cortado: título, acción y leyenda entran enteros.
    const clipped = await page.locator(heroPiece).evaluate((root) => [...root.querySelectorAll('.cmp-headline, .cmp-cta, .cmp-legal')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > root.getBoundingClientRect().right)
      .map((node) => node.className));
    expect(clipped, `${size.width}px: texto cortado`).toEqual([]);
  }

  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(250);
  const campaign = await fold(page);
  expect(campaign.heroHeight, 'la pieza es más alta que la puerta editorial que reemplaza').toBeLessThanOrEqual(editorial.heroHeight);
  expect(campaign.firstAdd, 'la pieza empujó el primer «Agregar»').toBeLessThanOrEqual(editorial.firstAdd);
});

test('la escena corre sin crear ni quitar un solo nodo y termina en su cuadro final', async ({ page }) => {
  const imageRequests = [];
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const piece = page.locator(heroPiece);
  await expect(piece).toHaveAttribute('data-motion-campaign', 'on');
  await expect(piece).toHaveAttribute('data-campaign-preset', 'beer_pour');
  page.on('request', (request) => { if (request.resourceType() === 'image') imageRequests.push(request.url()); });
  await piece.evaluate((root) => {
    window.__sceneMutations = 0;
    new MutationObserver((records) => { window.__sceneMutations += records.length; })
      .observe(root, { childList: true, subtree: true, characterData: true });
  });
  const playing = await sceneState(page, heroPiece);
  expect(playing.total, 'la escena no tiene animaciones').toBeGreaterThan(10);
  // Sólo transform y opacity: ninguna propiedad que maquete o repinte.
  const properties = await piece.evaluate((root) => [...new Set(root.getAnimations({ subtree: true })
    .flatMap((animation) => animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame)))
    .filter((key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key)))].sort());
  expect(properties).toEqual(['opacity', 'transform']);

  await finishScene(page, heroPiece);
  await page.waitForTimeout(200);
  const rest = await piece.evaluate((root) => ({
    cta: getComputedStyle(root.querySelector('.cmp-cta')).opacity,
    fill: getComputedStyle(root.querySelector('.cmp-fill')).transform,
    stream: root.querySelector('.cmp-stream i').getBoundingClientRect().top > root.querySelector('.cmp-stream').getBoundingClientRect().bottom - 1,
  }));
  expect(rest.cta, 'la acción no quedó a la vista').toBe('1');
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(rest.fill);
  expect(rest.stream, 'el chorro quedó a la vista después de servir').toBe(true);
  expect(await page.evaluate(() => window.__sceneMutations), 'la escena tocó el DOM mientras corría').toBe(0);
  expect(imageRequests, 'la escena pidió imágenes').toEqual([]);
});

test('movimiento reducido: ninguna animación, y la pieza completa', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const piece = page.locator(heroPiece);
  await expect(piece).toBeVisible();
  await page.waitForTimeout(600);
  const state = await sceneState(page, heroPiece);
  expect(state).toMatchObject({ state: 'still', total: 0 });
  await expect(piece.locator('.cmp-headline')).toBeVisible();
  await expect(piece.locator('.cmp-cta')).toBeVisible();
  await expect(piece.locator('.cmp-legal')).toBeVisible();
  expect(await piece.locator('.cmp-cta').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  // La franja intermedia, igual.
  await page.locator(`${INLINE} [data-campaign]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  expect(await sceneState(page, `${INLINE} [data-campaign]`)).toMatchObject({ state: 'still', total: 0 });
  await expect(page.locator(`${INLINE} .cmp-sub`)).toBeVisible();
  const diagnostics = await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics());
  expect(diagnostics).toMatchObject({ reducedMotion: true, running: 0, plays: 0 });
  await context.close();
});

test('fuera de pantalla la escena se pausa, y al volver sigue donde estaba', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const piece = page.locator(heroPiece);
  await expect(piece).toHaveAttribute('data-motion-campaign-live', 'true');
  expect((await sceneState(page, heroPiece)).running).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(piece).toHaveAttribute('data-motion-campaign-live', 'false');
  const away = await sceneState(page, heroPiece);
  expect(away.running, 'quedó una animación corriendo fuera de pantalla').toBe(0);
  const playsAway = (await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays;

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(piece).toHaveAttribute('data-motion-campaign-live', 'true');
  // Volver enseguida NO reinicia la función: sigue la misma entrada.
  const playsBack = (await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays;
  expect(playsBack).toBe(playsAway);
});

test('tocar la pieza abre la ficha de SU producto y no toca el carrito', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const cartBefore = await page.locator('[data-cart-count]').first().textContent();
  const hashBefore = await page.evaluate(() => window.location.hash);
  const hit = page.locator(`${heroPiece} [data-campaign-cta]`);
  await expect(hit).toHaveAccessibleName(/Bien fría, recién servida\. Heineken Lager · 710 ml · Lata\. Ver Heineken/);
  await hit.click();
  const modal = page.locator('[data-product-modal]');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Heineken Lager');
  await expect(modal).toContainText('mayores de 18');
  expect(await page.locator('[data-cart-count]').first().textContent(), 'la pieza agregó algo al carrito').toBe(cartBefore);
  expect(await page.evaluate(() => window.location.hash), 'la pieza navegó a otra vista').toBe(hashBefore);
  await modal.locator('[data-close-modal]').click();
  await expect(modal).toBeHidden();
  // El foco vuelve a la pieza, que es de donde salió.
  await expect(hit).toBeFocused();
  // Y un toque en la ESCENA no hace nada distinto: es el mismo botón.
  await page.locator(`${heroPiece} .cmp-stage`).click({ position: { x: 20, y: 30 }, force: true });
  await expect(modal).toBeVisible();
  await modal.locator('[data-close-modal]').click();
  expect(await page.locator('[data-cart-count]').first().textContent()).toBe(cartBefore);
});

test('la pieza se recorre con teclado y se puede ocultar; no vuelve en la visita', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const hit = page.locator(`${heroPiece} [data-campaign-cta]`);
  const close = page.locator(`${heroPiece} [data-campaign-dismiss]`);
  await hit.focus();
  await expect(hit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect(close).toHaveAccessibleName('Ocultar este anuncio');
  const size = await close.boundingBox();
  expect(Math.min(size.width, size.height), 'el botón de ocultar no llega a 44 px').toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Enter');

  // Vuelve la puerta editorial —o la campaña siguiente— y el foco no se pierde.
  await expect(page.locator('[data-campaign="heineken-beer-pour"]')).toHaveCount(0);
  await expect(page.locator(`${HERO} button`).first()).toBeFocused();
  await expect(page.locator('[data-toast]')).toContainText('Ocultamos el anuncio');

  await goCatalog(page);
  await goHome(page);
  await expect(page.locator('[data-campaign="heineken-beer-pour"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup', 'ready', { timeout: 20000 });
  await goHome(page);
  await expect(page.locator('[data-campaign="heineken-beer-pour"]')).toHaveCount(0);
});

test('pieza de grilla: tras la cuarta tarjeta, nunca en una búsqueda ni con filtros, y el alcohol sólo en su rubro', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await instrumentCatalog(page);
  const gridPiece = page.locator(`${GRID} [data-campaign]`);
  await expect(gridPiece).toHaveCount(1);
  await expect(gridPiece).toHaveAttribute('data-campaign', 'red-bull-cold-can');
  expect(await page.locator(GRID).evaluate((grid) => [...grid.children].findIndex((node) => node.matches('[data-campaign]')))).toBe(4);
  await expect(gridPiece.locator('.cmp-legal')).toHaveCount(0);

  const search = page.locator('[data-view="catalog"] [data-search-input]');
  await search.fill('coca');
  await expect(gridPiece).toHaveCount(0);
  await search.fill('');
  await expect(gridPiece).toHaveCount(1);

  const filters = page.locator('[data-catalog-filters]');
  await filters.locator('summary').click();
  await filters.locator('[data-catalog-filter="alcohol"]').selectOption('without');
  await expect(gridPiece).toHaveCount(0);
  await filters.locator('[data-reset-catalog-filters]').click();
  await filters.locator('[data-close-catalog-filters]').click();
  await expect(gridPiece).toHaveCount(1);

  await clickCatalogCategory(page, 'cervezas');
  await expect(gridPiece).toHaveAttribute('data-campaign', 'heineken-beer-pour');
  await expect(gridPiece.locator('.cmp-legal')).toHaveText('Beber con moderación. Prohibida su venta a menores de 18 años.');
  await clickCatalogCategory(page, 'gaseosas');
  // Siete gaseosas: una lista corta no lleva pieza.
  await expect(gridPiece).toHaveCount(0);
  await clickCatalogCategory(page, 'all');
  await expect(gridPiece).toHaveAttribute('data-campaign', 'red-bull-cold-can');

  const metrics = await readProbe(page);
  expect(metrics.cardReplacements, 'la pieza de grilla reemplazó tarjetas al entrar o salir').toBe(0);
  expect(metrics.imageReplacements).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('con eventos de Realtime idénticos, las piezas conservan su nodo y no reinician la escena', async ({ page }) => {
  test.setTimeout(70000);
  await useQaCampaigns(page);
  const backend = await openRuntimeCatalog(page);
  await expect.poll(() => backend.counters.joined).toBeGreaterThan(0);
  await instrumentCatalog(page);
  await page.evaluate(() => { window.__gridPiece = document.querySelector('[data-product-grid] [data-campaign]'); });
  const before = await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics());
  const reads = backend.counters.products;
  for (let i = 0; i < 4; i += 1) { backend.emit(); await page.waitForTimeout(300); }
  await expect.poll(() => backend.counters.products).toBeGreaterThan(reads);
  const after = await page.evaluate(() => ({
    sameNode: window.__gridPiece === document.querySelector('[data-product-grid] [data-campaign]'),
    diagnostics: window.TABA2_CAMPAIGNS.getDiagnostics(),
  }));
  expect(after.sameNode, 'un evento idéntico reemplazó la pieza').toBe(true);
  expect(after.diagnostics.campaigns).toBe(before.campaigns);
  const metrics = await readProbe(page);
  expect(metrics.cardReplacements).toBe(0);
  expect(metrics.imageReplacements).toBe(0);
  expect(metrics.opacityResets).toBe(0);

  // Y cuando el producto de la campaña deja de poder comprarse, la pieza se va sola.
  const redBull = backend.rows.find((row) => row.sku === 'red-bull-energy-drink-355ml');
  redBull.stock = 0;
  redBull.available = false;
  backend.emit();
  await expect(page.locator(`${GRID} [data-campaign="red-bull-cold-can"]`)).toHaveCount(0, { timeout: 10000 });
  expect((await readProbe(page)).cardReplacements).toBe(0);
});

test('si el movimiento no puede arrancar, la tienda abre y la pieza queda estática y completa', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  // El observador de las campañas (umbral doble) revienta; el del resto de la tienda, no.
  await page.addInitScript(() => {
    const Real = window.IntersectionObserver;
    window.IntersectionObserver = class extends Real {
      constructor(callback, options) {
        if (Array.isArray(options?.threshold) && options.threshold.length === 2) throw new Error('observador de campañas roto (prueba)');
        super(callback, options);
      }
    };
  });
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const piece = page.locator(heroPiece);
  await expect(piece).toBeVisible();
  expect(await sceneState(page, heroPiece)).toMatchObject({ state: 'still', total: 0 });
  await expect(piece.locator('.cmp-cta')).toBeVisible();
  expect(await piece.locator('.cmp-cta').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  expect(await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).toEqual({ active: false });
  await piece.locator('[data-campaign-cta]').click();
  await expect(page.locator('[data-product-modal]')).toBeVisible();
  expect(errors, 'una falla de la animación llegó a ser un error de la página').toEqual([]);
});
