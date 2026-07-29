import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'artifacts', 'honesty-patch-2026-07-02');
const baseUrl = process.env.MOTO_QA_URL || 'http://127.0.0.1:8080/';
const cdpUrl = process.env.MOTO_CDP_URL || 'http://127.0.0.1:9222';
const execFileAsync = promisify(execFile);

async function adbValue(...args) {
  const { stdout } = await execFileAsync('adb', args);
  return stdout.trim();
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function domClick(page, selector) {
  await page.locator(selector).first().evaluate((element) => element.click());
}

async function domValue(page, selector, value) {
  await page.locator(selector).first().evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function waitForText(page, selector, text) {
  await page.waitForFunction(
    ({ target, expected }) => document.querySelector(target)?.textContent?.includes(expected),
    { target: selector, expected: text },
  );
}

async function pageMetrics(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollWidth: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    url: location.href,
  }));
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
const pages = context.pages();
const page = pages.at(-1) || await context.newPage();
const evidence = { device: {}, public: {}, demo: {} };

try {
  evidence.device = {
    model: await adbValue('shell', 'getprop', 'ro.product.model'),
    product: await adbValue('shell', 'getprop', 'ro.product.name'),
    android: await adbValue('shell', 'getprop', 'ro.build.version.release'),
    ...(await page.evaluate(() => ({ userAgent: navigator.userAgent }))),
  };

  await page.goto(`${baseUrl}?moto=prepare`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const keys = await caches?.keys?.() || [];
    await Promise.all(keys.filter((key) => key.startsWith('la-taba-')).map((key) => caches.delete(key)));
  });

  await page.goto(`${baseUrl}?reset=1&moto=public&v=honesty`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('reset'));
  evidence.public.metrics = await pageMetrics(page);
  evidence.public.orders = await page.evaluate(() => JSON.parse(localStorage.getItem('la_taba_mvp_v4_state'))?.orders?.length ?? 0);
  evidence.public.bannerVisible = await page.locator('[data-demo-mode-banner]').isVisible();
  evidence.public.rolesVisible = await page.locator('.role-intro').isVisible();
  evidence.public.pinVisible = await page.getByText('1234', { exact: true }).isVisible().catch(() => false);
  check(evidence.public.metrics.innerWidth === 432, `Viewport Moto inesperado: ${evidence.public.metrics.innerWidth}px`);
  check(evidence.public.metrics.overflowX <= 1, 'Overflow horizontal en modo público');
  check(evidence.public.orders === 0, 'El modo público contiene pedidos sembrados');
  check(!evidence.public.bannerVisible && !evidence.public.rolesVisible && !evidence.public.pinVisible, 'El modo público expone elementos de presentación');

  await page.goto(`${baseUrl}?reset=1&demo=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('reset'));
  evidence.demo.homeMetrics = await pageMetrics(page);
  evidence.demo.bannerVisible = await page.locator('[data-demo-mode-banner]').isVisible();
  check(evidence.demo.bannerVisible, 'No se ve la franja de modo demostración');
  check(evidence.demo.homeMetrics.overflowX <= 1, 'Overflow horizontal en home demo');

  await domClick(page, '.mobile-nav [data-nav-view="catalog"]');
  await domClick(page, '[data-product-grid] [data-add-product]:not([disabled])');
  await domClick(page, '.mobile-nav [data-nav-view="cart"]');
  await domValue(page, '[name="customerName"]', 'Walter Moto QA');
  await domValue(page, '[name="customerPhone"]', '2995551234');
  await domValue(page, '[name="customerStreetAddress"]', 'Roca 123');
  await domValue(page, '[name="customerNeighborhood"]', 'Neuquén Capital');
  await domValue(page, '[name="customerNotes"]', 'Prueba Moto g15');
  await domClick(page, '[data-checkout-submit]');
  await waitForText(page, '[data-toast]', 'Simulación en este dispositivo');
  const deliveryCode = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  evidence.demo.trackingMetrics = await pageMetrics(page);
  check(evidence.demo.trackingMetrics.overflowX <= 1, 'Overflow horizontal en tracking demo');
  check(await page.locator('[data-real-map], [data-sim-gps]').count() === 0, 'Tracking demo expone mapa o GPS');

  await page.goto(`${baseUrl}?demo=1#business`, { waitUntil: 'networkidle' });
  await domClick(page, '[data-view="business"] [data-open-pin]');
  await domValue(page, '[data-pin-form] input[name="pin"]', '1234');
  await domClick(page, '[data-pin-form] button[type="submit"]');
  await domClick(page, '[data-order-advance="LT-0002"]');
  await domClick(page, '[data-order-advance="LT-0002"]');
  evidence.demo.businessMetrics = await pageMetrics(page);
  check(evidence.demo.businessMetrics.overflowX <= 1, 'Overflow horizontal en negocio demo');
  check((await page.locator('[data-business-dashboard]').innerText()).includes('Datos de ejemplo'), 'Negocio no rotula sus datos de ejemplo');

  await domClick(page, '[data-view="business"] [data-open-admin-view="rider"]');
  evidence.demo.riderMetrics = await pageMetrics(page);
  const riderText = await page.locator('[data-delivery-panel]').innerText();
  check(riderText.includes('Modo demo local'), 'Rider no indica modo demo local');
  check(riderText.includes('No se usa GPS, ETA ni ubicación en vivo'), 'Rider no explica el seguimiento por estados');
  check(await page.locator('[data-delivery-panel] [data-real-map], [data-delivery-panel] [data-sim-gps]').count() === 0, 'Rider expone GPS o mapa');
  check(evidence.demo.riderMetrics.overflowX <= 1, 'Overflow horizontal en rider demo');

  await domClick(page, '[data-delivery-leave="LT-0002"]');
  await domClick(page, '[data-delivery-arrive="LT-0002"]');
  await domValue(page, '[data-delivery-code-input="LT-0002"]', deliveryCode);
  await domClick(page, '[data-delivery-code-confirm="LT-0002"]');
  await domClick(page, '[data-delivery-done="LT-0002"]');
  await page.goto(`${baseUrl}?demo=1#tracking`, { waitUntil: 'networkidle' });
  evidence.demo.finalStatus = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('la_taba_mvp_v4_state'));
    return state.orders.find((order) => order.id === 'LT-0002')?.status;
  });
  check(evidence.demo.finalStatus === 'delivered', `Estado final inesperado: ${evidence.demo.finalStatus}`);

  await fs.writeFile(path.join(outputDir, 'moto-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
