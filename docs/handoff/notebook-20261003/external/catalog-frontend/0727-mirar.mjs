// Vistazo rapido a una vista, para iterar sin correr la bateria entera.
//   TABA_REPO=... node mirar.mjs [vista] [ancho] [salida]
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.join(process.env.TABA_REPO, 'package.json'));
const { chromium } = req('@playwright/test');

const BASE = process.env.BASE || 'http://127.0.0.1:8642';
const vista = process.argv[2] || 'home';
const ancho = Number(process.argv[3] || 390);
const salida = process.argv[4] || `mirar-${vista}-${ancho}.png`;
const alto = Number(process.env.TABA_ALTO || (ancho === 320 ? 720 : ancho === 360 ? 800 : ancho === 432 ? 960 : 844));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: ancho, height: alto },
  deviceScaleFactor: 2,
  locale: 'es-AR',
  serviceWorkers: 'block',
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errores.push(`${r.status()} ${r.url().slice(-60)}`); });

await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);
if (vista.startsWith('buscar:')) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForTimeout(900);
  await page.locator('[data-view="catalog"] [data-search-input]').first().fill(vista.slice(7));
  await page.waitForTimeout(800);
} else if (vista === 'agregar') {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForTimeout(1000);
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(260);
} else if (vista !== 'home') {
  await page.evaluate((v) => { window.location.hash = `#${v}`; }, vista);
  await page.waitForTimeout(1000);
}

const m = await page.evaluate(({ alto }) => {
  const precios = [...document.querySelectorAll('.home-best-copy span, .offer-price span, .price strong, .home-product-price')]
    .filter((el) => /\$/.test(el.textContent || ''));
  const ctas = [...document.querySelectorAll('[data-add-product]')];
  const r = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
  const b = (el) => (el ? Math.round(el.getBoundingClientRect().bottom + window.scrollY) : null);
  const nav = document.querySelector('.mobile-nav');
  const navAlto = nav && getComputedStyle(nav).display !== 'none'
    ? Math.round(nav.getBoundingClientRect().height)
    : 0;
  return {
    pxPrimerPrecio: b(precios[0]),
    pxPrimeraCta: b(ctas[0]),
    pliegueUtil: Math.round(window.innerHeight - navAlto),
    altoDoc: Math.round(document.documentElement.scrollHeight),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, { alto });

await page.screenshot({ path: salida });
console.log(JSON.stringify(m));
if (errores.length) console.log('ERRORES: ' + errores.slice(0, 6).join(' | '));
await browser.close();
