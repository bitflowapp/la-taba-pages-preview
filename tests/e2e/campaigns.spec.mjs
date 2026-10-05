/*
 * Campañas animadas, medidas en un navegador de verdad.
 *
 * La tienda corre en modo producción con las 46 fichas reales servidas por un
 * backend en memoria (`catalog-runtime-fixture.mjs`). Las campañas del
 * repositorio están aprobadas para producción; `useQaCampaigns` permite
 * acotar o apagar campañas sólo dentro de una página de prueba.
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
  await page.bringToFront();
  await page.locator('.mobile-nav [data-nav-view="home"]:visible, .desktop-nav [data-nav-view="home"]:visible').first().click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  // Al cambiar de vista la tienda lleva el foco al encabezado, en el cuadro
  // siguiente. Una prueba que usa el teclado tiene que esperar a que ese cuadro
  // pase: en WebKit llega tarde y le sacaba el foco al botón que la prueba
  // acababa de enfocar. Los cuadros se atienden en orden, así que cuando corre
  // el de la prueba el de la tienda ya corrió.
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
};
const goCatalog = async (page) => {
  await page.bringToFront();
  await page.locator('.mobile-nav [data-nav-view="catalog"]:visible, .desktop-nav [data-nav-view="catalog"]:visible').first().click();
  await expect(page.locator(`${GRID} .product-card`).first()).toBeVisible();
};
const heroPiece = `${HERO} [data-campaign]`;

// A slow renderer can spend its motion budget while the preceding scene plays.
// Assert the live scene or the complete static fallback atomically, so the
// budget decision cannot race a later attribute read. Neither outcome skips
// the navigation/search assertions that prove the scene does not restart.
const assertLiveOrBudgetStill = async (page, selector) => {
  await expect.poll(() => page.evaluate((target) => {
    const root = document.querySelector(target);
    const diagnostics = window.TABA2_CAMPAIGNS?.getDiagnostics?.();
    if (!root || !diagnostics) return 'waiting';
    if (!diagnostics.budgetLimited) return root.dataset.motionCampaignLive === 'true' ? 'live' : 'waiting';
    const animations = document.getAnimations().filter((animation) => root.contains(animation.effect?.target));
    const cta = root.querySelector('.cmp-cta');
    const headline = root.querySelector('.cmp-headline');
    return !root.hasAttribute('data-motion-campaign') && !root.hasAttribute('data-motion-campaign-live')
      && animations.length === 0 && diagnostics.running === 0 && diagnostics.live === 0
      && getComputedStyle(cta).opacity === '1' && getComputedStyle(headline).opacity === '1'
      ? 'budget-static' : 'invalid-budget';
  }, selector)).toMatch(/^(live|budget-static)$/);
};

/** Dónde termina el primer «Agregar» y dónde empieza la barra inferior. */
const fold = (page) => page.evaluate(() => {
  const nav = document.querySelector('.mobile-nav');
  const navHeight = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().height : 0;
  const add = document.querySelector('[data-view="home"] [data-add-product]');
  // La banda ENTERA, no su primer hijo: la leyenda legal de la puerta editorial
  // es un hermano del botón, y medir sólo el botón la dejaba afuera de la
  // cuenta mientras que en la pieza animada quedaba adentro.
  const hero = document.querySelector('[data-home-hero-promo]');
  return {
    useful: Math.round(window.innerHeight - navHeight),
    firstAdd: add ? Math.round(add.getBoundingClientRect().bottom + window.scrollY) : null,
    heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  };
});

// El MOTOR con las campañas de prueba del snapshot CP. La configuración que se
// publica, con el catálogo vivo, está en `campaigns-live-products.spec.mjs`.
test('la configuración de prueba CP muestra sus campañas aprobadas con producto del snapshot', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  await expect(page.locator(`${HERO} [data-campaign="heineken-beer-pour"]`)).toBeVisible();
  await expect(page.locator(`${INLINE} [data-campaign="red-bull-cold-can"]`)).toHaveCount(1);
  const diagnostics = await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics());
  expect(diagnostics.active).toBe(true);
  expect(diagnostics.campaigns).toBeGreaterThanOrEqual(2);
});

