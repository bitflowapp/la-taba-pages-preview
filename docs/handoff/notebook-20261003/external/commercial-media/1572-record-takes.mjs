// Graba las 3 sesiones del video TABA como secuencias JPEG 1080x1920 (píxeles
// físicos vía Page.captureScreenshot con clip.scale=2.5) + marks.json con
// timestamps de pared. Cada cuadro se llama <epoch_ms>.jpg → el montaje corta
// por reloj, sin claquetas.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const REPO = 'C:/Users/marco/dev/la-taba-business-panel-automation';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');
const helpers = await import(pathToFileURL(REPO + '/tests/e2e/helpers.mjs').href);
const fixtures = await import(pathToFileURL(REPO + '/scripts/lib/business-panel-fixtures.mjs').href);

const BASE = 'http://127.0.0.1:8093';
const TAKES = 'D:/1212/taba-promo-v2/takes';
fs.mkdirSync(TAKES, { recursive: true });

const marks = { s1: [], s2: [], s3: [] };
let currentLog = null;
const mark = (name) => { currentLog.push({ name, wall: Date.now() }); console.log('beat:', name); };

const VIEW = {
  viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
  isMobile: true, hasTouch: true, serviceWorkers: 'block',
  locale: 'es-AR', timezoneId: 'America/Argentina/Salta',
};

// ── captura continua ──
let cap = null;
async function startCapture(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const state = { on: true, count: 0 };
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
  state.cdp = cdp;
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
      } catch (_) { /* nunca romper la página por el indicador */ }
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

async function mirrorPublishedPhotos(context) {
  await context.route('**/js/approved-beverage-demo-data.js', async (route) => {
    const body = fs.readFileSync(REPO + '/js/approved-beverage-demo-data.js', 'utf8')
      .replaceAll('"RETAILER_SOLO_REFERENCIA"', '"LICENCIA_COMERCIAL"');
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
}

const browser = await chromium.launch({ headless: true });
const result = { order: null, caps: { s1: `${TAKES}/cap-s1`, s2: `${TAKES}/cap-s2`, s3: `${TAKES}/cap-s3` } };

// ════════ CONTEXTO A · MUNDO DEMO ════════
const ctxA = await browser.newContext(VIEW);
await mirrorPublishedPhotos(ctxA);

// ── S1 · CLIENTE ──
{
  currentLog = marks.s1;
  const page = await ctxA.newPage();
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

  await startCapture(page, result.caps.s1);
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

  mark('b5-carrito');
  await settle(page, 900);
  mark('scroll-checkout');
  await scrollToSel(page, '[data-profile-checkout]', 1350, 'top');
  await settle(page, 700);

  mark('b6-confirmar');
  await page.evaluate(() => new Promise((res) => {
    const btn = [...document.querySelectorAll('button')].find((b) => /confirmar pedido/i.test(b.textContent || '') && b.getBoundingClientRect().width > 0);
    if (!btn) return res();
    const r = btn.getBoundingClientRect();
    const target = window.scrollY + r.top - (window.innerHeight - r.height) / 2;
    const y0 = window.scrollY; const dy = target - y0; const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / 950);
      window.scrollTo(0, y0 + dy * ease(t));
      if (t < 1) requestAnimationFrame(frame); else res();
    };
    requestAnimationFrame(frame);
  }));
  await settle(page, 450);
  mark('tap-confirmar');
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await helpers.waitForToast(page, /Pedido confirmado/);
  mark('confirmado');
  await settle(page, 1600);

  mark('b7-confirmado');
  await settle(page, 550);
  mark('scroll-timeline');
  await smoothScroll(page, 210, 950);
  await settle(page, 1300);
  mark('fin-s1');

  await stopCapture();
  result.order = await page.evaluate(async () => {
    const { getActiveOrder } = await import(new URL('js/orders.js', location.href).href);
    const o = getActiveOrder();
    return { id: o.id, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, name: o.customerName, phone: o.customerPhone, items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice })) };
  });
  await page.close();
}

