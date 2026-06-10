// Capturas de QA visual de las superficies principales de La Taba.
//
// Uso:
//   1. Levantar la app:  python -m http.server 8080
//   2. node scripts/qa-screenshots.mjs [carpetaSalida]
//
// Guarda PNGs en docs/visual-review/<carpetaSalida || commercial-polish-v1-final>/
// más un overflow-report.txt con el scroll lateral detectado por vista/viewport.
// No toca el producto: es una herramienta de inspección visual para QA manual.
//
// Recorrido completo (viewport principal 390×844): presentación comercial,
// cliente (catálogo, búsqueda, detalle, carrito, cupón, checkout, seguimiento),
// negocio (PIN, pedidos, caja, métricas, catálogo editable) y repartidor
// (PIN, reparto, código de entrega, entrega) hasta la recompra del cliente.
// El resto de los viewports recorre las pantallas clave para QA responsive.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:8080';
const OUT = path.resolve('docs/visual-review', process.argv[2] || 'commercial-polish-v1-final');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { tag: 'm390', width: 390, height: 844, full: true },
  { tag: 'n320', width: 320, height: 568 },
  { tag: 'v360', width: 360, height: 800 },
  { tag: 'v412', width: 412, height: 915 },
  { tag: 't768', width: 768, height: 1024 },
  { tag: 'd1280', width: 1280, height: 900 },
];

const overflowReport = [];

function shotPath(name) {
  return path.join(OUT, `${name}.png`);
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    serviceWorkers: 'block',
    locale: 'es-AR',
  });
  const page = await context.newPage();
  return { context, page };
}

async function gotoView(page, view) {
  await page.evaluate((v) => { window.location.hash = `#${v}`; }, view);
  await page.waitForTimeout(400);
}

async function shot(page, name, { fullPage = true } = {}) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: shotPath(name), fullPage });
  console.log(`✔ ${name}.png`);
}

async function elementShot(page, selector, name) {
  const node = page.locator(selector).first();
  try {
    await node.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await page.waitForTimeout(250);
    await node.screenshot({ path: shotPath(name), timeout: 8_000 });
    console.log(`✔ ${name}.png`);
  } catch (error) {
    console.warn(`⚠ sin captura de ${selector} (${name}): ${error.message.split('\n')[0]}`);
  }
}

async function openFresh(page, query = '?reset=1') {
  await page.goto(`${BASE}/${query}`, { waitUntil: 'networkidle' });
  // ?reset=1 recarga con location.replace: esperar a que la app re-arranque.
  await page.waitForSelector('.app-shell', { timeout: 15_000 });
  await page.waitForTimeout(700);
}

async function unlockAdmin(page) {
  const unlocked = await page.evaluate(() => Boolean(document.querySelector('[data-admin-unlocked]:not([hidden])')));
  if (unlocked) return;
  await page.locator('[data-view]:not([hidden]) [data-open-pin]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form] button[type="submit"]').click();
  await page.waitForTimeout(500);
}

async function fillCheckout(page, { phone = '299 555 1234' } = {}) {
  await page.locator('input[name="customerName"]').fill('Juan Pérez');
  await page.locator('input[name="customerPhone"]').fill(phone);
  await page.locator('input[name="customerStreetAddress"]').fill('Roca 123');
  await page.locator('input[name="customerNeighborhood"]').fill('Neuquén centro');
  await page.locator('input[name="customerReference"]').fill('Portón negro, tocar timbre');
  await page.locator('textarea[name="customerNotes"]').fill('Cortar en porciones finas');
  // Recordar datos: habilita historial local, recompra y señales de fidelización.
  await page.locator('input[name="rememberCustomer"]').check();
}

async function scanOverflow(page, tag, views = ['home', 'catalog', 'cart', 'tracking', 'profile', 'business', 'rider']) {
  for (const view of views) {
    await gotoView(page, view);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const line = `${tag} ${view}: ${overflow}px`;
    overflowReport.push(line);
    if (overflow > 1) console.warn(`⚠ overflow horizontal en ${line}`);
  }
}

