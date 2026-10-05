/*
 * LAS CAMPAÑAS PUBLICADAS, CON EL CATÁLOGO VIVO, EN UN NAVEGADOR.
 *
 * No llama a `useQaCampaigns`: corre con la configuración que se publica, tal
 * cual está, contra las filas de `tests/fixtures/catalog-live.json` servidas con
 * su precio, stock y disponibilidad reales (51 productos; el alcohol sin
 * disponibilidad). Es lo que no se había mirado: el resto del E2E de campañas
 * ejerce el motor con el snapshot CP de pruebas.
 *
 * Además fija, con las campañas REALES en pantalla, la regresión de rotación:
 * 390×844 → 844×390 → 390×844 y 430×932 → 932×430 → 430×932, varias veces. En
 * cada vuelta la pieza sigue ahí, con su foto, su precio y su acción.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { clickCatalogCategory, GRID, openRuntimeCatalog } from './catalog-runtime-fixture.mjs';
import { HERO, INLINE } from './campaigns-fixture.mjs';

const live = JSON.parse(fs.readFileSync(new URL('../fixtures/catalog-live.json', import.meta.url), 'utf8'));
const heroPiece = `${HERO} [data-campaign]`;
const inlinePiece = `${INLINE} [data-campaign]`;

test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ timeout: 120_000 });

const rowBySku = (sku) => live.products.find((row) => row.sku === sku);
const money = (page, amount) => page.evaluate((value) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
}).format(value), amount);

const readPiece = (page, selector) => page.locator(selector).evaluate((root) => ({
  campaign: root.dataset.campaign,
  productId: root.querySelector('[data-campaign-cta]').dataset.productDetail,
  brand: root.querySelector('.cmp-eyebrow')?.textContent.trim() ?? null,
  sub: root.querySelector('.cmp-sub')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
  price: root.querySelector('.cmp-price-now')?.textContent ?? null,
  image: root.querySelector('img.cmp-packshot')?.getAttribute('src') ?? null,
  nw: root.querySelector('img.cmp-packshot')?.naturalWidth ?? 0,
  complete: root.querySelector('img.cmp-packshot')?.complete ?? false,
  fallback: Boolean(root.querySelector('.cmp-actor--fallback')),
  text: root.innerText.replace(/\s+/g, ' '),
}));

async function openHome(page) {
  const backend = await openRuntimeCatalog(page, { catalogRows: live.products, view: 'home', waitForCatalog: false });
  await expect(page.locator(heroPiece)).toBeVisible({ timeout: 20_000 });
  return backend;
}

test('la home muestra la banda (Red Bull 250 ml) y la franja (Coca-Cola 2,25 L) con producto, marca, foto y precio VIVOS', async ({ page }) => {
  await openHome(page);
  const cases = [
    { selector: heroPiece, campaign: 'red-bull-cold-can', sku: 'red-bull-original-250ml' },
    { selector: inlinePiece, campaign: 'coca-cola-product-drop', sku: 'coca-cola-original-2250ml' },
  ];
  for (const { selector, campaign, sku } of cases) {
    const row = rowBySku(sku);
    const piece = await readPiece(page, selector);
    expect(piece.campaign).toBe(campaign);
    expect(piece.productId, `${campaign}: no es el producto del catálogo`).toBe(row.id);
    expect(piece.brand).toBe(row.brand);
    expect(piece.price, `${campaign}: el precio no es el vivo`).toBe(await money(page, row.price));
    expect(piece.fallback, `${campaign}: cayó al envase dibujado en vez de la foto real`).toBe(false);
    // El archivo lleva la huella abreviada (16 hex) de la miniatura de ESA ficha.
    expect(piece.image).toContain(`-thumb-${row.image_thumbnail_sha256.slice(0, 16)}`);
    expect(piece.complete && piece.nw > 0, `${campaign}: la foto no cargó`).toBe(true);
    expect(piece.text).not.toMatch(/355/);
  }
  const redBull = await readPiece(page, heroPiece);
  expect(redBull.sub ?? redBull.text).toMatch(/250/);
});

test('la acción de cada pieza abre SU ficha y el precio de la ficha y del carrito es el de la pieza', async ({ page }) => {
  await openHome(page);
  for (const { selector, sku } of [
    { selector: heroPiece, sku: 'red-bull-original-250ml' },
    { selector: inlinePiece, sku: 'coca-cola-original-2250ml' },
  ]) {
    const row = rowBySku(sku);
    const piece = await readPiece(page, selector);
    await page.locator(`${selector} [data-campaign-cta]`).click();
    const modal = page.locator('[data-product-modal]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-price strong')).toHaveText(piece.price);
    await expect(modal).toContainText(row.brand);
    await modal.locator('.modal-cart-control[data-add-product]').click();
    await expect(modal).toBeHidden();
    await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
    await expect(page.locator('.cart-item', { hasText: row.name }).locator('.cart-line').first()).toHaveText(piece.price);
    await page.locator('.mobile-nav [data-nav-view="home"]:visible, .desktop-nav [data-nav-view="home"]:visible').first().click();
    await expect(page.locator(heroPiece)).toBeVisible();
  }
});

test('en el catálogo la grilla de «Todo» trae Aquarius y la de «Gaseosas» Coca-Cola; las listas cortas no llevan pieza', async ({ page }) => {
  await openRuntimeCatalog(page, { catalogRows: live.products });
  const pieza = page.locator(`${GRID} [data-campaign]`);
  // La pieza de grilla pide 8 productos o más: sólo «Todo» y «Gaseosas» lo cumplen.
  const casos = [
    [null, 'aquarius-ice-reveal', 'aquarius-pomelo-2250ml'],
    ['gaseosas', 'coca-cola-product-drop', 'coca-cola-original-2250ml'],
  ];
  for (const [categoria, campaign, sku] of casos) {
    if (categoria) await clickCatalogCategory(page, categoria);
    await expect(pieza, `rubro ${categoria ?? 'todo'}`).toHaveCount(1);
    await expect(pieza).toHaveAttribute('data-campaign', campaign);
    const row = rowBySku(sku);
    const leida = await readPiece(page, `${GRID} [data-campaign]`);
    expect(leida.productId).toBe(row.id);
    expect(leida.price).toBe(await money(page, row.price));
    expect(leida.complete && leida.nw > 0, `${campaign}: la foto no cargó`).toBe(true);
    expect(leida.fallback).toBe(false);
  }
  for (const categoria of ['energizantes', 'aguas-saborizadas']) {
    await clickCatalogCategory(page, categoria);
    await expect(pieza, `rubro corto ${categoria}`).toHaveCount(0);
  }
});

test('Heineken y Aperol no se muestran: no existen en el catálogo y el alcohol está cerrado', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('[data-campaign="heineken-beer-pour"], [data-campaign="aperol-ice-reveal"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Heineken|Aperol/);
});

/*
 * Rotación con las campañas reales: la pieza, su foto, su precio y su acción
 * sobreviven a vertical → horizontal → vertical, también en un teléfono grande.
 */
