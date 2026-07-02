import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'artifacts', 'honesty-patch-2026-07-02');
const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:8080/';

async function domClick(page, selector) {
  await page.locator(selector).first().evaluate((element) => element.click());
}

async function fillCheckout(page, name) {
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Teléfono').fill('2995551234');
  await page.getByLabel('Calle y número').fill('Roca 123');
  await page.getByLabel('Localidad o zona').selectOption('Neuquén Capital');
  await page.getByLabel(/Observaciones del pedido/).fill('Presentación comercial');
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 432, height: 815 }, isMobile: true, hasTouch: true });
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}?reset=1&capture=public`);
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('reset'));
  await capture(page, 'public-home-432x815');

  await domClick(page, '.mobile-nav [data-nav-view="catalog"]');
  await domClick(page, '[data-product-grid] [data-add-product]:not([disabled])');
  await domClick(page, '.mobile-nav [data-nav-view="cart"]');
  await fillCheckout(page, 'Cliente público');
  await capture(page, 'public-checkout-432x815');
  await domClick(page, '[data-checkout-submit]');
  await page.locator('[data-toast]').filter({ hasText: 'No fue enviado al comercio' }).waitFor();
  await capture(page, 'public-confirmation-432x815');

  await page.goto(`${baseUrl}?reset=1&demo=1`);
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('reset'));
  await capture(page, 'demo-home-432x815');
  await domClick(page, '.mobile-nav [data-nav-view="catalog"]');
  await domClick(page, '[data-product-grid] [data-add-product]:not([disabled])');
  await domClick(page, '.mobile-nav [data-nav-view="cart"]');
  await fillCheckout(page, 'Walter presentación');
  await domClick(page, '[data-checkout-submit]');
  await page.locator('[data-toast]').filter({ hasText: 'Simulación en este dispositivo' }).waitFor();
  await capture(page, 'demo-tracking-432x815');

  await page.goto(`${baseUrl}?demo=1#business`);
  await domClick(page, '[data-view="business"] [data-open-pin]');
  await page.getByLabel('Código del modo negocio').fill('1234');
  await domClick(page, '[data-pin-form] button[type="submit"]');
  await domClick(page, '[data-order-advance="LT-0002"]');
  await domClick(page, '[data-order-advance="LT-0002"]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'demo-business-432x815');
  await domClick(page, '[data-view="business"] [data-open-admin-view="rider"]');
  await capture(page, 'demo-rider-432x815');
} finally {
  await browser.close();
}

console.log(outputDir);
