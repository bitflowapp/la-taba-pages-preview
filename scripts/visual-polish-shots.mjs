/**
 * Capturas comparables del catálogo del cliente, en el motor y el tamaño donde
 * se sacaron las fotos que motivaron el trabajo: WebKit a 390x844 (iPhone 13).
 *
 * No mide: fotografía. Se corre una vez antes de tocar CSS (`--label antes`) y
 * otra después (`--label despues`), y las dos tandas se miran una al lado de la
 * otra. Además reporta el desbordamiento horizontal de cada pantalla, que es lo
 * único que una captura no muestra.
 *
 * Uso:  node scripts/visual-polish-shots.mjs --label antes [--width 390]
 */
import { webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const label = readArg('--label', 'antes');
const width = Number(readArg('--width', '390'));
const height = Number(readArg('--height', '844'));
const port = Number(readArg('--port', '8193'));

const ROOT = path.resolve('.');
const OUT = path.resolve('artifacts/taba2-catalog-visual-polish', `${label}-${width}x${height}`);
mkdirSync(OUT, { recursive: true });

const BASE = `http://127.0.0.1:${port}`;
const report = [];
let server = null;
let browser = null;

try {
  server = await startServer();
  browser = await webkit.launch();
  await capture();
} finally {
  if (browser) await browser.close();
  await stopServer();
}

writeFileSync(
  path.join(OUT, 'REPORTE.md'),
  `# Capturas ${label} · ${width}x${height} · WebKit\n\n${report.map((line) => `- ${line}`).join('\n')}\n`,
);
console.log(`\nlisto: ${OUT}`);

async function capture() {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-view="home"] .taba-home-search', { timeout: 20_000 });
  // La primera pantalla necesita más margen que las demás: las secciones entran
  // con una animación de revelado y, a 320ms, media home todavía está en
  // `opacity: 0`. La captura salía casi vacía y no decía nada del diseño.
  await page.waitForTimeout(1200);
  await shot(page, '01-home-arriba.png');

  await page.evaluate(() => window.scrollBy(0, 520));
  await settle(page);
  await shot(page, '02-home-productos.png');

  await page.evaluate(() => window.scrollBy(0, 560));
  await settle(page);
  await shot(page, '03-home-combos.png');

  // Aviso de actualización: se dibuja igual que en producción, sólo que sin
  // esperar a que haya un worker en espera.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    const banner = document.querySelector('[data-app-update-banner]');
    if (banner) banner.hidden = false;
  });
  await settle(page);
  await shot(page, '04-aviso-actualizacion.png');
  await page.evaluate(() => {
    const banner = document.querySelector('[data-app-update-banner]');
    if (banner) banner.hidden = true;
  });

  // El aviso de conexión comparte la superficie y la grilla que corrige el de
  // actualización, así que se mira también: cambiar el `.pwa-banner` base sin
  // ver la otra variante es cambiar a ciegas.
  await page.evaluate(() => {
    const node = document.querySelector('[data-pwa-offline-banner]');
    if (node) node.hidden = false;
  });
  await settle(page);
  await shot(page, '04d-aviso-sin-conexion.png');
  await page.evaluate(() => {
    const node = document.querySelector('[data-pwa-offline-banner]');
    if (node) node.hidden = true;
  });

  // La invitación a instalar, en sus dos caras. Se abren a mano porque en un
  // navegador de escritorio o en WebKit no hay `beforeinstallprompt` que las
  // dispare, y lo que se está mirando acá es la HOJA, no la decisión de cuándo
  // mostrarla —eso lo miden los tests—.
  for (const [name, view] of [
    ['04b-instalar-android.png', 'android'],
    ['04c-instalar-ios.png', 'ios'],
    ['04e-instalar-ios-pasos.png', 'ios-steps'],
  ]) {
    await page.evaluate((cara) => {
      const sheet = document.querySelector('[data-install-sheet]');
      if (!sheet) return;
      for (const node of sheet.querySelectorAll('[data-install-view]')) {
        node.hidden = node.dataset.installView !== cara;
      }
      if (!sheet.open) sheet.showModal();
    }, view);
    await settle(page);
    await shot(page, name);
  }
  await page.evaluate(() => {
    const sheet = document.querySelector('[data-install-sheet]');
    if (sheet?.open) sheet.close();
  });

  await goCatalog(page);
  await shot(page, '05-catalogo-todas.png');

  await page.locator('[data-view="catalog"] [data-category-id]').filter({ hasText: /Gaseosa/i }).first().click();
  await settle(page);
  await shot(page, '06-catalogo-sin-precio.png');

  await page.locator('[data-catalog-filters] summary').first().click();
  await settle(page);
  await shot(page, '07-filtros-sheet.png');
  await page.keyboard.press('Escape');
  await page.locator('[data-catalog-filters] summary').first().click({ force: true }).catch(() => {});
  await settle(page);

  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  await settle(page);
  await shot(page, '08-catalogo-cervezas.png');

  await page.locator('[data-product-grid] [data-product-detail]').first().click();
  await settle(page);
  await shot(page, '09-ficha-producto.png');
  await page.keyboard.press('Escape');
  await settle(page);

  await page.evaluate(() => { window.location.hash = '#profile'; });
  await page.waitForTimeout(600);
  await settle(page);
  await shot(page, '10-perfil.png');

  await context.close();
}

async function goCatalog(page) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card', { timeout: 15_000 });
  await settle(page);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    widest: (() => {
      const limit = document.documentElement.clientWidth;
      let worst = '';
      let worstWidth = limit;
      document.querySelectorAll('body *').forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.right > worstWidth + 0.5) {
          worstWidth = rect.right;
          worst = `${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ')[0]}`;
        }
      });
      return worst ? `${worst} @ ${Math.round(worstWidth)}px` : 'ninguno';
    })(),
  }));
  report.push(`${name}: overflow ${metrics.overflow}px · elemento más ancho: ${metrics.widest}`);
  console.log(`  ${name} (overflow ${metrics.overflow}px)`);
}

async function settle(page) {
  await page.waitForTimeout(320);
}

async function startServer() {
  const child = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return child;
    } catch (_) {
      // sigue arrancando
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`No arrancó el servidor local en ${BASE}.`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
}

function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return fallback;
  return args[index + 1];
}