for (const [ancho, alto] of [[390, 844], [430, 932]]) {
  test(`rotación ${ancho}×${alto} → ${alto}×${ancho} → ${ancho}×${alto}: las campañas reales conservan foto, precio y acción`, async ({ page }) => {
    await openHome(page);
    const row = rowBySku('red-bull-original-250ml');
    const precio = await money(page, row.price);
    const antes = await page.evaluate(() => window.__rot = document.querySelector('[data-home-hero-promo] [data-campaign]') && true);
    expect(antes).toBe(true);
    for (let ciclo = 1; ciclo <= 5; ciclo++) {
      await page.setViewportSize({ width: alto, height: ancho });
      await expect(page.locator(heroPiece)).toBeVisible();
      await page.waitForTimeout(250);
      await page.setViewportSize({ width: ancho, height: alto });
      await expect(page.locator(heroPiece)).toBeVisible();
      await page.waitForTimeout(250);
      for (const selector of [heroPiece, inlinePiece]) {
        const pieza = await readPiece(page, selector);
        const donde = `ciclo ${ciclo} ${pieza.campaign}`;
        expect(pieza.complete && pieza.nw > 0, `${donde}: el packshot desapareció`).toBe(true);
        expect(pieza.fallback, `${donde}: cayó al envase dibujado`).toBe(false);
        expect(pieza.price, `${donde}: sin precio`).toBeTruthy();
        const caja = await page.locator(`${selector} img.cmp-packshot`).boundingBox();
        expect(caja && caja.width > 20 && caja.height > 20, `${donde}: el packshot quedó sin caja`).toBeTruthy();
      }
      expect((await readPiece(page, heroPiece)).price).toBe(precio);
      expect(await page.evaluate(() => window.__rot && document.querySelector('[data-home-hero-promo] [data-campaign]') != null),
        `ciclo ${ciclo}: la pieza se reemplazó`).toBe(true);
    }
    // La acción sigue funcionando después de rotar.
    await page.locator(`${heroPiece} [data-campaign-cta]`).click();
    const modal = page.locator('[data-product-modal]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-price strong')).toHaveText(precio);
  });
}
