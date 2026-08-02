import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const requestedBase = process.env.TABA2_QA_BASE_URL || '';
let BASE = requestedBase;
let captureServer = null;
const OUT = path.resolve('artifacts/taba2-design-review');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const report = [];

try {
  await prepareServer();
  await captureMobile();
  await captureDesktop();
} finally {
  await browser.close();
  await stopServer();
}

writeFileSync(path.join(OUT, 'SCREENSHOT_REPORT.md'), `# Capturas TABA2\n\n${report.map((line) => `- ${line}`).join('\n')}\n\nNo se generó promotions-active.png: el motor no tiene una promoción activa y verificable. promotions-empty.png documenta el estado honesto de Home cuando la sección de promociones se oculta; no contiene descuento, porcentaje, vigencia ni precio anterior.\n`);

async function captureMobile() {
  const { page, context } = await pageFor(390, 844);
  await fresh(page);
  await shot(page, 'mobile-home-390x844.png');
  await shot(page, 'promotions-empty.png');

  await catalog(page);
  await page.locator('[data-view="catalog"] [data-search-input]').fill('coca cola 1,5 l');
  await pause(page);
  await shot(page, 'mobile-search-390x844.png');

  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  await pause(page);
  await shot(page, 'mobile-category-390x844.png');

  await page.locator('[data-product-grid] [data-product-detail]').first().click();
  await pause(page);
  await shot(page, 'mobile-product-priced-390x844.png');
  await page.keyboard.press('Escape');

  await catalog(page);
  await page.locator('[data-view="catalog"] [data-category-id="all"]').click();
  await page.locator('[data-view="catalog"] [data-search-input]').fill('red bull');
  await pause(page);
  await page.locator('[data-product-detail="red-bull-original-lata-250ml-pack-4"]').click();
  await pause(page);
  await shot(page, 'mobile-product-pending-390x844.png');
  await page.keyboard.press('Escape');

  await catalog(page);
  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').nth(0).click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').nth(1).click();
  await page.locator('[data-open-cart]').first().click();
  await pause(page);
  await shot(page, 'mobile-cart-390x844.png');
  await page.locator('[data-checkout-form]').scrollIntoViewIfNeeded();
  await shot(page, 'mobile-checkout-390x844.png');
  await context.close();
}

async function prepareServer() {
  if (requestedBase) return;
  const port = 8191;
  BASE = `http://127.0.0.1:${port}`;
  captureServer = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch (_) {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await stopServer();
  throw new Error(`No se pudo iniciar el servidor local de capturas en ${BASE}.`);
}

async function stopServer() {
  if (!captureServer || captureServer.exitCode !== null) return;
  captureServer.kill();
  await new Promise((resolve) => captureServer.once('exit', resolve));
}

async function captureDesktop() {
  const { page, context } = await pageFor(1440, 900);
  await fresh(page);
  await shot(page, 'desktop-home-1440x900.png');

  await catalog(page);
  await page.locator('[data-view="catalog"] [data-search-input]').fill('sprite 1,5 l');
  await pause(page);
  await shot(page, 'desktop-search-1440x900.png');

  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.locator('[data-catalog-filters]').evaluate((panel) => { panel.open = true; });
  await page.locator('[data-catalog-filter="price"]').selectOption('pending');
  await pause(page);
  await shot(page, 'catalog-pending-prices.png');

  await page.locator('[data-catalog-filter="price"]').selectOption('all');
  await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  await pause(page);
  await shot(page, 'desktop-category-1440x900.png');
  await shot(page, 'catalog-contact-sheet.png', '[data-product-grid]');

  await page.locator('[data-product-grid] [data-product-detail]').first().click();
  await pause(page);
  await shot(page, 'desktop-product-1440x900.png');
  await page.keyboard.press('Escape');

  await catalog(page);
  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').nth(0).click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').nth(1).click();
  await page.locator('[data-open-cart]').first().click();
  await pause(page);
  await shot(page, 'desktop-cart-1440x900.png');
  await page.locator('[data-checkout-form]').scrollIntoViewIfNeeded();
  await shot(page, 'desktop-checkout-1440x900.png');
  await context.close();
}

async function pageFor(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  return { page, context };
}

async function fresh(page) {
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('[data-view="home"] .taba-home-search', { timeout: 20_000 });
  await pause(page);
}

async function catalog(page) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card', { timeout: 15_000 });
  await pause(page);
}

async function shot(page, name, selector = '') {
  const destination = path.join(OUT, name);
  if (selector) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await element.screenshot({ path: destination });
  } else {
    await page.screenshot({ path: destination, fullPage: false });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.push(`${name}: overflow horizontal ${overflow}px`);
  console.log(`capturada ${name}`);
}

async function pause(page) {
  await page.waitForTimeout(220);
}
