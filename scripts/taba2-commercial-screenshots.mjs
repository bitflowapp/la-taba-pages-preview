/*
 * Capturas de entrega del storefront comercial.
 *
 * Un archivo por vista y por ancho (320, 375, 390, 414, 432 y escritorio), más
 * el recorrido de combos, la ficha de producto con y sin precio, los cinco
 * estados del retorno de Mercado Pago y dos dispositivos reales: iPhone 13 por
 * WebKit y Pixel 7 por Chromium.
 *
 * Las imágenes NO se versionan —son 28 MB y el repo ya excluye las carpetas de
 * artefactos—; se regeneran con este script, que es lo que sí se versiona.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8231 &
 *   node scripts/taba2-commercial-screenshots.mjs
 *
 * Salida: artifacts/taba2-commercial-audit/final/
 */
import { chromium, devices, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const ROOT = path.resolve('artifacts/taba2-commercial-audit/final');
const WIDTHS = [320, 375, 390, 414, 432, 1280];
const HEIGHTS = { 320: 720, 375: 812, 390: 844, 414: 896, 432: 960, 1280: 900 };

const notes = [];

for (const engine of ['chromium', 'webkit']) {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();
  const widths = engine === 'webkit' ? [320, 390, 432] : WIDTHS;

  for (const w of widths) {
    const tag = w === 1280 ? 'desktop' : String(w);
    const out = path.join(ROOT, engine, tag);
    mkdirSync(out, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: w, height: HEIGHTS[w] || 900 },
      deviceScaleFactor: 2,
      locale: 'es-AR',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => notes.push(`[${engine} ${tag}] pageerror: ${e.message}`));

    await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
    await page.waitForTimeout(900);

    await shot(page, out, '01-home');
    await scrollTo(page, '[data-home-combos-section]');
    await shot(page, out, '02-home-combos');

    await page.locator('[data-combo-detail]').first().click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, out, '03-combo-detalle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await hash(page, 'catalog');
    await shot(page, out, '04-catalogo');

    const search = page.locator('[data-view="catalog"] [data-search-input]').first();
    await search.fill('imperial').catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, out, '05-busqueda');
    await search.fill('zzzz').catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, out, '06-busqueda-vacia');
    await search.fill('').catch(() => {});
    await page.waitForTimeout(400);

    await page.locator('[data-catalog-filters] summary').first().click().catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, out, '07-filtros');
    await page.locator('[data-close-catalog-filters]').first().click().catch(() => {});
    await page.waitForTimeout(400);

    await page.locator('[data-product-grid] [data-product-detail]').first().click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, out, '08-producto');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Producto sin precio publicado
    await search.fill('sprite').catch(() => {});
    await page.waitForTimeout(600);
    const pend = page.locator('[data-product-grid] .product-card')
      .filter({ has: page.locator('[data-add-product][disabled]') }).first();
    await pend.locator('[data-product-detail]').first().click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, out, '09-producto-sin-precio');
    await page.keyboard.press('Escape');
    await search.fill('').catch(() => {});
    await page.waitForTimeout(400);

    await hash(page, 'cart');
    await shot(page, out, '10-carrito-vacio');

    await hash(page, 'catalog');
    // La búsqueda tiene que quedar realmente vacía antes de agregar: si el
    // filtro anterior sobrevive, la grilla sólo muestra productos sin precio,
    // no hay ningún botón habilitado y el carrito se captura vacío. Pasó.
    await search.fill('');
    await page.waitForTimeout(700);
    const adds = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
    await adds.first().waitFor({ state: 'visible', timeout: 10000 });
    const total = Math.min(await adds.count(), 3);
    if (total === 0) notes.push(`[${engine} ${tag}] no se pudo sembrar el carrito`);
    for (let i = 0; i < total; i += 1) {
      await adds.nth(i).click({ timeout: 8000 });
      await page.waitForTimeout(320);
    }
    await hash(page, 'cart');
    await shot(page, out, '11-carrito');
    await scrollTo(page, '[data-checkout-form]');
    await shot(page, out, '12-checkout');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await shot(page, out, '13-checkout-total');

    await hash(page, 'profile');
    await shot(page, out, '14-perfil');
    await hash(page, 'tracking');
    await page.waitForTimeout(800);
    await shot(page, out, '15-seguimiento');

    await context.close();
  }

  // Retornos de pago, los cinco estados.
  const out = path.join(ROOT, engine, 'pago');
  mkdirSync(out, { recursive: true });
  for (const [state, title, detail, status] of [
    ['verifying', 'Verificando el pago', 'Verificando el pago', ''],
    ['completed', 'Pedido confirmado', 'Pago acreditado por Mercado Pago.', 'Pedido TABA-4821'],
    ['pending', 'Pago pendiente', 'Mercado Pago todavía no confirmó la acreditación.', 'Seguiremos escuchando la confirmación de Mercado Pago.'],
    ['manual_review', 'Necesitamos revisar este pago', 'No podemos verificar este pago desde este despliegue.', 'El negocio revisará el pago antes de preparar cualquier pedido.'],
    ['rejected', 'Pago rechazado', 'Mercado Pago rechazó el pago. No se generó ningún pedido.', ''],
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(`${BASE}/pago/resultado/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(([s, t, d, st]) => {
      document.querySelector('[data-payment-return-title]').textContent = t;
      document.querySelector('[data-payment-return-detail]').textContent = d;
      const node = document.querySelector('[data-payment-return-status]');
      node.dataset.state = s;
      node.textContent = st;
      document.querySelector('[data-payment-return-action]').textContent = s === 'completed' ? 'Ver seguimiento' : 'Volver al carrito';
    }, [state, title, detail, status]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `pago-${state}.png`) });
    await context.close();
  }

  await browser.close();
}

// Dispositivos reales: un iPhone por WebKit y un Android por Chromium.
for (const [name, device, engine] of [
  ['iphone-13', devices['iPhone 13'], webkit],
  ['pixel-7', devices['Pixel 7'], chromium],
]) {
  const browser = await engine.launch();
  const out = path.join(ROOT, 'dispositivos');
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({ ...device, locale: 'es-AR', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => notes.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, `${name}-home.png`) });
  await scrollTo(page, '[data-home-combos-section]');
  await page.screenshot({ path: path.join(out, `${name}-combos.png`) });
  await hash(page, 'catalog');
  await page.screenshot({ path: path.join(out, `${name}-catalogo.png`) });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  notes.push(`[${name}] overflow horizontal: ${over}px`);
  await context.close();
  await browser.close();
}

console.log(notes.length ? notes.join('\n') : 'sin incidencias');

async function shot(page, out, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
async function hash(page, view) {
  await page.evaluate((v) => { window.location.hash = `#${v}`; }, view);
  await page.waitForTimeout(800);
}
async function scrollTo(page, selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
}
