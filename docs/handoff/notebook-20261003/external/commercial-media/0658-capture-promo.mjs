import { createRequire } from 'node:module';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const require = createRequire('C:/Users/marco/dev/la-taba-business-panel-automation/package.json');
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const ROOT = path.resolve('artifacts/taba2-commercial');
const RAW = path.join(ROOT, 'source-clips');
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch();
const clips = [];
const errors = [];

async function newScene(name) {
  const context = await browser.newContext({
    viewport: { width: 540, height: 960 },
    deviceScaleFactor: 2,
    // Playwright's video surface does not upscale the page to `size`; matching
    // the mobile viewport here keeps the app edge-to-edge. The render step
    // performs the single 2x Lanczos upscale to the publishing size.
    recordVideo: { dir: RAW, size: { width: 540, height: 960 } },
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const startedAt = performance.now();
  page.on('pageerror', (error) => errors.push(`${name}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: console: ${message.text()}`);
  });
  return { context, page, startedAt, name };
}

function elapsed(startedAt) {
  return (performance.now() - startedAt) / 1000;
}

async function openApp(page) {
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
}

async function goCatalog(page) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForTimeout(650);
}

async function addProduct(page, query) {
  const search = page.locator('[data-view="catalog"] [data-search-input]').first();
  await search.fill(query);
  await page.waitForTimeout(350);
  await page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(350);
}

async function createOrder(page) {
  await openApp(page);
  await goCatalog(page);
  await addProduct(page, 'Red Bull');
  await addProduct(page, 'Speed Unlimited');
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await page.waitForTimeout(750);
  await page.locator('[data-checkout-submit]').click();
  await page.waitForTimeout(1200);
}

async function unlockBusiness(page) {
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.waitForTimeout(750);
  const pinButton = page.locator('[data-open-pin][data-admin-target="business"]');
  if (await pinButton.count()) {
    await pinButton.click();
    await page.locator('[data-pin-modal] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form] button[type="submit"]').click();
    await page.waitForTimeout(850);
  }
}

async function finishScene(scene, { cutStart, duration, note }) {
  const trimStart = Math.max(0, cutStart - 0.18);
  const { context, page, name } = scene;
  // Keep a clean tail so the desired stable portion is safely encoded.
  await page.waitForTimeout(Math.max(400, (trimStart + duration + 0.4 - elapsed(scene.startedAt)) * 1000));
  await context.close();
  const recorded = await page.video().path();
  const raw = path.join(RAW, `${name}.webm`);
  renameSync(recorded, raw);
  clips.push({ name, raw, trimStart, duration, note });
}

async function runStable(name, duration, note, action, stableDelay = 900) {
  const scene = await newScene(name);
  await action(scene.page);
  await scene.page.waitForTimeout(stableDelay);
  const cutStart = elapsed(scene.startedAt);
  await finishScene({ ...scene, name }, { cutStart, duration, note });
}

// 01. Hook: the real home appears immediately and remains legible.
await runStable('01-hook-home', 3.2, 'Home real de La Taba.', async (page) => {
  await openApp(page);
}, 900);