test('la campaña ocupa la banda de apertura sin mover el primer precio ni desbordar', async ({ page, browser }) => {
  // Línea de base: la puerta editorial, en otra página, con los mismos datos.
  const baseline = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await useQaCampaigns(baseline, { only: [] });
  await openRuntimeCatalog(baseline);
  await goHome(baseline);
  const editorial = await fold(baseline);
  // Y en un escritorio bajo, donde la banda tiene su propio escalón de altura.
  await baseline.setViewportSize({ width: 1366, height: 768 });
  await baseline.waitForTimeout(250);
  const editorialDesktop = await fold(baseline);
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

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(250);
  const desktop = await fold(page);
  expect(desktop.overflowX, '1366px: la pieza desborda a lo ancho').toBe(false);
  expect(desktop.heroHeight, '1366×768: la pieza y la puerta editorial no miden lo mismo').toBe(editorialDesktop.heroHeight);
});

test('si la leyenda legal parte en dos renglones, la banda crece: no pisa la acción ni la escena', async ({ page, browser }) => {
  // La letra es la del sistema (`system-ui`). Donde es más ancha que la de
  // este equipo la leyenda no entra en un renglón: pasó en el CI, en Linux.
  // Estaba posicionada sobre la banda y el segundo renglón caía encima de
  // «Ver …» y de la base del vaso. La prueba no depende de qué fuentes tenga la
  // máquina: ensancha la leyenda con espaciado entre letras, que es lo que una
  // letra más ancha hace.
  const phone = { width: 360, height: 800 };
  const widen = (target) => target.addStyleTag({ content: '.cmp-legal, .home-hero-promo-legal { letter-spacing: 0.14em !important; }' });
  const measure = (target) => target.evaluate(() => {
    const band = document.querySelector('[data-home-hero-promo]');
    const legal = band.querySelector('.cmp-legal, .home-hero-promo-legal');
    const action = band.querySelector('.cmp-cta, .home-hero-promo-cta');
    const stage = band.querySelector('.cmp-stage');
    const range = document.createRange();
    range.selectNodeContents(legal);
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    const rect = (node) => node.getBoundingClientRect();
    return {
      lines,
      band: Math.round(rect(band).height * 10) / 10,
      legalTop: rect(legal).top,
      legalBottom: rect(legal).bottom,
      bandBottom: rect(band).bottom,
      actionBottom: action ? rect(action).bottom : null,
      stageBottom: stage ? rect(stage).bottom : null,
      clipped: legal.scrollWidth > legal.clientWidth + 1,
    };
  });

  const baseline = await browser.newPage({ viewport: phone });
  await openRuntimeCatalog(baseline);
  await goHome(baseline);
  const doorOneLine = await measure(baseline);
  await widen(baseline);
  await baseline.waitForTimeout(250);
  const door = await measure(baseline);
  await baseline.close();

  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  await page.setViewportSize(phone);
  await page.waitForTimeout(250);
  await expect(page.locator(heroPiece)).toBeVisible();
  await widen(page);
  await page.waitForTimeout(250);
  const piece = await measure(page);

  // El renglón de más se paga con alto de banda, no con texto encimado.
  // Donde la letra de la máquina ya parte la leyenda en dos sin ayuda (el CI, en
  // Linux), no hay renglón que sumar: ensancharla no puede achicar la banda.
  if (doorOneLine.lines === 1) {
    expect(door.band, 'la banda no creció con el segundo renglón').toBeGreaterThan(doorOneLine.band + 8);
  } else {
    expect(door.band, 'ensanchar la leyenda achicó la banda').toBeGreaterThanOrEqual(doorOneLine.band);
  }
  for (const [name, measured] of [['la puerta editorial', door], ['la pieza', piece]]) {
    expect(measured.lines, `${name}: la leyenda ensanchada debería partir en dos`).toBeGreaterThanOrEqual(2);
    expect(measured.clipped, `${name}: la leyenda quedó cortada`).toBe(false);
    expect(measured.legalBottom, `${name}: la leyenda se sale de la banda`).toBeLessThanOrEqual(measured.bandBottom + 0.5);
    // Las cajas de línea se tocan un par de píxeles por su interlineado; lo que
    // no puede pasar es que un renglón entero quede sobre la acción.
    expect(measured.legalTop, `${name}: la leyenda pisa la acción`).toBeGreaterThanOrEqual(measured.actionBottom - 5);
  }
  expect(piece.stageBottom, 'la escena llega hasta la leyenda').toBeLessThanOrEqual(piece.legalTop + 0.5);
  // Y las dos crecen lo mismo: cambiar una por la otra no mueve el primer precio.
  expect(piece.band, 'la pieza y la puerta dejaron de medir lo mismo con la leyenda en dos renglones').toBeLessThanOrEqual(door.band);
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

test('una pieza que todavía no se vio espera en su primer cuadro, no en el final', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  // La pieza de la grilla va tras la cuarta tarjeta: en un teléfono queda bajo
  // el pliegue. Antes esperaba mostrando la escena TERMINADA —la acción a la
  // vista— y al entrar en pantalla saltaba al vacío para recién ahí empezar.
  const piece = page.locator(`${GRID} [data-campaign]`);
  await expect(piece).toHaveCount(1);
  expect(await piece.evaluate((root) => root.getBoundingClientRect().top > window.innerHeight)).toBe(true);
  await expect(piece).toHaveAttribute('data-motion-campaign', 'on');
  await expect(piece).toHaveAttribute('data-motion-campaign-live', 'false');
  const armed = await sceneState(page, `${GRID} [data-campaign]`);
  expect(armed.total, 'la pieza no tiene su escena preparada').toBeGreaterThan(5);
  expect(armed.running, 'la escena corre sin que nadie la vea').toBe(0);
  expect(await piece.locator('.cmp-cta').evaluate((node) => getComputedStyle(node).opacity)).toBe('0');
  expect((await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays).toBe(0);
  // El título, en cambio, está desde el primer cuadro: la pieza nunca es un hueco.
  expect(await piece.locator('.cmp-headline').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');

  await piece.scrollIntoViewIfNeeded();
  await expect(piece).toHaveAttribute('data-motion-campaign-live', 'true');
  expect((await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays).toBe(1);
  await finishScene(page, `${GRID} [data-campaign]`);
  expect(await piece.locator('.cmp-cta').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
});

test('volver a la home, o borrar una búsqueda, no repite la función', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const piece = page.locator(heroPiece);
  await assertLiveOrBudgetStill(page, heroPiece);
  const duration = await piece.evaluate((root) => Number.parseFloat(getComputedStyle(root).getPropertyValue('--cmp-dur')) * 1000);
  // La entrada se ve entera, en tiempo real: es lo que hace una persona.
  await page.waitForTimeout(duration + 400);
  const plays = (await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays;

  // Las vistas se ocultan con `display: none`, que cancela las animaciones CSS:
  // con la escena todavía «encendida», al volver arrancaba de cero.
  await goCatalog(page);
  await expect(piece).not.toHaveAttribute('data-motion-campaign', 'on');
  await goHome(page);
  await expect(piece).toBeVisible();
  await page.waitForTimeout(400);
  const back = await sceneState(page, heroPiece);
  expect(back.state, 'la escena se volvió a encender al volver a la home').toBe('still');
  expect(back.total, 'al volver hay animaciones corriendo otra vez').toBe(0);
  expect(await piece.locator('.cmp-cta').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  expect((await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays, 'la función se repitió').toBe(plays);

  // Lo mismo con la pieza de la grilla, que sale y vuelve con cada búsqueda.
  await goCatalog(page);
  const gridPiece = page.locator(`${GRID} [data-campaign]`);
  await gridPiece.scrollIntoViewIfNeeded();
  await assertLiveOrBudgetStill(page, `${GRID} [data-campaign]`);
  const gridDuration = await gridPiece.evaluate((root) => Number.parseFloat(getComputedStyle(root).getPropertyValue('--cmp-dur')) * 1000);
  await page.waitForTimeout(gridDuration + 400);
  const playsGrid = (await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays;
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  await search.fill('coca');
  await expect(gridPiece).toHaveCount(0);
  await search.fill('');
  await expect(gridPiece).toHaveCount(1);
  await gridPiece.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const again = await sceneState(page, `${GRID} [data-campaign]`);
  expect(again.state, 'borrar la búsqueda volvió a encender la escena').toBe('still');
  expect(again.total, 'borrar la búsqueda volvió a crear animaciones').toBe(0);
  expect(await gridPiece.locator('.cmp-cta').evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  expect((await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays).toBe(playsGrid);
});

test('un renderer lento conserva el packshot real estático y completo al refrescar', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Deliver actual browser frames with the timestamps of an 80ms renderer.
  // This exercises the production budget probe without disabling the guard.
  await page.addInitScript(() => {
    const nativeFrame = window.requestAnimationFrame.bind(window);
    let timestamp = 0;
    window.requestAnimationFrame = (callback) => nativeFrame(() => callback(timestamp += 80));
  });
  await page.goto('/scripts/campaign-lab/index.html?only=beer_pour&w=358');
  await page.bringToFront();
  const image = page.locator('[data-campaign-image]');
  await expect(image).toHaveAttribute('src', /campaign-heineken-710ml-thumbnail/);
  expect(await image.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics().budgetLimited)).toBe(true);
  await assertLiveOrBudgetStill(page, '[data-campaign]');
  const plays = (await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.TABA2_CAMPAIGNS.refresh();
  });
  await assertLiveOrBudgetStill(page, '[data-campaign]');
  expect((await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays).toBe(plays);
  expect(await image.evaluate((node) => getComputedStyle(node).objectFit)).toBe('contain');
});

test('ocultar un anuncio deja ese lugar sin anuncios: vuelve la puerta editorial, no otra campaña', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  await expect(page.locator(heroPiece)).toHaveAttribute('data-campaign', 'heineken-beer-pour');
  await page.locator(`${heroPiece} [data-campaign-dismiss]`).click();
  // Antes entraba la campaña siguiente —otra escena, arrancando de cero— debajo
  // del aviso «Ocultamos el anuncio».
  await expect(page.locator(`${HERO} [data-campaign]`)).toHaveCount(0);
  await expect(page.locator(`${HERO} .home-hero-promo`)).toBeVisible();
  await expect(page.locator('[data-toast]')).toContainText('Ocultamos el anuncio');
  // Los otros lugares siguen como estaban: ahí nadie ocultó nada.
  await expect(page.locator(`${INLINE} [data-campaign]`)).toHaveCount(1);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup', 'ready', { timeout: 20000 });
  await goHome(page);
  await expect(page.locator(`${HERO} [data-campaign]`)).toHaveCount(0);
});

test('la escena llena la banda que tiene, sin salirse de ella mientras sirve', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const piece = page.locator(heroPiece);
  await expect(piece).toHaveAttribute('data-motion-campaign-live', 'true');
  for (const size of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    const measured = await piece.evaluate((root) => {
      const band = root.getBoundingClientRect();
      const stage = root.querySelector('.cmp-stage').getBoundingClientRect();
      const legalNode = root.querySelector('.cmp-legal');
      const legal = legalNode?.getBoundingClientRect();
      // Con una letra de sistema ancha la leyenda parte en dos y la banda crece
      // ese renglón. Ese alto es de la leyenda, no de la escena: se descuenta
      // para que la proporción mida lo mismo en cualquier máquina. Con un solo
      // renglón el descuento es cero y la cuenta es la de siempre.
      const style = legalNode ? getComputedStyle(legalNode) : null;
      const oneLine = style ? parseFloat(style.lineHeight) + parseFloat(style.paddingBottom) : 0;
      const extraLegal = legal ? Math.max(0, legal.height - oneLine) : 0;
      return { band: band.height - extraLegal, stage: stage.height, top: stage.top - band.top, bottom: band.bottom - stage.bottom, legal: legal ? legal.height : 0 };
    });
    // Antes la escena medía el piso (`--cmp-h`) y no la banda: 65 px en 101.
    expect(measured.stage / measured.band, `${size.width}px: la escena quedó chica dentro de su banda`).toBeGreaterThan(0.72);
    expect(measured.top, `${size.width}px: la escena se sale por arriba`).toBeGreaterThanOrEqual(-0.5);
    expect(measured.bottom, `${size.width}px: la escena pisa la leyenda legal`).toBeGreaterThanOrEqual(measured.legal);
  }
  // Y el envase inclinado, que es lo que más sube, queda adentro en todo el servido.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const overflow = await piece.evaluate((root) => {
    const band = root.getBoundingClientRect();
    let worst = 0;
    for (const fraction of [0.24, 0.31, 0.45, 0.6, 0.68, 0.77]) {
      for (const animation of root.getAnimations({ subtree: true })) {
        const timing = animation.effect.getComputedTiming();
        if (timing.iterations === 1) { animation.pause(); animation.currentTime = Number(timing.duration) * fraction; }
      }
      const vessel = root.querySelector('.cmp-vessel').getBoundingClientRect();
      worst = Math.max(worst, band.top - vessel.top);
    }
    return worst;
  });
  expect(overflow, 'el envase se sale de la pieza al servir').toBeLessThanOrEqual(1);
});

test('tocar la pieza abre la ficha de SU producto y no toca el carrito', async ({ page }) => {
  await useQaCampaigns(page);
  await openRuntimeCatalog(page);
  await goHome(page);
  const cartBefore = await page.locator('[data-cart-count]').first().textContent();
  const hashBefore = await page.evaluate(() => window.location.hash);
  const hit = page.locator(`${heroPiece} [data-campaign-cta]`);
  // El nombre de la acción dice todo lo que la pieza muestra, precio incluido:
  // el de la tarjeta, porque sale de la misma función.
  await expect(hit).toHaveAccessibleName(/Bien fría, recién servida\. Heineken Lager · 710 ml · Lata\. \$\s2\.500\. Ver Heineken/);
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

/*
 * PROMO_PRODUCT_MATCHES_CATALOG
 *
 * La pieza no puede mostrar otro producto, otra marca, otra foto, otro precio
 * ni otro stock que los del catálogo vivo. Se comprueba contra la FUENTE —las
 * filas que sirve el backend— y contra las otras tres superficies que muestran
 * el mismo producto: la tarjeta, la ficha y el carrito. Cada ficha recibe un
 * precio distinto, así un precio copiado de otra ficha o escrito a mano no
 * puede coincidir por casualidad. Y cuando el dato cambia por Realtime, la
 * pieza cambia con la tarjeta —sin reiniciar la escena— o se va sola.
 */
test('PROMO_PRODUCT_MATCHES_CATALOG: cada pieza es su producto del catálogo —nombre, marca, foto, precio y stock— igual que la tarjeta, la ficha y el carrito', async ({ page }) => {
  test.setTimeout(90_000);
  await useQaCampaigns(page);
  const backend = await openRuntimeCatalog(page, { mapRow: (row, index) => ({ ...row, price: 1990 + index * 137 }) });
  const rowOf = (id) => backend.rows.find((row) => row.id === id);
  const money = (amount) => page.evaluate((value) => new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(value), amount);
  const readPiece = (selector) => page.locator(selector).evaluate((root) => ({
    campaign: root.dataset.campaign,
    productId: root.querySelector('[data-campaign-cta]').dataset.productDetail,
    brand: root.querySelector('.cmp-eyebrow')?.textContent.trim() ?? null,
    sub: root.querySelector('.cmp-sub')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    price: root.querySelector('.cmp-price-now')?.textContent ?? null,
    previous: root.querySelector('.cmp-price-was')?.textContent ?? null,
    image: root.querySelector('img.cmp-packshot')?.getAttribute('src') ?? null,
    srcset: root.querySelector('img.cmp-packshot')?.getAttribute('srcset') ?? '',
    fallback: Boolean(root.querySelector('.cmp-actor--fallback')),
    label: root.querySelector('[data-campaign-cta]').getAttribute('aria-label'),
  }));
  const readCard = (id) => page.locator(`${GRID} [data-card-product="${id}"]`).evaluate((card) => ({
    title: card.querySelector('.product-name-link').textContent.trim(),
    presentation: card.querySelector('.product-body > p').textContent.trim(),
    price: card.querySelector('.price-amounts strong')?.textContent ?? null,
    image: card.querySelector('img.thumb-img').getAttribute('src'),
    // «Agregar», o el selector de cantidad cuando ya está en el carrito.
    orderable: !card.classList.contains('out-of-stock')
      && Boolean(card.querySelector('[data-add-product]:not([disabled]), [data-cart-inc]:not([disabled])')),
  }));
  const matchesCatalog = async (selector) => {
    const piece = await readPiece(selector);
    const row = rowOf(piece.productId);
    expect(row, `${piece.campaign}: el producto de la pieza no está en el catálogo`).toBeTruthy();
    expect(row.stock > 0 && row.available === true && row.price_status === 'confirmed' && row.price > 0,
      `${piece.campaign}: la pieza muestra un producto que no se puede comprar`).toBe(true);
    const card = await readCard(piece.productId);
    expect(card.orderable, `${piece.campaign}: la tarjeta del mismo producto no se puede comprar`).toBe(true);
    expect(piece.brand, `${piece.campaign}: la marca no es la del producto`).toBe(row.brand);
    expect(piece.sub, `${piece.campaign}: nombre o presentación distintos de la tarjeta`).toBe(`${card.title} · ${card.presentation}`);
    expect(piece.price, `${piece.campaign}: el precio no es el del catálogo`).toBe(await money(row.price));
    expect(piece.price, `${piece.campaign}: el precio no es el de la tarjeta`).toBe(card.price);
    expect(piece.previous, `${piece.campaign}: un tachado sin promoción validada`).toBeNull();
    expect(piece.label).toContain(piece.price);
    expect(piece.fallback, `${piece.campaign}: la pieza no usa la foto aprobada`).toBe(false);
    expect(piece.image, `${piece.campaign}: la foto no es la de la tarjeta`).toBe(card.image);
    // La miniatura y el original aprobados de ESA ficha, por su huella.
    expect(piece.image).toContain(row.image_thumbnail_sha256);
    expect(piece.srcset).toContain(row.image_sha256);
    return { piece, row, card };
  };

  // Catálogo: la pieza de la grilla.
  await expect(page.locator(`${GRID} [data-campaign]`)).toHaveCount(1);
  const grid = await matchesCatalog(`${GRID} [data-campaign]`);
  expect(grid.row.sku).toBe('red-bull-energy-drink-355ml');

  // Home: la banda de apertura y la franja intermedia.
  await goHome(page);
  const hero = await matchesCatalog(heroPiece);
  expect(hero.row.sku).toBe('heineken-710ml');
  const inline = await matchesCatalog(`${INLINE} [data-campaign]`);
  expect(inline.row.sku).toBe('red-bull-energy-drink-355ml');

  // La ficha que abre la pieza cobra lo mismo, y el carrito también.
  await page.locator(`${heroPiece} [data-campaign-cta]`).click();
  const modal = page.locator('[data-product-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.modal-price strong')).toHaveText(hero.piece.price);
  await modal.locator('.modal-cart-control[data-add-product]').click();
  await expect(modal).toBeHidden();
  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
  const line = page.locator('.cart-item', { hasText: hero.card.title });
  await expect(line).toHaveCount(1);
  await expect(line.locator('.cart-line')).toHaveText(hero.piece.price);
  await goHome(page);

  // El precio cambia en el catálogo: la pieza lo sigue con la tarjeta, en el
  // MISMO nodo y sin volver a empezar la escena.
  await page.evaluate(() => { window.__heroPiece = document.querySelector('[data-home-hero-promo] [data-campaign]'); });
  const plays = (await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays;
  const heineken = backend.rows.find((row) => row.sku === 'heineken-710ml');
  heineken.price += 310;
  backend.emit();
  const repriced = await money(heineken.price);
  await expect(page.locator(`${heroPiece} .cmp-price-now`)).toHaveText(repriced, { timeout: 10000 });
  await expect(page.locator(`${GRID} [data-card-product="${heineken.id}"] .price-amounts strong`)).toHaveText(repriced);
  await matchesCatalog(heroPiece);
  expect(await page.evaluate(() => window.__heroPiece === document.querySelector('[data-home-hero-promo] [data-campaign]')),
    'un precio nuevo reemplazó la pieza').toBe(true);
  expect((await page.evaluate(() => window.TABA2_CAMPAIGNS.getDiagnostics())).plays, 'un precio nuevo reinició la escena').toBe(plays);

  // Sin stock la pieza se va sola: nunca se anuncia lo que no se puede comprar.
  // La banda la toma la siguiente campaña válida —Aperol, que se puede
  // comprar— y esa también es su producto del catálogo.
  heineken.stock = 0;
  heineken.available = false;
  backend.emit();
  await expect(page.locator('[data-campaign="heineken-beer-pour"]')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(heroPiece)).toHaveAttribute('data-campaign', 'aperol-ice-reveal');
  expect((await matchesCatalog(heroPiece)).row.sku).toBe('aperol-750ml');
  // Y sin ninguna campaña comprable vuelve la puerta editorial de siempre.
  const aperol = backend.rows.find((row) => row.sku === 'aperol-750ml');
  aperol.stock = 0;
  aperol.available = false;
  backend.emit();
  await expect(page.locator(heroPiece)).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(`${HERO} .home-hero-promo`)).toBeVisible();
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
  await expect(filters).toBeHidden();
  await filters.locator('[data-catalog-filter="alcohol"]').selectOption('without', { force: true });
  await expect(gridPiece).toHaveCount(0);
  await filters.locator('[data-reset-catalog-filters]').evaluate(node => node.click());
  await filters.locator('[data-close-catalog-filters]').evaluate(node => node.click());
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
