/* Capturas baseline del estado actual, para evaluación visual. */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8247';
const ROOT = process.env.OUT || path.resolve('baseline');
const WIDTHS = [390, 1280];
const HEIGHTS = { 320: 720, 390: 844, 1280: 900 };

const browser = await chromium.launch();
for (const w of WIDTHS) {
  const tag = w === 1280 ? 'desktop' : String(w);
  const out = path.join(ROOT, tag);
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: w, height: HEIGHTS[w] || 900 },
    deviceScaleFactor: 2,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${tag}] pageerror: ${e.message}`));

  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
  await page.waitForTimeout(900);

  await shot(page, out, '01-home-top');
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  await page.waitForTimeout(400);
  await shot(page, out, '01b-home-scroll1');
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  await page.waitForTimeout(400);
  await shot(page, out, '01c-home-scroll2');
  await scrollTo(page, '[data-home-combos-section]');
  await shot(page, out, '02-home-combos');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, out, '02b-home-bottom');

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

  await page.locator('[data-product-grid] [data-product-detail]').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, out, '08-producto');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await hash(page, 'cart');
  await shot(page, out, '10-carrito-vacio');

  await hash(page, 'catalog');
  await search.fill('');
  await page.waitForTimeout(700);
  const adds = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
  await adds.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const total = Math.min(await adds.count(), 3);
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
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, out, '14b-perfil-bottom');
  await hash(page, 'tracking');
  await page.waitForTimeout(800);
  await shot(page, out, '15-seguimiento');

  await context.close();
}
await browser.close();
console.log('baseline listo');

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
