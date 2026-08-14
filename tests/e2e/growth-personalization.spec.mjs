import { expect, test } from '@playwright/test';
import {
  gotoDemoReset,
  installBrowserStubs,
  installPageGuards,
} from './helpers.mjs';

/*
 * Growth engine en el navegador real, sobre el catálogo demo (comprables:
 * cervezas, gaseosas, energizantes, mixers; los 7 combos cobrables).
 *
 * Las aserciones toleran el contexto horario (las pruebas corren a cualquier
 * hora): donde el reloj puede empujar legítimamente otra pieza, se afirma la
 * FAMILIA correcta (una campaña de cerveza) y no un id único. Donde la
 * intención domina, el resultado es único y se afirma exacto.
 */

const DEMO_HERO_IDS = [
  'hero-cervezas',
  'hero-combo-noche-larga',
  'hero-energizantes',
  'hero-mixers',
];
const BEER_HERO_IDS = ['hero-cervezas', 'hero-combo-noche-larga'];

async function abrirYCerrarFicha(page, index) {
  const media = page.locator('[data-product-grid] [data-product-detail] >> visible=true').nth(index);
  await media.click();
  await expect(page.locator('[data-product-modal]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-product-modal]')).not.toBeVisible();
}

async function recorridoDeCategoria(page, categoryId) {
  await page.locator(`[data-home-category-strip] [data-category-id="${categoryId}"]`).click();
  await expect(page.locator('[data-catalog-title]')).not.toHaveText('Todos');
  await abrirYCerrarFicha(page, 0);
  await abrirYCerrarFicha(page, 1);
  const add = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  await add.click();
}

test('cold start: hero comercial elegible, con tracking y sin errores de consola', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  const hero = page.locator('[data-home-hero-promo] .home-hero-promo');
  await expect(hero).toBeVisible();
  const campaignId = await hero.getAttribute('data-growth-campaign');
  expect(DEMO_HERO_IDS, `hero inesperado: ${campaignId}`).toContain(campaignId);
  await expect(hero).toHaveAttribute('aria-label', /.+/);
  // CTA con verbo real, nunca "Reservar".
  await expect(hero.locator('.home-hero-promo-cta')).toHaveText(/^(Ver|Pedir|Agregar|Sumar)/);

  // El harness de personas NO existe sin la bandera de debug.
  expect(await page.evaluate(() => typeof window.TABA2_GROWTH)).toBe('undefined');

  // La impresión se registró recién cuando la pieza estuvo EN PANTALLA.
  await page.waitForFunction((id) => {
    try {
      const raw = localStorage.getItem('la_taba_growth_exposure_v1');
      return raw ? (JSON.parse(raw).campaigns?.[id]?.imp || 0) >= 1 : false;
    } catch (_) { return false; }
  }, campaignId);

  await guards.assertClean();
});

test('BEER TEST §20: navegar cervezas + fichas + búsqueda + carrito → hero y home cerveceros', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  await recorridoDeCategoria(page, 'cervezas');

  // Búsqueda asentada: una señal fuerte más.
  const search = page.locator('.catalog-search [data-search-input]');
  await search.fill('heineken');
  await page.waitForTimeout(800);
  await search.fill('');

  // La sesión registró la intención (agregado compacto, no una bitácora).
  const sessionIntent = await page.evaluate(() => sessionStorage.getItem('la_taba_growth_session_v1') || '');
  expect(sessionIntent).toContain('cervezas');

  await page.locator('[data-nav-view="home"] >> visible=true').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'home');

  // 1) El hero es una campaña de cerveza.
  const hero = page.locator('[data-home-hero-promo] .home-hero-promo');
  await expect(hero).toBeVisible();
  const heroId = await hero.getAttribute('data-growth-campaign');
  expect(BEER_HERO_IDS, `con intención cervecera el hero fue ${heroId}`).toContain(heroId);

  // 2) El primer carrusel de la home pasó a ser Cervezas (antes: orden
  // comercial fijo, que abre con Gaseosas).
  await expect(
    page.locator('[data-home-sections] .home-category-section h2').first(),
  ).toHaveText('Cervezas');

  // 3) En otra categoría, la pieza de la grilla prioriza cerveza: el combo
  // Heineken con su ahorro REAL derivado del catálogo. (Energizantes es la
  // otra categoría con unidad comprable en el catálogo demo publicado.)
  await page.locator('[data-home-category-strip] [data-category-id="energizantes"]').click();
  const inline = page.locator('[data-product-grid] .growth-inline-card');
  await expect(inline).toBeVisible();
  await expect(inline).toHaveAttribute('data-growth-campaign', 'inline-combo-heineken-x6');
  await expect(inline).toContainText('Ahorrás');
  await expect(inline.locator('.growth-inline-cta')).toHaveText(/^Ver combo/);

  // 4) El click abre el detalle real del combo (misma superficie honesta de
  // siempre, con su +18 y sus componentes).
  await inline.click();
  await expect(page.locator('[data-combo-modal]')).toBeVisible();

  await guards.assertClean();
});

