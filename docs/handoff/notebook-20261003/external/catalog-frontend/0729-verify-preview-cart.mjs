/**
 * Comprobación acotada de lo que el arnés largo no llegó a cerrar: que en el
 * preview publicado se puede AGREGAR AL CARRITO y que el contador y la barra
 * responden. Sin service worker (no es lo que se mide acá) y con plazos cortos,
 * para que un cuelgue se note como cuelgue y no como espera.
 *
 * Uso: node scripts/verify-preview-cart.mjs <url>
 */
import { webkit } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!BASE.startsWith('http')) {
  console.error('Falta la URL.');
  process.exit(2);
}
const OUT = path.resolve('artifacts/taba2-catalog-visual-polish/preview-qa');
mkdirSync(OUT, { recursive: true });

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'es-AR',
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
});
context.setDefaultTimeout(15_000);
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e.message)));
page.on('response', (r) => { if (r.status() >= 400) errores.push(`${r.status()} ${r.url()}`); });

try {
  await page.goto(`${BASE}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await page.waitForSelector('[data-product-grid] .product-card', { timeout: 30_000 });
  await page.waitForTimeout(600);

  const antes = (await page.locator('[data-cart-count]').first().innerText()).trim();
  const cta = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
  const nombre = await page.locator('[data-product-grid] .product-body h3').first().innerText();
  await cta.click();
  await page.waitForTimeout(1200);
  const despues = (await page.locator('[data-cart-count]').first().innerText()).trim();

  const barra = await page.evaluate(() => {
    const b = document.querySelector('.floating-cart');
    return b && b.offsetParent !== null ? b.innerText.replace(/\s+/g, ' ').trim() : null;
  });

  const stepper = await page.evaluate(() => {
    const s = document.querySelector('[data-product-grid] .qty-stepper');
    if (!s) return null;
    return { radio: getComputedStyle(s).borderRadius.split(' ')[0], texto: s.innerText.replace(/\s+/g, ' ').trim() };
  });

  console.log(`producto           : ${nombre.trim()}`);
  console.log(`contador carrito   : ${antes} -> ${despues}`);
  console.log(`barra de carrito   : ${barra ?? '(no visible)'}`);
  console.log(`stepper            : radio ${stepper?.radio}, "${stepper?.texto}"`);

  await page.locator('[data-open-cart]').first().click();
  await page.waitForTimeout(1200);
  const enCarrito = await page.locator('[data-view="cart"] .cart-item').count();
  console.log(`líneas en el carrito: ${enCarrito}`);
  await page.screenshot({ path: path.join(OUT, 'preview-carrito.png') });

  const ok = antes !== despues && enCarrito > 0;
  console.log(`\nerrores de página/red: ${errores.length}`);
  errores.slice(0, 8).forEach((e) => console.log(`  - ${e}`));
  console.log(ok ? '\nOK    el carrito suma y la línea llega al carrito' : '\nFALLA el carrito no respondió');
  process.exitCode = ok && errores.length === 0 ? 0 : 1;
} finally {
  await context.close();
  await browser.close();
}
