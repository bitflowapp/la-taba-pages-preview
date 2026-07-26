import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = (process.env.QA_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const RELEASE_DIR = path.resolve('docs/final-commercial-release');
const VIDEO_DIR = path.join(RELEASE_DIR, 'videos');
const TEMP_DIR = path.join(RELEASE_DIR, '.video-work');
mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync(TEMP_DIR, { recursive: true });

const artifacts = [];
const pause = (page, milliseconds = 650) => page.waitForTimeout(milliseconds);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ready(page, view = 'home') {
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible', timeout: 12_000 });
}

async function fresh(page) {
  await page.goto(`${BASE_URL}/?reset=1&demo=1#home`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await ready(page, 'home');
  await pause(page, 900);
}

async function view(page, name, wait = 450) {
  await page.evaluate((next) => { location.hash = `#${next}`; }, name);
  await ready(page, name);
  await page.evaluate(() => scrollTo(0, 0));
  await pause(page, wait);
}

async function addProduct(page, category = 'gaseosas') {
  await view(page, 'catalog', 300);
  await page.locator(`[data-view="catalog"] [data-category-id="${category}"]`).first().click();
  await pause(page, 300);
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await pause(page, 500);
}

async function fillCheckout(page, { name = 'María López' } = {}) {
  const form = page.locator('[data-checkout-form]');
  await form.locator('[name="deliveryMode"][value="delivery"]').check();
  await form.locator('[name="customerName"]').fill(name);
  await form.locator('[name="customerPhone"]').fill('2995551234');
  await form.locator('[name="customerStreetAddress"]').fill('Roca 123');
  await form.locator('[name="customerNeighborhood"]').fill('Neuquén centro');
  const payment = form.locator('[name="paymentMethod"]');
  if (await payment.count()) {
    await payment.selectOption(await payment.locator('option[value="cash"]').count() ? 'cash' : 'coordinate');
  }
}

async function createOrder(page, { showCustomerFlow = false } = {}) {
  if (!showCustomerFlow) {
    await addProduct(page, 'gaseosas');
  } else {
    await view(page, 'catalog', 850);
    await page.locator('[data-product-grid] [data-product-detail]').first().click();
    await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
    await pause(page, 800);
    await page.locator('[data-product-modal] [data-add-product]:not([disabled])').click();
    await pause(page, 600);
  }
  await view(page, 'cart', showCustomerFlow ? 850 : 250);
  await fillCheckout(page);
  if (showCustomerFlow) await pause(page, 900);
  await page.locator('[data-checkout-submit]').click();
  await ready(page, 'tracking');
  await pause(page, showCustomerFlow ? 1_200 : 300);
  const order = await page.evaluate(async () => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const state = getState();
    const found = state.orders.find((candidate) => candidate.id === state.lastOrderId);
    return found ? { id: found.id, status: found.status } : null;
  });
  assert(order?.id, 'No se creó el pedido privado para el video.');
  return order.id;
}

async function unlockBusiness(page) {
  await view(page, 'business', 350);
  if (await page.locator('[data-business-dashboard]').isVisible()) return;
  await page.locator('[data-open-pin][data-admin-target="business"]').first().click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-business-dashboard]').waitFor({ state: 'visible' });
}

async function status(page, orderId) {
  return page.evaluate(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status || '';
  }, orderId);
}

async function prepare(page, orderId, visible = false) {
  await unlockBusiness(page);
  if (visible) await pause(page, 1_000);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previous = await status(page, orderId);
    if (previous === 'ready') return;
    const button = page.locator(`[data-order-advance="${orderId}"]`).first();
    await button.waitFor({ state: 'visible' });
    await button.click();
    await page.waitForFunction(async ({ id, oldStatus }) => {
      const { getState } = await import(new URL('js/state.js', location.href).href);
      return getState().orders.find((order) => order.id === id)?.status !== oldStatus;
    }, { id: orderId, oldStatus: previous });
    await pause(page, visible ? 900 : 180);
  }
  throw new Error(`No se pudo llevar ${orderId} a listo.`);
}

async function accept(page, orderId, visible = false) {
  await view(page, 'rider', visible ? 800 : 250);
  await page.locator(`[data-rider-accept="${orderId}"]`).first().click();
  await page.locator(`[data-delivery-leave="${orderId}"]`).waitFor({ state: 'visible' });
  await pause(page, visible ? 950 : 180);
}

