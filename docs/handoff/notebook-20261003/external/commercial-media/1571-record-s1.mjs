// Regraba SOLO la sesión S1 (cliente) con coreografía de checkout corregida:
// pausa en direcciones/forma de pago antes de bajar al botón de confirmar.
// Fusiona marks.s1 y cap-s1 en el marks.json existente (s2/s3 quedan intactos).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const REPO = 'C:/Users/marco/dev/la-taba-business-panel-automation';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');
const helpers = await import(pathToFileURL(REPO + '/tests/e2e/helpers.mjs').href);

const BASE = 'http://127.0.0.1:8093';
const TAKES = 'D:/1212/taba-promo-v2/takes';
const CAP = `${TAKES}/cap-s1`;
fs.rmSync(CAP, { recursive: true, force: true });

const log = [];
const mark = (name) => { log.push({ name, wall: Date.now() }); console.log('beat:', name); };

let cap = null;
async function startCapture(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const state = { on: true, count: 0, cdp };
  state.loop = (async () => {
    while (state.on) {
      const a = Date.now();
      try {
        const r = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg', quality: 86, fromSurface: true, optimizeForSpeed: true,
          clip: { x: 0, y: 0, width: 432, height: 768, scale: 2.5 },
        });
        const ts = Math.round((a + Date.now()) / 2);
        fs.promises.writeFile(`${dir}/${ts}.jpg`, Buffer.from(r.data, 'base64')).catch(() => {});
        state.count += 1;
      } catch (_) {
        if (!state.on) break;
        await new Promise((res) => { setTimeout(res, 60); });
      }
    }
  })();
  cap = state;
}
async function stopCapture() {
  if (!cap) return;
  cap.on = false;
  await cap.loop;
  try { await cap.cdp.detach(); } catch (_) { /* ya cerrada */ }
  console.log('cuadros capturados:', cap.count);
  cap = null;
}

async function ripples(page) {
  await page.addInitScript(() => {
    window.addEventListener('pointerdown', (e) => {
      try {
        const r = document.createElement('div');
        r.style.cssText = `position:fixed;left:${e.clientX - 26}px;top:${e.clientY - 26}px;`
          + 'width:52px;height:52px;border-radius:50%;pointer-events:none;z-index:2147483000;'
          + 'background:rgba(255,255,255,0.30);border:2.5px solid rgba(255,255,255,0.85);'
          + 'box-shadow:0 0 0 1.5px rgba(0,0,0,0.25);transform:scale(.5);opacity:1;'
          + 'transition:transform .4s cubic-bezier(.2,.7,.3,1),opacity .44s ease-out;';
        document.body.appendChild(r);
        requestAnimationFrame(() => { r.style.transform = 'scale(1.3)'; r.style.opacity = '0'; });
        setTimeout(() => r.remove(), 520);
      } catch (_) { /* nunca romper la página */ }
    }, { capture: true });
  });
}

async function smoothScroll(page, px, ms) {
  await page.evaluate(({ px: dy, ms: dur }) => new Promise((res) => {
    const y0 = window.scrollY; const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, y0 + dy * ease(t));
      if (t < 1) requestAnimationFrame(frame); else res();
    };
    requestAnimationFrame(frame);
  }), { px, ms });
}

async function scrollToSel(page, selector, ms = 900, block = 'center') {
  await page.evaluate(({ sel, dur, blk }) => new Promise((res) => {
    const el = document.querySelector(sel);
    if (!el) return res();
    const r = el.getBoundingClientRect();
    const target = blk === 'center'
      ? window.scrollY + r.top - (window.innerHeight - r.height) / 2
      : window.scrollY + r.top - 96;
    const y0 = window.scrollY; const dy = target - y0; const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, y0 + dy * ease(t));
      if (t < 1) requestAnimationFrame(frame); else res();
    };
    requestAnimationFrame(frame);
  }), { sel: selector, dur: ms, blk: block });
}

const settle = (page, ms) => page.waitForTimeout(ms);
async function blurActive(page) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.getSelection?.()?.removeAllRanges?.(); });
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
  isMobile: true, hasTouch: true, serviceWorkers: 'block',
  locale: 'es-AR', timezoneId: 'America/Argentina/Salta',
});
await ctx.route('**/js/approved-beverage-demo-data.js', async (route) => {
  const body = fs.readFileSync(REPO + '/js/approved-beverage-demo-data.js', 'utf8')
    .replaceAll('"RETAILER_SOLO_REFERENCIA"', '"LICENCIA_COMERCIAL"');
  await route.fulfill({ status: 200, contentType: 'text/javascript', body });
});

const page = await ctx.newPage();
await ripples(page);
await helpers.skipInstallInvitation(page);

