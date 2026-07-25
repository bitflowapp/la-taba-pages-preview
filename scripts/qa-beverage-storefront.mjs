import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:8080';
const OUTPUT_DIR = path.resolve('docs/visual-review/beverage-storefront-simplification');
mkdirSync(OUTPUT_DIR, { recursive: true });

async function openFresh(page, view = 'home') {
  await page.goto(`${BASE_URL}/?reset=1&demo=1#${view}`, { waitUntil: 'networkidle' });
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
}

async function addFromCategory(page, categoryId) {
  await page.locator(`[data-view="catalog"] [data-category-id="${categoryId}"]`).click();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(250);
}

async function goTo(page, view) {
  await page.evaluate((nextView) => {
    window.location.hash = `#${nextView}`;
  }, view);
  await page.locator(`[data-view="${view}"]`).waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
}

async function capture(page, name, options = {}) {
  await page.locator('[data-toast]').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, `${name}.png`),
    fullPage: options.fullPage ?? true,
  });
}

const browser = await chromium.launch();
try {
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    locale: 'es-AR',
  });
  const page = await mobileContext.newPage();

  await openFresh(page);
  await capture(page, '01-home-empty');

  await openFresh(page, 'catalog');
  await addFromCategory(page, 'gaseosas');
  await goTo(page, 'home');
  await capture(page, '02-home-with-cart');

  await openFresh(page, 'catalog');
  await capture(page, '03-catalog');

  await openFresh(page, 'catalog');
  await addFromCategory(page, 'gaseosas');
  await goTo(page, 'cart');
  await capture(page, '04-cart-no-alcohol');

  await openFresh(page, 'catalog');
  await addFromCategory(page, 'cervezas');
  await goTo(page, 'cart');
  await capture(page, '05-cart-alcohol');

  await openFresh(page, 'catalog');
  await addFromCategory(page, 'gaseosas');
  await goTo(page, 'cart');
  await page.locator('input[name="customerName"]').fill('Cliente TABA');
  await page.locator('input[name="customerPhone"]').fill('299 555 1234');
  await page.locator('input[name="customerStreetAddress"]').fill('Roca 123');
  await page.locator('input[name="customerNeighborhood"]').fill('Neuquén centro');
  await capture(page, '06-checkout');

  const heightReport = [];
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openFresh(page);
    const homeHeight = await page.locator('[data-view="home"]').evaluate(
      (node) => Math.ceil(node.getBoundingClientRect().height),
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    heightReport.push(`${viewport.width}x${viewport.height}: home=${homeHeight}px; overflow=${overflow}px`);
  }
  writeFileSync(path.join(OUTPUT_DIR, 'measurements.txt'), `${heightReport.join('\n')}\n`, 'utf8');
  await mobileContext.close();

  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    locale: 'es-AR',
  });
  const desktopPage = await desktopContext.newPage();
  await openFresh(desktopPage);
  await capture(desktopPage, '07-desktop');
  await desktopContext.close();
} finally {
  await browser.close();
}

console.log(`Capturas generadas en ${OUTPUT_DIR}`);
