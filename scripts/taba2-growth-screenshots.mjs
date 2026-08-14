/*
 * Capturas del growth engine para revisión visual.
 *
 * Estados: Persona A (cold start), Persona B (fan de la cerveza) y la pieza
 * inline del catálogo, en teléfono (390) y escritorio (1280), Chromium y
 * WebKit 390. Las personas se siembran con el harness real (?growthDebug=1),
 * no con estado fabricado a mano.
 *
 * Las imágenes NO se versionan; se regeneran con este script.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8231 &
 *   node scripts/taba2-growth-screenshots.mjs
 *
 * Salida: artifacts/growth-engine/
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const ROOT = path.resolve('artifacts/growth-engine');
const notes = [];

async function shot(page, dir, name) {
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

async function ready(page) {
  await page.waitForSelector('html[data-taba-startup="ready"]', { timeout: 20000 });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
  await page.waitForTimeout(700);
}

for (const engine of ['chromium', 'webkit']) {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();
  const widths = engine === 'webkit' ? [390] : [390, 1280];
  for (const width of widths) {
    const tag = width === 1280 ? 'desktop' : String(width);
    const out = path.join(ROOT, engine, tag);
    mkdirSync(out, { recursive: true });
    const context = await browser.newContext({
      viewport: { width, height: width === 1280 ? 900 : 844 },
      deviceScaleFactor: 2,
      locale: 'es-AR',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => notes.push(`[${engine} ${tag}] pageerror: ${error.message}`));

    // ── Persona A: cold start ────────────────────────────────────────────────
    await page.goto(`${BASE}/?reset=1&demo=1&growthDebug=1`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await shot(page, out, '01-persona-a-home');

    // ── Persona B: fan de la cerveza ─────────────────────────────────────────
    await page.evaluate(() => window.TABA2_GROWTH.persona('B'));
    await page.waitForTimeout(500);
    await shot(page, out, '02-persona-b-home');

    // La pieza inline en el catálogo de OTRA categoría (energizantes).
    await page.locator('[data-home-category-strip] [data-category-id="energizantes"]').click();
    await page.waitForSelector('[data-product-grid] .growth-inline-card', { timeout: 10000 })
      .catch(() => notes.push(`[${engine} ${tag}] la pieza inline no apareció`));
    await page.locator('[data-product-grid] .growth-inline-card').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, out, '03-persona-b-catalogo-inline');

    // El detalle del combo que abre la pieza (superficie honesta existente).
    await page.locator('[data-product-grid] .growth-inline-card').click().catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, out, '04-combo-desde-inline');
    await page.keyboard.press('Escape');

    // ── Persona E: energizantes (contraste sin alcohol) ─────────────────────
    await page.locator('[data-nav-view="home"] >> visible=true').first().click();
    await page.evaluate(() => window.TABA2_GROWTH.persona('E'));
    await page.waitForTimeout(500);
    await shot(page, out, '04b-persona-e-home');

    // ── Carrito con un producto (cross-sell existente, sin regresión) ───────
    await page.locator('[data-home-category-strip] [data-category-id="cervezas"]').click();
    await page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first().click();
    await page.waitForTimeout(300);
    await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
    await page.waitForTimeout(600);
    await shot(page, out, '05-carrito');

    await context.close();
  }
  await browser.close();
}

if (notes.length) {
  console.log('NOTAS:');
  for (const note of notes) console.log(` - ${note}`);
} else {
  console.log('Capturas limpias, sin errores de página.');
}
console.log(`Salida: ${ROOT}`);
