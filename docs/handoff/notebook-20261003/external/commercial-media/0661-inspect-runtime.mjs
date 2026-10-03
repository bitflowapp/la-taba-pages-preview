import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire('C:/Users/marco/dev/la-taba-business-panel-automation/package.json');
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.resolve('artifacts/taba2-commercial/runtime');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'es-AR',
  serviceWorkers: 'block',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const evidence = [];
const snap = async (name, note = '') => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  evidence.push({
    name,
    note,
    url: page.url(),
    activeView: await page.locator('body').getAttribute('data-active-view'),
    text: (await page.locator('body').innerText()).slice(0, 5000),
    controls: await page.locator('button:visible, a:visible, input:visible, select:visible').evaluateAll((nodes) => nodes.slice(0, 120).map((node) => ({
      tag: node.tagName.toLowerCase(),
      text: (node.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '').trim().slice(0, 120),
      action: node.dataset?.orderAdvance || node.dataset?.deliveryAction || node.dataset?.businessView || node.dataset?.navView || node.dataset?.openAdminView || node.dataset?.orderTrack || '',
    }))),
  });
};

await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
await page.waitForTimeout(1200);
await snap('01-home', 'Home real en modo demo local aislado.');

await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForTimeout(700);
await snap('02-catalog', 'Catálogo y filtros.');

const search = page.locator('[data-view="catalog"] [data-search-input]').first();
await search.fill('Red Bull');
await page.waitForTimeout(400);
await page.locator('[data-view="catalog"] [data-product-detail]').first().click();
await page.waitForTimeout(600);
await snap('03-product', 'Ficha de producto real.');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first().click();
await page.waitForTimeout(300);
await search.fill('Speed Unlimited');
await page.waitForTimeout(400);
await page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first().click();
await page.waitForTimeout(500);
await page.evaluate(() => { window.location.hash = '#cart'; });
await page.waitForTimeout(800);
await snap('04-cart-checkout', 'Carrito con dos productos y checkout.');

const checkoutBefore = await page.locator('[data-checkout-form]').evaluate((form) => Object.fromEntries([...form.elements].filter((element) => element.name).map((element) => [element.name, element.value])));
evidence.push({ name: 'checkout-values', values: checkoutBefore });

await page.locator('[data-checkout-submit]').click();
await page.waitForTimeout(1400);
await snap('05-after-order', 'Resultado del intento real de confirmar en el sandbox local.');

await page.evaluate(() => { window.location.hash = '#business'; });
await page.waitForTimeout(900);
const pinButton = page.locator('[data-open-pin][data-admin-target="business"]');
if (await pinButton.count()) {
  await pinButton.click();
  await page.locator('[data-pin-modal] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form] button[type="submit"]').click();
  await page.waitForTimeout(1000);
}
await snap('06-business', 'Panel del negocio desbloqueado con PIN local de demo.');

await page.evaluate(() => { window.location.hash = '#rider'; });
await page.waitForTimeout(900);
await snap('07-rider', 'Vista del rider, antes de cualquier acción adicional.');

await page.evaluate(() => { window.location.hash = '#tracking'; });
await page.waitForTimeout(900);
await snap('08-tracking', 'Seguimiento en el estado disponible al terminar el flujo.');

writeFileSync(path.join(OUT, 'runtime-audit.json'), JSON.stringify({
  base: BASE,
  viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  errors,
  evidence,
}, null, 2));
console.log(JSON.stringify({ errors, evidence: evidence.map(({ name, activeView, url, note, controls }) => ({ name, activeView, url, note, controls })) }, null, 2));

await context.close();
await browser.close();