async function startGps(page, orderId) {
  await view(page, 'rider', 250);
  await page.locator(`[data-delivery-leave="${orderId}"]`).first().click();
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status === 'on_the_way';
  }, orderId);
  const requested = await page.evaluate(async () => {
    const { enableGpsTracking } = await import(new URL('js/simulation.js', location.href).href);
    return enableGpsTracking();
  });
  assert(requested?.ok, requested?.message || 'GPS no disponible.');
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const gps = getState().simulation;
    return gps?.orderId === id
      && gps?.source === 'gps'
      && gps?.gpsStatus === 'active'
      && Number.isFinite(Number(gps?.accuracy));
  }, orderId, { timeout: 15_000 });
  await page.evaluate(async (id) => {
    const { getState, updateState } = await import(new URL('js/state.js', location.href).href);
    const gps = getState().simulation;
    const timestamp = Date.now();
    updateState((draft) => {
      const order = draft.orders.find((candidate) => candidate.id === id);
      if (!order || !gps) return;
      order.tracking = {
        ...(order.tracking || {}),
        lastLocation: {
          lat: gps.lat,
          lng: gps.lng,
          accuracy: gps.accuracy,
          heading: gps.heading,
          speed: gps.speed,
          source: 'gps',
          gpsStatus: 'active',
          timestamp,
          lastFixAt: new Date(timestamp).toISOString(),
        },
      };
    });
  }, orderId);
}

async function deliver(page, orderId, { visible = false } = {}) {
  await view(page, 'rider', visible ? 900 : 250);
  await page.locator(`[data-delivery-arrive="${orderId}"]`).first().click();
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status === 'arriving';
  }, orderId);
  if (visible) await pause(page, 900);
  await view(page, 'tracking', visible ? 750 : 200);
  const codeNode = page.locator('[data-delivery-code]').first();
  await codeNode.waitFor({ state: 'visible' });
  const code = await codeNode.getAttribute('data-delivery-code');
  assert(/^\d{4}$/.test(code || ''), 'Código de entrega ausente.');
  await view(page, 'rider', visible ? 700 : 200);
  await page.locator(`[data-delivery-code-input="${orderId}"]`).fill(code);
  await page.locator(`[data-delivery-code-confirm="${orderId}"]`).click();
  await page.locator(`[data-delivery-done="${orderId}"]`).waitFor({ state: 'visible' });
  if (visible) await pause(page, 700);
  await page.locator(`[data-delivery-done="${orderId}"]`).click();
  await page.waitForFunction(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status === 'delivered';
  }, orderId);
  await pause(page, visible ? 1_000 : 200);
}

async function record(browser, name, flow) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: TEMP_DIR, size: { width: 390, height: 844 } },
    locale: 'es-AR',
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: -38.95161, longitude: -68.05912, accuracy: 11 },
  });
  await context.grantPermissions(['geolocation'], { origin: new URL(BASE_URL).origin });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Service Worker')) {
      browserErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.open = () => null;
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {}, readText: async () => '' },
      });
    } catch (_) { /* navegador con clipboard de sólo lectura */ }
  });
  const video = page.video();
  let flowFailure;
  try {
    await fresh(page);
    await flow(page);
    assert(!browserErrors.length, `${name}: errores del navegador: ${browserErrors.join(' | ')}`);
  } catch (error) {
    flowFailure = error;
  } finally {
    await context.close();
  }
  if (flowFailure) throw flowFailure;
  const target = path.join(VIDEO_DIR, `${name}.webm`);
  await video.saveAs(target);
  const buffer = readFileSync(target);
  const entry = {
    file: path.relative(RELEASE_DIR, target).replaceAll('\\', '/'),
    bytes: statSync(target).size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
  artifacts.push(entry);
  console.log(`✓ ${entry.file}`);
}

const browser = await chromium.launch();
try {
  await record(browser, 'customer-flow', async (page) => {
    await createOrder(page, { showCustomerFlow: true });
  });

  await record(browser, 'tracking-flow', async (page) => {
    const orderId = await createOrder(page);
    await prepare(page, orderId);
    await accept(page, orderId);
    await view(page, 'tracking', 1_200);
    await startGps(page, orderId);
    await view(page, 'tracking', 1_500);
    await deliver(page, orderId);
    await view(page, 'tracking', 1_300);
  });

  await record(browser, 'business-rider-delivery', async (page) => {
    const orderId = await createOrder(page);
    await prepare(page, orderId, true);
    await accept(page, orderId, true);
    await startGps(page, orderId);
    await pause(page, 900);
    await deliver(page, orderId, { visible: true });
  });
} finally {
  await browser.close();
  rmSync(TEMP_DIR, { recursive: true, force: true });
}

writeFileSync(
  path.join(VIDEO_DIR, 'manifest.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), artifacts }, null, 2)}\n`,
  'utf8',
);
console.log(`Videos y hashes: ${VIDEO_DIR}`);
