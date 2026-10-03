// Sonda de pre-producción del video TABA.
// Recorre el flujo demo completo y saca capturas de cada beat para auditar
// visualmente qué conviene mostrar. No graba video: sólo fotografías + reporte.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const REPO = 'C:/Users/marco/dev/la-taba-business-panel-automation';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');

const BASE = 'http://127.0.0.1:8093';
const OUT = 'D:/1212/taba-promo-v2/frames';
const report = { steps: [], console: [], external: new Set(), demoBadges: [] };

const helpers = await import(pathToFileURL(REPO + '/tests/e2e/helpers.mjs').href);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 432, height: 768 },
  deviceScaleFactor: 2.5,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Salta',
});
const page = await context.newPage();

page.on('console', (m) => { if (m.type() === 'error') report.console.push(m.text().slice(0, 300)); });
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.hostname !== '127.0.0.1') report.external.add(u.hostname);
});

async function shot(name, note = '') {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  report.steps.push({ name, note, url: page.url() });
  console.log('shot:', name, note);
}

await helpers.skipInstallInvitation(page);

// ── 1. Home demo ──
await helpers.gotoDemoReset(page, `${BASE}/?reset=1&demo=1`);
await page.waitForTimeout(1200);
await shot('01-home', 'home demo inicial');

// ¿Hay señalización de demo visible?
report.demoBadges = await page.evaluate(() => {
  const hits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent || '';
    if (/demo|demostraci|preview|prueba/i.test(t)) {
      const el = walker.currentNode.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      hits.push({ text: t.trim().slice(0, 80), visible, tag: el.tagName, cls: String(el.className).slice(0, 60), top: Math.round(r.top), h: Math.round(r.height) });
    }
  }
  return hits;
});

// ── 2. Scroll home ──
await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' }));
await page.waitForTimeout(400);
await shot('02-home-scrolled', 'home tras scroll');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

// ── 3. Catálogo ──
await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
await page.waitForTimeout(900);
await shot('03-catalogo', 'vista catálogo');

// ── 4. Detalle de producto ──
const detailBtns = page.locator('[data-product-grid] [data-product-detail] >> visible=true');
const detailCount = await detailBtns.count();
report.productCount = detailCount;
if (detailCount > 0) {
  await detailBtns.first().click();
  await page.waitForTimeout(600);
  await shot('04-producto-modal', 'modal detalle producto');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ── 5. Agregar al carrito ──
const productId = await helpers.seedCartAboveMinimum(page);
report.heroProductId = productId;
await page.waitForTimeout(500);
await shot('05-agregado', 'producto agregado, carrito flotante');

// ── 6. Carrito ──
await page.locator('[data-floating-cart]').click();
await page.waitForTimeout(700);
await shot('06-carrito', 'vista carrito');

// ── 7. Checkout ──
await helpers.fillCheckout(page, {
  name: 'Julieta Herrera',
  phone: '2995551234',
  payment: 'cash',
  deliveryMode: 'delivery',
});
await page.waitForTimeout(500);
await shot('07-checkout', 'checkout completo');

// ── 8. Confirmar ──
await page.getByRole('button', { name: /Confirmar pedido/i }).click();
await helpers.waitForToast(page, /Pedido confirmado/);
await page.waitForTimeout(400);
await shot('08-confirmado', 'toast + vista tras confirmar');
const orderInfo = await page.evaluate(async () => {
  const { getActiveOrder } = await import(new URL('js/orders.js', location.href).href);
  const o = getActiveOrder();
  return o ? { id: o.id, publicCode: o.publicCode || o.public_code || null, total: o.total, keys: Object.keys(o) } : null;
});
report.order = orderInfo;
await page.waitForTimeout(1200);
await shot('09-tracking-confirmado', 'tracking recién confirmado');

// ── 9. Panel negocio demo (PIN) ──
await page.goto(`${BASE}/?demo=1#business`);
await page.waitForTimeout(800);
await shot('10-business-gate', 'puerta PIN del negocio');
await page.locator('[data-open-pin][data-admin-target="business"]').click();
await page.waitForTimeout(300);
await shot('11-business-pin', 'formulario PIN');
await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
await page.locator('[data-pin-form]').press('Enter');
await page.waitForTimeout(900);
await shot('12-business-inbox', 'inbox del negocio demo');
const oid = orderInfo.id;
await page.locator(`[data-inbox-order="${oid}"]`).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot('13-business-pedido', 'pedido del cliente en inbox');
await page.locator(`[data-inbox-order="${oid}"] [data-prep-minutes]`).selectOption('20');
await page.locator(`[data-order-advance="${oid}"]`).click();
await page.waitForTimeout(700);
await shot('14-business-avanzado1', 'pedido aceptado');
await page.locator(`[data-order-advance="${oid}"]`).click();
await page.waitForTimeout(700);
await shot('15-business-avanzado2', 'pedido listo');

// ── 10. Rider ──
await page.goto(`${BASE}/?demo=1#rider`);
await page.waitForTimeout(800);
await shot('16-rider', 'vista repartidor');
await page.locator(`[data-rider-accept="${oid}"]`).click();
await page.waitForTimeout(600);
await shot('17-rider-aceptado', 'entrega aceptada');
await page.locator(`[data-delivery-leave="${oid}"]`).click();
await page.waitForTimeout(600);
await shot('18-rider-encamino', 'marcado en camino');

// ── 11. Tracking con simulación ──
await page.goto(`${BASE}/?demo=1#tracking`);
await page.waitForTimeout(2500);
await shot('19-tracking-mapa-a', 'mapa con rider (temprano)');
const mapInfo = await page.evaluate(() => {
  const shell = document.querySelector('[data-tracking-panel] [data-real-map]');
  return {
    hasMap: Boolean(shell),
    camera: shell?.getAttribute('data-map-camera') || null,
    canvas: Boolean(document.querySelector('[data-tracking-panel] canvas')),
  };
});
report.map = mapInfo;
await page.waitForTimeout(5000);
await shot('20-tracking-mapa-b', 'mapa con rider (medio)');
await page.waitForTimeout(6000);
await shot('21-tracking-mapa-c', 'mapa con rider (avanzado)');

// Vista completa de la sección tracking (scroll abajo: timeline)
await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
await page.waitForTimeout(400);
await shot('22-tracking-timeline', 'timeline del pedido');

report.external = [...report.external];
fs.writeFileSync('D:/1212/taba-promo-v2/frames/probe-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, steps: report.steps.length }, null, 2));

await browser.close();