await helpers.gotoDemoReset(page, `${BASE}/?reset=1&demo=1#catalog`);
await page.locator('[data-product-grid] .product-card').first().waitFor();
for (const y of [0, 500, 1000, 1500, 1000, 500, 0]) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await settle(page, 260);
}
await page.evaluate(async () => {
  const visible = [...document.images].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  });
  await Promise.race([
    Promise.all(visible.map((i) => i.decode().catch(() => undefined))),
    new Promise((res) => { setTimeout(res, 2500); }),
  ]);
});
console.log('s1: prep listo');
await helpers.seedCheckoutProfile(page, { name: 'Julieta Herrera', phone: '2995550107' });
await page.locator('.mobile-nav [data-nav-view="home"]').click();
await settle(page, 1400);
await page.evaluate(() => window.scrollTo(0, 0));
await blurActive(page);
await settle(page, 400);

await startCapture(page, CAP);
await settle(page, 300);

mark('b1-home');
await settle(page, 1050);
mark('tap-catalogo');
await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
await settle(page, 1100);

mark('b2-gondola');
await settle(page, 450);
mark('scroll-down');
await smoothScroll(page, 470, 1600);
await settle(page, 420);
mark('scroll-up');
await smoothScroll(page, -470, 900);
await settle(page, 380);

mark('b3-ficha');
await settle(page, 200);
mark('tap-ficha');
await page.locator('[data-product-grid] [data-product-detail] >> visible=true').first().click();
await page.locator('[data-product-modal]').waitFor({ state: 'visible' });
await settle(page, 1200);
mark('tap-agregar');
await page.locator('[data-product-modal] [data-add-product]').click();
await settle(page, 750);

mark('b4-cantidad');
await settle(page, 250);
mark('tap-mas');
await page.locator('[data-cart-inc="red-bull-original-lata-250ml"] >> visible=true').first().click();
await settle(page, 700);
mark('tap-carrito');
await page.locator('[data-floating-cart]').click();
await page.locator('[data-cart-list] .cart-item').first().waitFor({ state: 'visible' });
await settle(page, 500);
mark('prep-checkout');
await page.getByLabel('Delivery').check().catch(() => {});
const radio = page.locator('[data-profile-checkout] .profile-address-card input[type="radio"]').first();
await radio.check().catch(() => {});
const paymentField = page.getByLabel('Forma de pago');
if (await paymentField.count()) await paymentField.selectOption('cash').catch(() => {});
await blurActive(page);
await page.evaluate(() => window.scrollTo(0, 0));
await settle(page, 450);

// B5 · carrito arriba, después el resumen del checkout ANCLADO al botón
// visible de confirmar (hay un duplicado oculto en el DOM: sólo vale el rect
// que devuelve Playwright).
mark('b5-carrito');
await settle(page, 1000);
const confirmBtn = page.getByRole('button', { name: /Confirmar pedido/i });
const smoothTo = (targetExpr, ms) => page.evaluate(({ target, dur }) => new Promise((res) => {
  const y0 = window.scrollY; const dy = target - y0; const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    window.scrollTo(0, y0 + dy * ease(t));
    if (t < 1) requestAnimationFrame(frame); else res();
  };
  requestAnimationFrame(frame);
}), { target: targetExpr, dur: ms });

const box1 = await confirmBtn.boundingBox();
const scrollY1 = await page.evaluate(() => window.scrollY);
mark('scroll-checkout');
await smoothTo(scrollY1 + box1.y - 470, 1400);
await settle(page, 1000);
mark('checkout-visto');

// B6 · panear hasta centrar el botón, tap y toast
mark('b6-confirmar');
const box2 = await confirmBtn.boundingBox();
const scrollY2 = await page.evaluate(() => window.scrollY);
await smoothTo(scrollY2 + box2.y - (768 - box2.height) / 2, 900);
await settle(page, 500);
mark('tap-confirmar');
await confirmBtn.click();
await helpers.waitForToast(page, /Pedido confirmado/);
mark('confirmado');
await settle(page, 1600);

mark('b7-confirmado');
await settle(page, 1400);
mark('fin-s1');

await stopCapture();
const order = await page.evaluate(async () => {
  const { getActiveOrder } = await import(new URL('js/orders.js', location.href).href);
  const o = getActiveOrder();
  return { id: o.id, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, name: o.customerName, phone: o.customerPhone, items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })) };
});
await page.close();
await ctx.close();
await browser.close();

const data = JSON.parse(fs.readFileSync(`${TAKES}/marks.json`, 'utf8'));
if (data.order.id !== order.id || data.order.total !== order.total) {
  console.error('EL PEDIDO NO COINCIDE con s2/s3:', JSON.stringify(order), 'vs', JSON.stringify(data.order));
  process.exit(1);
}
data.marks.s1 = log;
fs.writeFileSync(`${TAKES}/marks.json`, JSON.stringify(data, null, 2));
console.log(JSON.stringify({ order, beats: log.length }, null, 2));