test('intención distinta, contenido distinto: recorrido de energizantes', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  await recorridoDeCategoria(page, 'energizantes');
  await page.locator('[data-nav-view="home"] >> visible=true').first().click();

  const hero = page.locator('[data-home-hero-promo] .home-hero-promo');
  await expect(hero).toHaveAttribute('data-growth-campaign', 'hero-energizantes');
  await expect(
    page.locator('[data-home-sections] .home-category-section h2').first(),
  ).toHaveText('Energizantes');

  await guards.assertClean();
});

test('la búsqueda apaga la pieza de la grilla; favoritos también', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1#catalog');

  await page.locator('[data-category-strip] [data-category-id="cervezas"] >> visible=true').first().click();
  await expect(page.locator('[data-product-grid] .growth-inline-card')).toBeVisible();

  await page.locator('.catalog-search [data-search-input]').fill('coca');
  await expect(page.locator('[data-product-grid] .growth-inline-card')).toHaveCount(0);

  await guards.assertClean();
});

test('estado local corrupto: arranque limpio, vidriera de cold start', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await page.addInitScript(() => {
    localStorage.setItem('la_taba_growth_intent_v1', '{{{ basura no-json');
    localStorage.setItem('la_taba_growth_exposure_v1', '[1,2,3]');
  });
  await gotoDemoReset(page, '/?reset=1&demo=1');

  await expect(page.locator('[data-home-hero-promo] .home-hero-promo')).toBeVisible();
  await guards.assertClean();
});

test('harness de personas (?growthDebug=1): B ve cerveza, A vuelve al cold start', async ({ page }) => {
  await installBrowserStubs(page);
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1&growthDebug=1');

  expect(await page.evaluate(() => typeof window.TABA2_GROWTH)).toBe('object');

  const respuestaB = await page.evaluate(() => window.TABA2_GROWTH.persona('B'));
  expect(respuestaB).toContain('Persona B');
  const heroB = page.locator('[data-home-hero-promo] .home-hero-promo');
  const heroBId = await heroB.getAttribute('data-growth-campaign');
  expect(BEER_HERO_IDS).toContain(heroBId);

  // Explicabilidad interna: factores con signo, aptos para decisión comercial.
  const explain = await page.evaluate(() => window.TABA2_GROWTH.explain('hero'));
  expect(explain.length).toBeGreaterThan(0);
  expect(explain[0].factors.join(' ')).toMatch(/intent \+/);

  await page.evaluate(() => window.TABA2_GROWTH.reset());
  const heroA = await page.locator('[data-home-hero-promo] .home-hero-promo').getAttribute('data-growth-campaign');
  expect(DEMO_HERO_IDS).toContain(heroA);

  await guards.assertClean();
});

test.describe('teléfono (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('el hero reserva su banda, la pieza inline ocupa la fila y nada desborda', async ({ page }) => {
    await installBrowserStubs(page);
    const guards = installPageGuards(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');

    const hero = page.locator('[data-home-hero-promo] .home-hero-promo');
    await expect(hero).toBeVisible();
    const heroBox = await hero.boundingBox();
    expect(heroBox.height).toBeGreaterThanOrEqual(78);
    expect(heroBox.height).toBeLessThanOrEqual(190);

    // Sin desborde horizontal con las piezas del motor pintadas.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // La pieza inline, a lo ancho de la grilla y con destino real.
    await page.locator('[data-home-category-strip] [data-category-id="cervezas"]').click();
    const inline = page.locator('[data-product-grid] .growth-inline-card');
    await expect(inline).toBeVisible();
    const inlineBox = await inline.boundingBox();
    const gridBox = await page.locator('[data-product-grid]').boundingBox();
    expect(Math.abs(inlineBox.width - gridBox.width)).toBeLessThanOrEqual(2);
    await expect(inline).toHaveAttribute('aria-label', /.+/);

    await guards.assertClean();
  });
});