// ── S3 · REPARTO + SEGUIMIENTO (misma página para prep y cámara) ──
{
  currentLog = marks.s3;
  const page = await ctxA.newPage();
  await ripples(page);
  const oid = result.order.id;

  await page.goto(`${BASE}/?demo=1#business`);
  const pinGate = page.locator('[data-open-pin][data-admin-target="business"]');
  if (await pinGate.isVisible().catch(() => false)) {
    await pinGate.click();
    await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
  }
  await page.locator(`[data-inbox-order="${oid}"]`).waitFor({ state: 'visible' });
  await page.locator(`[data-inbox-order="${oid}"] [data-prep-minutes]`).selectOption('20');
  await page.locator(`[data-order-advance="${oid}"]`).click();
  await page.waitForTimeout(700);
  await page.locator(`[data-order-advance="${oid}"]`).click();
  await page.waitForTimeout(700);
  console.log('s3: pedido listo para repartir');

  await page.goto(`${BASE}/?demo=1#rider`);
  await page.locator(`[data-rider-accept="${oid}"]`).waitFor({ state: 'visible' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await blurActive(page);
  await settle(page, 700);

  await startCapture(page, result.caps.s3);
  await settle(page, 300);

  mark('b11-rider');
  await settle(page, 1100);
  mark('tap-aceptar-entrega');
  await page.locator(`[data-rider-accept="${oid}"]`).click();
  await settle(page, 1300);

  mark('b12-salida');
  await settle(page, 200);
  mark('tap-en-camino');
  await page.locator(`[data-delivery-leave="${oid}"]`).click();
  await settle(page, 950);
  mark('tap-iniciar-recorrido');
  await page.locator('[data-sim-start]').click();
  await settle(page, 650);

  mark('b13-mapa');
  mark('hash-tracking');
  await page.evaluate(() => { window.location.hash = '#tracking'; });
  await page.locator('[data-tracking-panel] [data-real-map]').waitFor({ state: 'visible', timeout: 20_000 });
  mark('mapa-visible');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-delivery-code-card]').waitFor({ state: 'visible', timeout: 45_000 });
  mark('llego');
  await settle(page, 1500);
  mark('scroll-codigo');
  await scrollToSel(page, '[data-delivery-code-card]', 1150, 'center');
  await settle(page, 2200);
  mark('fin-s3');

  await stopCapture();
  await page.close();
}
await ctxA.close();

// ════════ CONTEXTO B · PANEL OPERATIVO ════════
{
  currentLog = marks.s2;
  const ctxB = await browser.newContext(VIEW);
  const page = await ctxB.newPage();
  await ripples(page);
  await fixtures.instalarDatosDePrueba(page, { conSesion: true });

  const o = result.order;
  const ahora = Date.now();
  const hace = (min) => new Date(ahora - min * 60_000).toISOString();
  const it = (id, name, q, price) => ({ id, product_uuid: `99999999-9999-4999-8999-9999999999${id}`, name, product_name: name, quantity: q, unit_price: price, unit: 'unidad', unit_label: 'unidad' });
  const pedido = (n, code, status, min, nombre, tel, items, subtotal, extra = {}) => ({
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    public_code: code, business_id: fixtures.BUSINESS_ID, status,
    created_at: hace(min), updated_at: hace(Math.max(0, min - 1)), revision: 1,
    currency_code: 'ARS', payment_method: 'cash', delivery_mode: 'delivery',
    customer_name: nombre, customer_phone: tel,
    address_label: extra.address_label || 'Mendoza 851, Centro, Neuquén',
    delivery_street: extra.street || 'Mendoza', delivery_street_number: extra.number || '851',
    delivery_city: extra.city || 'Neuquén', delivery_province: 'Neuquén',
    customer_notes: null,
    subtotal, delivery_fee: 1990, discount_total: 0, total: subtotal + 1990,
    assigned_rider_user_id: extra.rider || null,
    order_items: items, order_events: [], order_combos: [],
  });
  const estado = {
    ordenes: [
      pedido(1, 'LT-0038', 'preparing', 12, 'Sofía Quintriqueo', '2995550103',
        [it('41', 'Speed Unlimited 473 ml', 6, 2925), it('42', 'Agua sin gas 1,5 L', 2, 1800)], 21150,
        { address_label: 'Bahía Blanca 1240, Alta Barda, Neuquén', street: 'Bahía Blanca', number: '1240' }),
      pedido(2, 'LT-0039', 'ready', 22, 'Diego Arriagada', '2995550104',
        [it('43', 'Gaseosa cola 2,25 L', 4, 2400)], 9600, { rider: fixtures.RIDER_A }),
      pedido(3, 'LT-0040', 'on_the_way', 31, 'Valentina Ruiz', '2995550105',
        [it('44', 'Monster Mango Loco 473 ml', 4, 3390)], 13560,
        { rider: fixtures.RIDER_A, address_label: 'Chubut 455, Villa Florencia, Neuquén', street: 'Chubut', number: '455' }),
    ],
    transiciones: [],
  };
  await page.addInitScript((ms) => {
    const config = globalThis.__LA_TABA_RUNTIME_CONFIG__;
    if (config?.repository) config.repository.pollMs = ms;
    try { delete globalThis.__TAURI__; } catch (_) { globalThis.__TAURI__ = undefined; }
  }, 1500);
  await page.route(`${fixtures.SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.includes('/rest/v1/orders')) {
      const porCodigo = String(url.searchParams.get('public_code') || '').replace(/^eq\./, '');
      const porId = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
      if (porCodigo || porId) return json(estado.ordenes.find((x) => x.public_code === porCodigo || x.id === porId) || null);
      return json(estado.ordenes);
    }
    if (p.includes('/rpc/transition_order')) {
      const cuerpo = JSON.parse(route.request().postData() || '{}');
      estado.transiciones.push(cuerpo);
      const fila = estado.ordenes.find((x) => x.id === cuerpo.p_order_id);
      if (!fila) return json(null);
      fila.status = cuerpo.p_new_status; fila.revision += 1; fila.updated_at = new Date().toISOString();
      return json(fila);
    }
    return route.fallback();
  });

  await page.goto(`${BASE}/#business`);
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-production-orders-view]:visible').first().click();
  await page.locator('[data-order-tray]').waitFor({ state: 'visible', timeout: 15_000 });
  const sound = page.locator('[data-sound-toggle]');
  if (await sound.isVisible().catch(() => false)) {
    await sound.click().catch(() => {});
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await blurActive(page);
  await settle(page, 1100);

  await startCapture(page, result.caps.s2);
  await settle(page, 300);

  mark('b8-panel');
  await settle(page, 850);
  mark('scroll-cola');
  await smoothScroll(page, 560, 1600);
  await settle(page, 500);
  mark('scroll-vuelta');
  await smoothScroll(page, -560, 1000);
  await settle(page, 400);

  mark('b9-entra');
  await settle(page, 250);
  mark('push-pedido');
  estado.ordenes.push(pedido(9, o.id, 'submitted', 0, o.name, o.phone,
    o.items.map((x, i) => it(`5${i}`, x.name, x.quantity, x.unitPrice)), o.subtotal,
    { address_label: 'Avenida Argentina 450, Neuquén Capital', street: 'Avenida Argentina', number: '450', city: 'Neuquén Capital' }));
  await page.locator(`[data-order-card="${o.id}"]`).waitFor({ state: 'visible', timeout: 20_000 });
  mark('pedido-visible');
  await settle(page, 2800);

  mark('b10-aceptar');
  await settle(page, 350);
  mark('tap-aceptar');
  await page.locator(`[data-order-card="${o.id}"] [data-production-business-next]`).click();
  await page.locator(`[data-tray-section="preparando"] [data-order-card="${o.id}"]`).waitFor({ state: 'visible', timeout: 20_000 });
  mark('en-preparando');
  await settle(page, 500);
  mark('scroll-preparando');
  await scrollToSel(page, `[data-tray-section="preparando"] [data-order-card="${o.id}"]`, 950, 'center');
  await settle(page, 1500);
  mark('fin-s2');

  await stopCapture();
  await page.close();
  await ctxB.close();
}

await browser.close();
fs.writeFileSync(`${TAKES}/marks.json`, JSON.stringify({ marks, ...result }, null, 2));
console.log(JSON.stringify({ order: result.order, beats: { s1: marks.s1.length, s2: marks.s2.length, s3: marks.s3.length } }, null, 2));
