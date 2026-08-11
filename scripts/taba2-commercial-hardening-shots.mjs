/*
 * Capturas BEFORE/AFTER del endurecimiento comercial del storefront TABA2.
 *
 * Diecisiete estados por ancho, en los cuatro anchos que concentran el parque
 * real de teléfonos: 320 (el más angosto que seguimos soportando), 360, 390 y
 * 432. Son los mismos estados en las dos corridas, con el mismo recorrido y el
 * mismo orden, para que la comparación sea de pixeles y no de memoria.
 *
 * Dos estados no existían en el set anterior y son los que motivan este trabajo:
 * el carrito DESPUÉS de recargar, y la pantalla que ve una persona cuando el
 * módulo de la aplicación no baja. Un tercero, la ruta inexistente, tampoco
 * estaba: caía al inicio sin decir nada.
 *
 * Las imágenes no se versionan (artifacts/taba2-commercial-audit/ está en
 * .gitignore); lo que se versiona es este recorrido.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8231 &
 *   OUT=artifacts/taba2-commercial-audit/before node scripts/taba2-commercial-hardening-shots.mjs
 *   OUT=artifacts/taba2-commercial-audit/after  node scripts/taba2-commercial-hardening-shots.mjs
 *
 * Variables: BASE, OUT, WIDTHS, ENGINE (chromium|webkit).
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const ROOT = path.resolve(process.env.OUT || 'artifacts/taba2-commercial-audit/shots');
const WIDTHS = (process.env.WIDTHS || '320,360,390,432').split(',').map(Number);
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium;
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const HEIGHTS = { 320: 720, 360: 800, 375: 812, 390: 844, 414: 896, 432: 960 };

const notes = [];
const browser = await ENGINE.launch();

for (const width of WIDTHS) {
  const out = path.join(ROOT, ENGINE_NAME, String(width));
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] || 844 },
    deviceScaleFactor: 2,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => notes.push(`[${width}] pageerror: ${error.message}`));

  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  // El instante que motiva medio trabajo: ¿el shell servido muestra el cartel
  // de error antes de que la aplicación pinte? Se mira ANTES de esperar nada.
  notes.push(`[${width}] cartel de arranque visible en una carga normal: ${await page.locator('[data-app-recovery]').isVisible().catch(() => 'n/d')}`);
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25_000 });
  await page.waitForTimeout(900);

  await shot(page, out, width, '01-home');
  await scrollTo(page, '[data-home-combos-section]');
  await shot(page, out, width, '02-home-combos');

  await hash(page, 'catalog');
  await shot(page, out, width, '03-catalogo');

  const search = page.locator('[data-view="catalog"] [data-search-input]').first();
  await search.fill('imperial').catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, out, width, '04-busqueda');
  await search.fill('zzzzzz').catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, out, width, '05-busqueda-vacia');
  await search.fill('').catch(() => {});
  await page.waitForTimeout(500);

  await page.locator('[data-catalog-filters] summary').first().click().catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, out, width, '06-filtros');
  await page.locator('[data-close-catalog-filters]').first().click().catch(() => {});
  await page.waitForTimeout(400);

  await page.locator('[data-product-grid] [data-product-detail]').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, out, width, '07-producto');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await search.fill('sprite').catch(() => {});
  await page.waitForTimeout(700);
  const sinPrecio = page.locator('[data-product-grid] .product-card')
    .filter({ has: page.locator('[data-add-product][disabled]') }).first();
  await sinPrecio.locator('[data-product-detail]').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, out, width, '08-producto-sin-precio');
  await page.keyboard.press('Escape');
  await search.fill('').catch(() => {});
  await page.waitForTimeout(500);

  await hash(page, 'cart');
  await shot(page, out, width, '09-carrito-vacio');

  await hash(page, 'catalog');
  await search.fill('');
  await page.waitForTimeout(700);
  const adds = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
  await adds.first().waitFor({ state: 'visible', timeout: 12_000 });
  const total = Math.min(await adds.count(), 3);
  if (!total) notes.push(`[${width}] no se pudo sembrar el carrito`);
  for (let index = 0; index < total; index += 1) {
    await adds.nth(index).click({ timeout: 8000 });
    await page.waitForTimeout(320);
  }
  await hash(page, 'cart');
  await shot(page, out, width, '10-carrito');

  // El estado que motiva el P1: el carrito DESPUÉS de recargar la pestaña.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await hash(page, 'cart');
  const lineasTrasRecarga = await page.locator('[data-cart-list] [data-cart-line], [data-cart-list] .cart-line').count();
  notes.push(`[${width}] líneas de carrito tras recargar: ${lineasTrasRecarga}`);
  await shot(page, out, width, '11-carrito-tras-recargar');

  await scrollTo(page, '[data-checkout-form]');
  await shot(page, out, width, '12-checkout');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await shot(page, out, width, '13-checkout-total');

  await hash(page, 'profile');
  await shot(page, out, width, '14-perfil');
  await page.locator('[data-profile-action="add-address"]').first().click().catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, out, width, '15-perfil-editor');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Ruta inexistente: hoy cae al inicio sin explicar nada.
  await hash(page, 'no-existe-esta-vista');
  await page.waitForTimeout(900);
  notes.push(`[${width}] hash tras ruta inválida: ${await page.evaluate(() => window.location.hash)}`);
  await shot(page, out, width, '16-ruta-invalida');

  notes.push(`[${width}] overflow horizontal: ${await overflow(page)}px`);
  await context.close();

  // El módulo de la aplicación no baja. Es la única pantalla que puede quedar
  // entre el cliente y la tienda, y es la que exponía el código interno.
  const brokenContext = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] || 844 },
    deviceScaleFactor: 2,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const brokenPage = await brokenContext.newPage();
  await brokenPage.route('**/js/app.js*', (route) => route.fulfill({
    status: 503,
    contentType: 'text/javascript',
    body: '/* no disponible: captura del arranque fallido */',
  }));
  await brokenPage.goto(`${BASE}/?demo=1#home`, { waitUntil: 'domcontentloaded' });
  await brokenPage.waitForTimeout(9000);
  const textoVisible = await brokenPage.locator('[data-app-recovery]').innerText().catch(() => '');
  notes.push(`[${width}] arranque fallido dice: ${textoVisible.replace(/\s+/g, ' ').trim()}`);
  await shot(brokenPage, out, width, '17-arranque-fallido');
  await brokenContext.close();

  /*
   * El módulo TARDA, no falla. Es el caso de todos los días —red de barrio, 3G,
   * el teléfono viejo— y en loopback no existe: acá se reproduce demorando la
   * respuesta de `app.js` tres segundos y mirando la pantalla al segundo y
   * medio. Lo que se ve ahí es la primera impresión de la tienda.
   */
  const slowContext = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] || 844 },
    deviceScaleFactor: 2,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const slowPage = await slowContext.newPage();
  await slowPage.route('**/js/app.js*', async (route) => {
    await new Promise((resolve) => { setTimeout(resolve, 3000); });
    await route.continue();
  });
  await slowPage.goto(`${BASE}/?demo=1#home`, { waitUntil: 'commit' });
  await slowPage.waitForTimeout(1500);
  const carteEnEspera = await slowPage.locator('[data-app-recovery]').isVisible().catch(() => 'n/d');
  notes.push(`[${width}] con el módulo demorado 3s, a los 1,5s el cartel de error está visible: ${carteEnEspera}`);
  await shot(slowPage, out, width, '18-arranque-lento');
  await slowContext.close();
}

await browser.close();

mkdirSync(ROOT, { recursive: true });
writeFileSync(path.join(ROOT, `notas-${ENGINE_NAME}.txt`), `${notes.join('\n')}\n`, 'utf8');
console.log(notes.join('\n'));

async function shot(page, out, width, name) {
  await page.screenshot({ path: path.join(out, `${name}-${width}.png`) });
}
async function hash(page, view) {
  await page.evaluate((value) => { window.location.hash = `#${value}`; }, view);
  await page.waitForTimeout(800);
}
async function scrollTo(page, selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
}
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
