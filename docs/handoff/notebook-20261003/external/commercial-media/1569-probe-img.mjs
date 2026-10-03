import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const REPO = 'C:/Users/marco/dev/la-taba-business-panel-automation';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');
const helpers = await import(pathToFileURL(REPO + '/tests/e2e/helpers.mjs').href);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
  isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'es-AR',
});
const page = await context.newPage();
const imgResponses = [];
page.on('response', (r) => {
  if (r.request().resourceType() === 'image') imgResponses.push(`${r.status()} ${r.url().split('/').slice(-3).join('/')}`);
});
await helpers.skipInstallInvitation(page);
await helpers.gotoDemoReset(page, 'http://127.0.0.1:8093/?reset=1&demo=1#catalog');
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-product-grid] .product-card')].slice(0, 6);
  return cards.map((c) => ({
    add: c.querySelector('[data-add-product]')?.getAttribute('data-add-product') || null,
    img: c.querySelector('img')?.getAttribute('src') || null,
    currentSrc: c.querySelector('img')?.currentSrc?.split('/').slice(-3).join('/') || null,
  }));
});
console.log(JSON.stringify(info, null, 2));
console.log('img responses:', JSON.stringify(imgResponses.slice(0, 20), null, 2));
await browser.close();
