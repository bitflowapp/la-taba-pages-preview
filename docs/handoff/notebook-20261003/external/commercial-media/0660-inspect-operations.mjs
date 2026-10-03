import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire('C:/Users/marco/dev/la-taba-business-panel-automation/package.json');
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.resolve('artifacts/taba2-commercial/operations');
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

const visibleControls = () => page.locator('button:visible, a:visible, input:visible, select:visible').evaluateAll((nodes) => nodes.slice(0, 160).map((node) => ({
  tag: node.tagName.toLowerCase(),
  text: (node.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 160),
  advance: node.dataset?.orderAdvance || '',
  riderAccept: node.dataset?.riderAccept || '',
  leave: node.dataset?.deliveryLeave || '',
  arrive: node.dataset?.deliveryArrive || '',
  sim: node.dataset?.simStart !== undefined ? 'start' : node.dataset?.simPause !== undefined ? 'pause' : '',
  view: node.dataset?.openAdminView || node.dataset?.businessView || node.dataset?.navView || '',
})));

const evidence = [];
const snap = async (name, note = '') => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  evidence.push({
    name,
    note,
    url: page.url(),
    activeView: await page.locator('body').getAttribute('data-active-view'),
    text: (await page.locator('body').innerText()).slice(0, 7000),
    controls: await visibleControls(),
  });
};

await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 20000 });
await page.waitForTimeout(900);

// Safe local-demo order: the same UI path a customer uses.
await page.evaluate(() => { window.location.hash = '#catalog'; });
await page.waitForTimeout(600);
const search = page.locator('[data-view="catalog"] [data-search-input]').first();
await search.fill('Red Bull');
await page.waitForTimeout(350);
await page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first().click();
await page.waitForTimeout(300);
await search.fill('Speed Unlimited');
await page.waitForTimeout(350);
await page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => { window.location.hash = '#cart'; });
await page.waitForTimeout(600);
await page.locator('[data-checkout-submit]').click();
await page.waitForTimeout(1200);
await snap('01-order-received', 'Pedido confirmado desde el checkout real del demo local.');

await page.evaluate(() => { window.location.hash = '#business'; });
await page.waitForTimeout(800);
const pinButton = page.locator('[data-open-pin][data-admin-target="business"]');
if (await pinButton.count()) {
  await pinButton.click();
  await page.locator('[data-pin-modal] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form] button[type="submit"]').click();
  await page.waitForTimeout(900);
}
await snap('02-business-received', 'Bandeja real del comercio con pedido nuevo.');

const advance = async (name, note) => {
  const button = page.locator('[data-order-advance]:visible').first();
  if (!(await button.count())) {
    evidence.push({ name, note: `${note} No apareció el botón de avance.`, activeView: await page.locator('body').getAttribute('data-active-view'), controls: await visibleControls() });
    return false;
  }
  await button.click();
  await page.waitForTimeout(1000);
  await snap(name, note);
  return true;
};

await advance('03-business-preparing', 'El comercio acepta el pedido e inicia preparación.');
await advance('04-business-ready', 'El comercio marca el pedido como listo para reparto.');

await page.evaluate(() => { window.location.hash = '#rider'; });
await page.waitForTimeout(900);
await snap('05-rider-assignment', 'Vista rider: entrega lista y datos aún protegidos antes de aceptar.');

const accept = page.locator('[data-rider-accept]:visible').first();
if (await accept.count()) {
  await accept.click();
  await page.waitForTimeout(1000);
}
await snap('06-rider-accepted', 'El rider acepta la entrega y se habilitan sus acciones operativas.');

const leave = page.locator('[data-delivery-leave]:visible').first();
if (await leave.count()) {
  await leave.click();
  await page.waitForTimeout(1000);
}
await snap('07-rider-on-the-way', 'El rider registra la salida: estado En camino.');

const simStart = page.locator('[data-sim-start]:visible').first();
if (await simStart.count()) {
  await simStart.click();
  await page.waitForTimeout(1400);
}
await snap('08-rider-route', 'Recorrido de muestra local explícito, sin GPS real ni datos externos.');

await page.evaluate(() => { window.location.hash = '#tracking'; });
await page.waitForTimeout(1600);
await snap('09-customer-on-the-way', 'Seguimiento del cliente con estado En camino y mapa si está disponible.');

writeFileSync(path.join(OUT, 'operations-audit.json'), JSON.stringify({
  base: BASE,
  viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  errors,
  evidence,
}, null, 2));
console.log(JSON.stringify({ errors, evidence: evidence.map(({ name, activeView, url, note, controls }) => ({ name, activeView, url, note, controls })) }, null, 2));

await context.close();
await browser.close();