// 02. Catalog: search and categories are real, not a designed mockup.
await runStable('02-catalog-search', 3.7, 'Catálogo real con búsqueda y categorías.', async (page) => {
  await openApp(page);
  await goCatalog(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
}, 650);

// 03. Product detail: open a real card and leave the add action visible.
await runStable('03-product-detail', 3.7, 'Ficha real de producto.', async (page) => {
  await openApp(page);
  await goCatalog(page);
  await page.locator('[data-view="catalog"] [data-search-input]').first().fill('Red Bull');
  await page.waitForTimeout(350);
  await page.locator('[data-view="catalog"] [data-product-detail]').first().click();
  await page.waitForTimeout(350);
}, 650);

// 04. Cart and checkout: show the real delivery/pickup/payment choices.
await runStable('04-cart-checkout', 4.4, 'Carrito y checkout reales.', async (page) => {
  await openApp(page);
  await goCatalog(page);
  await addProduct(page, 'Red Bull');
  await addProduct(page, 'Speed Unlimited');
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await page.waitForTimeout(750);
  await page.locator('[data-checkout-form]').scrollIntoViewIfNeeded();
}, 850);

// 05. Confirmation: this action was executed against the local demo repository.
await runStable('05-order-confirmed', 3.7, 'Confirmación y seguimiento del pedido real en demo local.', async (page) => {
  await createOrder(page);
}, 900);

// 06. Business inbox: a real order appears in the operational panel.
await runStable('06-business-inbox', 4.5, 'Bandeja operativa del comercio.', async (page) => {
  await createOrder(page);
  await unlockBusiness(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}, 1200);

// 07. Business statuses: capture the actual operator path through the states.
{
  const scene = await newScene('07-business-states');
  await createOrder(scene.page);
  await unlockBusiness(scene.page);
  await scene.page.evaluate(() => window.scrollTo(0, 0));
  await scene.page.waitForTimeout(650);
  const cutStart = elapsed(scene.startedAt);
  const first = scene.page.locator('[data-order-advance]:visible').first();
  if (await first.count()) await first.click();
  await scene.page.waitForTimeout(1050);
  const second = scene.page.locator('[data-order-advance]:visible').first();
  if (await second.count()) await second.click();
  await scene.page.waitForTimeout(1050);
  const third = scene.page.locator('[data-order-advance]:visible').first();
  if (await third.count()) await third.click();
  await finishScene(scene, {
    cutStart,
    duration: 4.6,
    note: 'Aceptar pedido → preparar → listo, ejecutado en la bandeja real.',
  });
}

// 08. Rider: accept delivery, leave the local, and expose the route controls.
{
  const scene = await newScene('08-rider-dispatch');
  await createOrder(scene.page);
  await unlockBusiness(scene.page);
  await scene.page.locator('[data-order-advance]:visible').first().click();
  await scene.page.waitForTimeout(850);
  await scene.page.locator('[data-order-advance]:visible').first().click();
  await scene.page.waitForTimeout(850);
  await scene.page.evaluate(() => { window.location.hash = '#rider'; });
  await scene.page.waitForTimeout(850);
  const cutStart = elapsed(scene.startedAt);
  const accept = scene.page.locator('[data-rider-accept]:visible').first();
  if (await accept.count()) await accept.click();
  await scene.page.waitForTimeout(900);
  const leave = scene.page.locator('[data-delivery-leave]:visible').first();
  if (await leave.count()) await leave.click();
  await scene.page.waitForTimeout(1150);
  await scene.page.evaluate(() => window.scrollTo(0, 0));
  await finishScene(scene, {
    cutStart,
    duration: 4.2,
    note: 'Aceptación y salida del rider con recorrido de muestra local.',
  });
}

// 09. WOW: customer tracking in En camino, with the real map and local route.
{
  const scene = await newScene('09-tracking-wow');
  await createOrder(scene.page);
  await unlockBusiness(scene.page);
  await scene.page.locator('[data-order-advance]:visible').first().click();
  await scene.page.waitForTimeout(800);
  await scene.page.locator('[data-order-advance]:visible').first().click();
  await scene.page.waitForTimeout(800);
  await scene.page.evaluate(() => { window.location.hash = '#rider'; });
  await scene.page.waitForTimeout(800);
  await scene.page.locator('[data-rider-accept]:visible').first().click();
  await scene.page.waitForTimeout(750);
  await scene.page.locator('[data-delivery-leave]:visible').first().click();
  await scene.page.waitForTimeout(700);
  const start = scene.page.locator('[data-sim-start]:visible').first();
  if (await start.count()) await start.click();
  await scene.page.waitForTimeout(950);
  await scene.page.evaluate(() => { window.location.hash = '#tracking'; });
  await scene.page.waitForTimeout(1500);
  await scene.page.evaluate(() => window.scrollTo(0, 0));
  const cutStart = elapsed(scene.startedAt);
  await finishScene(scene, {
    cutStart,
    duration: 4.7,
    note: 'Seguimiento del cliente con mapa y recorrido de muestra local explícito.',
  });
}

writeFileSync(path.join(ROOT, 'capture-manifest.json'), JSON.stringify({
  base: BASE,
  viewport: { width: 540, height: 960, deviceScaleFactor: 2 },
  outputSize: { width: 1080, height: 1920 },
  fpsSource: 25,
  errors,
  clips,
}, null, 2));

console.log(JSON.stringify({ errors, clips }, null, 2));
await browser.close();