// ---------- Recorrido completo (cliente → negocio → rider → recompra) ----------
async function fullJourney(browser, viewport) {
  const tag = viewport.tag;
  const { context, page } = await newPage(browser, viewport);

  // 1. Presentación comercial sobre demo limpia.
  await openFresh(page, '?reset=1&pitch=1');
  await shot(page, `${tag}-01-pitch`, { fullPage: false });
  await page.locator('[data-close-pitch]').click();
  await page.waitForTimeout(300);

  // 2. Cliente: home y seguimiento vacío.
  await shot(page, `${tag}-02-home`);
  await gotoView(page, 'tracking');
  await shot(page, `${tag}-03-tracking-empty`, { fullPage: false });

  // 3. Accesos con PIN (rider primero: un PIN desbloquea ambos paneles).
  await gotoView(page, 'rider');
  await shot(page, `${tag}-04-rider-pin-lock`, { fullPage: false });
  await gotoView(page, 'business');
  await page.locator('[data-view]:not([hidden]) [data-open-pin]').first().click();
  await page.waitForTimeout(300);
  await shot(page, `${tag}-05-business-pin-modal`, { fullPage: false });
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form] button[type="submit"]').click();
  await page.waitForTimeout(600);

  // 4. Negocio recién abierto: sin pedidos nuevos (estado vacío + ejemplo entregado).
  await shot(page, `${tag}-06-business-initial`);

  // 5. Catálogo editable: plegado, formulario nuevo, edición, expandido.
  await elementShot(page, '[data-business-catalog]', `${tag}-07-business-catalog-collapsed`);
  await page.locator('[data-catalog-new]').click();
  await page.waitForTimeout(400);
  await elementShot(page, '[data-business-catalog]', `${tag}-08-business-catalog-form-new`);
  await page.locator('[data-catalog-form-close]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-product-edit]').first().click();
  await page.waitForTimeout(400);
  await elementShot(page, '[data-catalog-form]', `${tag}-09-business-catalog-edit`);
  await page.locator('[data-catalog-form-close]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-catalog-expand]').click();
  await page.waitForTimeout(400);
  await elementShot(page, '[data-business-catalog]', `${tag}-10-business-catalog-expanded`);
  await page.locator('[data-catalog-collapse]').click();
  await page.waitForTimeout(400);

  // 6. Caja y guía del presentador antes del pedido.
  await elementShot(page, '[data-business-report]', `${tag}-11-business-cashbox-initial`);
  const guide = page.locator('.demo-guide');
  if (await guide.count()) {
    await guide.locator('summary').click();
    await page.waitForTimeout(300);
    await elementShot(page, '.demo-guide', `${tag}-12-demo-guide`);
  }

  // 7. Cliente: catálogo, búsqueda sin resultados, detalle, carrito y checkout.
  await gotoView(page, 'catalog');
  await shot(page, `${tag}-13-catalog`);
  await page.locator('[data-view="catalog"] [data-search-input]').fill('zzzz');
  await page.waitForTimeout(400);
  await shot(page, `${tag}-14-catalog-no-results`, { fullPage: false });
  await page.locator('[data-view="catalog"] [data-search-input]').fill('');
  await page.waitForTimeout(400);
  await page.locator('[data-product-grid] [data-product-detail]').first().click();
  await page.waitForTimeout(400);
  await shot(page, `${tag}-15-product-detail`, { fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const addButtons = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
  await addButtons.nth(0).click();
  await page.waitForTimeout(250);
  await addButtons.nth(1).click();
  await page.waitForTimeout(250);

  await gotoView(page, 'cart');
  // Scope al carrito: el grid del catálogo (oculto) también tiene steppers data-cart-inc.
  await page.locator('[data-cart-list] [data-cart-inc]').first().click();
  await page.waitForTimeout(300);
  const coupon = page.locator('input[name="couponCode"]');
  if (await coupon.count()) {
    await coupon.fill('TABA10');
    await page.locator('[data-apply-coupon]').click();
    await page.waitForTimeout(400);
  }
  await shot(page, `${tag}-16-cart-filled`);
  await fillCheckout(page);
  await shot(page, `${tag}-17-checkout-filled`);

  // 8. Confirmar pedido → seguimiento activo con código de entrega.
  await page.locator('[data-checkout-form] button[type="submit"]').click();
  await page.waitForTimeout(1400);
  await shot(page, `${tag}-18-tracking-active`);
  const deliveryCode = await page.locator('[data-delivery-code]').first().getAttribute('data-delivery-code');

  // 9. Perfil / Local (acceso a la presentación incluido).
  await gotoView(page, 'profile');
  await shot(page, `${tag}-19-profile`);

  // 10. Negocio: pedido nuevo → preparación → listo.
  await gotoView(page, 'business');
  await page.waitForTimeout(500);
  await shot(page, `${tag}-20-business-new-order`);
  const orderCard = page.locator('[data-inbox-order="LT-0002"]');
  const prepSelect = orderCard.locator('[data-prep-minutes]');
  if (await prepSelect.count()) await prepSelect.selectOption('20');
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.waitForTimeout(500);
  await elementShot(page, '[data-inbox-order="LT-0002"]', `${tag}-21-business-preparing`);
  await page.locator('[data-order-advance="LT-0002"]').click();
  await page.waitForTimeout(500);
  await elementShot(page, '[data-inbox-order="LT-0002"]', `${tag}-22-business-ready`);

  // 11. Rider: pedido listo → salida → llegada → código → entregado.
  await gotoView(page, 'rider');
  await page.waitForTimeout(600);
  await shot(page, `${tag}-23-rider-ready`);
  await page.locator('[data-delivery-leave="LT-0002"]').click();
  await page.waitForTimeout(500);
  await shot(page, `${tag}-24-rider-on-the-way`, { fullPage: false });
  await page.locator('[data-delivery-arrive="LT-0002"]').click();
  await page.waitForTimeout(500);
  await elementShot(page, '[data-delivery-code-panel]', `${tag}-25-rider-code-input`);
  if (deliveryCode) {
    await page.locator('[data-delivery-code-input="LT-0002"]').fill(deliveryCode);
    await page.locator('[data-delivery-code-confirm="LT-0002"]').click();
    await page.waitForTimeout(500);
    await elementShot(page, '[data-delivery-code-panel]', `${tag}-26-rider-code-confirmed`);
  }
  await page.locator('[data-delivery-done="LT-0002"]').click();
  await page.waitForTimeout(600);
  await shot(page, `${tag}-27-rider-delivered`, { fullPage: false });

  // 12. Cliente final: entregado, código validado y recompra en home.
  await gotoView(page, 'tracking');
  await shot(page, `${tag}-28-tracking-delivered`);
  await gotoView(page, 'home');
  await page.waitForTimeout(500);
  await shot(page, `${tag}-29-home-reorder`);
  await elementShot(page, '[data-customer-actions]', `${tag}-30-reorder-card`);

  // 13. Caja y señales del canal propio después del flujo completo.
  await gotoView(page, 'business');
  await page.waitForTimeout(500);
  await elementShot(page, '[data-business-report]', `${tag}-31-business-cashbox-after`);
  await elementShot(page, '[data-direct-ordering-metrics]', `${tag}-32-business-metrics-after`);

  await scanOverflow(page, tag);
  await context.close();
}

// ---------- Recorrido corto responsive (pantallas clave) ----------
async function coreJourney(browser, viewport) {
  const tag = viewport.tag;
  const { context, page } = await newPage(browser, viewport);

  await openFresh(page);
  await shot(page, `${tag}-01-home`);
  await gotoView(page, 'catalog');
  await shot(page, `${tag}-02-catalog`);

  const addButtons = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
  await addButtons.nth(0).click();
  await page.waitForTimeout(250);
  await addButtons.nth(1).click();
  await page.waitForTimeout(250);
  await gotoView(page, 'cart');
  await shot(page, `${tag}-03-cart-filled`);
  await fillCheckout(page);
  await shot(page, `${tag}-04-checkout-filled`);
  await page.locator('[data-checkout-form] button[type="submit"]').click();
  await page.waitForTimeout(1400);
  await shot(page, `${tag}-05-tracking-active`);

  await gotoView(page, 'business');
  await unlockAdmin(page);
  await shot(page, `${tag}-06-business-new-order`);

  await gotoView(page, 'rider');
  await page.waitForTimeout(500);
  await shot(page, `${tag}-07-rider`, { fullPage: false });

  await scanOverflow(page, tag);
  await context.close();
}

const browser = await chromium.launch();
for (const viewport of VIEWPORTS) {
  console.log(`\n— Viewport ${viewport.tag} (${viewport.width}×${viewport.height}) —`);
  if (viewport.full) await fullJourney(browser, viewport);
  else await coreJourney(browser, viewport);
}
await browser.close();

writeFileSync(path.join(OUT, 'overflow-report.txt'), `${overflowReport.join('\n')}\n`);
console.log(`\nCapturas en ${OUT}`);
console.log('Overflow por vista/viewport en overflow-report.txt');
