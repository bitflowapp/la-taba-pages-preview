// Verificación de las 4 mecánicas del video antes del storyboard fino.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const REPO = 'C:/Users/marco/dev/la-taba-business-panel-automation';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');
const helpers = await import(pathToFileURL(REPO + '/tests/e2e/helpers.mjs').href);
const fixtures = await import(pathToFileURL(REPO + '/scripts/lib/business-panel-fixtures.mjs').href);

const BASE = 'http://127.0.0.1:8093';
const OUT = 'D:/1212/taba-promo-v2/frames';
const findings = {};

// El espejo de producción: los SKU unitarios cuyas fotos reales están
// publicadas en el catálogo productivo. Sólo en el navegador de grabación.
async function mirrorPublishedPhotos(context) {
  await context.route('**/js/approved-beverage-demo-data.js', async (route) => {
    const body = fs.readFileSync(REPO + '/js/approved-beverage-demo-data.js', 'utf8')
      .replaceAll('"RETAILER_SOLO_REFERENCIA"', '"LICENCIA_COMERCIAL"');
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
}

const browser = await chromium.launch({ headless: true });

// ── V1+V2: mundo demo con fotos espejadas + simulación ──
{
  const context = await browser.newContext({
    viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
    isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'es-AR',
  });
  await mirrorPublishedPhotos(context);
  const page = await context.newPage();
  await helpers.skipInstallInvitation(page);

  await helpers.gotoDemoReset(page, `${BASE}/?reset=1&demo=1#catalog`);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/v1-catalogo-fotos.png` });
  findings.catalogImgs = await page.evaluate(() => (
    [...document.querySelectorAll('[data-product-grid] .product-card img')].slice(0, 6)
      .map((i) => i.getAttribute('src').split('/').slice(-2).join('/'))
  ));

  // Modal con foto
  await page.locator('[data-product-grid] [data-product-detail] >> visible=true').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/v1-modal-foto.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Pedido completo (rápido, sin capturas): carrito → checkout → confirmar
  const productId = await helpers.seedCartAboveMinimum(page);
  findings.productId = productId;
  await page.locator('[data-floating-cart]').click();
  await helpers.fillCheckout(page, { name: 'Julieta Herrera', phone: '2995551234', payment: 'cash', deliveryMode: 'delivery' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/v1-carrito-foto.png` });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await helpers.waitForToast(page, /Pedido confirmado/);
  const orderId = await page.evaluate(async () => {
    const { getActiveOrder } = await import(new URL('js/orders.js', location.href).href);
    return getActiveOrder()?.id || '';
  });
  findings.orderId = orderId;

  // Negocio demo: avanzar dos veces (off-camera en el video)
  await page.goto(`${BASE}/?demo=1#business`);
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator(`[data-inbox-order="${orderId}"]`).waitFor({ state: 'visible' });
  await page.locator(`[data-inbox-order="${orderId}"] [data-prep-minutes]`).selectOption('20');
  await page.locator(`[data-order-advance="${orderId}"]`).click();
  await page.waitForTimeout(500);
  await page.locator(`[data-order-advance="${orderId}"]`).click();
  await page.waitForTimeout(500);

  // Rider: aceptar → salir → iniciar recorrido
  await page.goto(`${BASE}/?demo=1#rider`);
  await page.locator(`[data-rider-accept="${orderId}"]`).click();
  await page.waitForTimeout(400);
  await page.locator(`[data-delivery-leave="${orderId}"]`).click();
  await page.waitForTimeout(400);
  const simStart = page.locator('[data-sim-start]');
  findings.simStartVisible = await simStart.isVisible().catch(() => false);
  if (findings.simStartVisible) await simStart.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/v2-rider-recorrido.png` });

  // Cambio de vista SIN reload → el timer sigue vivo en esta página
  await page.evaluate(() => { window.location.hash = '#tracking'; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/v2-tracking-early.png` });

  const markerAt = async () => page.evaluate(() => {
    const el = document.querySelector('[data-tracking-panel] .rider-marker, [data-tracking-panel] [class*="rider"], .maplibregl-marker');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y) };
  });
  const a = await markerAt();
  await page.waitForTimeout(4000);
  const b = await markerAt();
  findings.markerMoved = JSON.stringify(a) !== JSON.stringify(b);
  findings.markerA = a; findings.markerB = b;
  findings.simState = await page.evaluate(async () => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const s = getState().simulation;
    return s ? { running: s.running, progress: Number(s.progress).toFixed(3), eta: s.etaMinutes, source: s.source, speed: s.speed || 1 } : null;
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/v2-tracking-mid.png` });

  // Esperar llegada (progreso 1 → arriving) y ver el PIN
  await page.waitForTimeout(14000);
  await page.screenshot({ path: `${OUT}/v4-tracking-llego.png` });
  findings.arrivedHero = await page.locator('[data-tracking-panel] .tracking-hero h1').textContent().catch(() => null);
  const codeCard = page.locator('[data-delivery-code-card]');
  findings.deliveryCodeVisible = await codeCard.isVisible().catch(() => false);
  if (findings.deliveryCodeVisible) {
    await codeCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/v4-delivery-code.png` });
  }
  await context.close();
}

// ── V3: bandeja de producción con el MISMO pedido entrando en vivo ──
{
  const context = await browser.newContext({
    viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
    isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'es-AR',
  });
  const page = await context.newPage();
  await fixtures.instalarDatosDePrueba(page, { conSesion: true });

  // Servidor con estado: arranca con 3 pedidos en curso (sin sección atención)
  const estado = { ordenes: [], transiciones: [] };
  const ahora = Date.now();
  const hace = (min) => new Date(ahora - min * 60_000).toISOString();
  const pedido = (n, code, status, min, nombre, tel, items, subtotal, extra = {}) => ({
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    public_code: code, business_id: fixtures.BUSINESS_ID, status,
    created_at: hace(min), updated_at: hace(Math.max(0, min - 1)), revision: 1,
    currency_code: 'ARS', payment_method: 'cash', delivery_mode: 'delivery',
    customer_name: nombre, customer_phone: tel,
    address_label: extra.address || 'Mendoza 851, Centro, Neuquén',
    delivery_street: 'Mendoza', delivery_street_number: '851',
    delivery_city: 'Neuquén', delivery_province: 'Neuquén',
    customer_notes: extra.notes || null,
    subtotal, delivery_fee: 1990, discount_total: 0, total: subtotal + 1990,
    assigned_rider_user_id: extra.rider || null,
    order_items: items, order_events: [], order_combos: [],
  });
  const it = (id, name, q, price) => ({ id, product_uuid: `99999999-9999-4999-8999-9999999999${id}`, name, product_name: name, quantity: q, unit_price: price, unit: 'unidad', unit_label: 'unidad' });
  estado.ordenes = [
    pedido(1, 'LT-0038', 'preparing', 12, 'Sofía Quintriqueo', '2995550103', [it('41', 'Speed Unlimited 473 ml', 6, 2925), it('42', 'Agua mineral 1,5 L', 2, 1800)], 21150, { address: 'Bahía Blanca 1240, Alta Barda, Neuquén' }),
    pedido(2, 'LT-0039', 'ready', 22, 'Diego Arriagada', '2995550104', [it('43', 'Gaseosa cola 2,25 L', 4, 2400)], 9600, { rider: fixtures.RIDER_A }),
    pedido(3, 'LT-0040', 'on_the_way', 31, 'Valentina Ruiz', '2995550105', [it('44', 'Monster Mango Loco 473 ml', 4, 3390)], 13560, { rider: fixtures.RIDER_A, address: 'Chubut 455, Villa Florencia, Neuquén' }),
  ];
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
      if (porCodigo || porId) return json(estado.ordenes.find((o) => o.public_code === porCodigo || o.id === porId) || null);
      return json(estado.ordenes);
    }
    if (p.includes('/rpc/transition_order')) {
      const cuerpo = JSON.parse(route.request().postData() || '{}');
      estado.transiciones.push(cuerpo);
      const fila = estado.ordenes.find((o) => o.id === cuerpo.p_order_id);
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
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/v3-bandeja-base.png` });

  // El pedido del cliente ENTRA en vivo
  estado.ordenes.push(pedido(9, 'LT-0041', 'submitted', 0, 'Julieta Herrera', '2995551234',
    [it('45', 'Red Bull Energy Drink 250 ml', 2, 3576)], 7152,
    { address: 'Avenida Argentina 450, Neuquén Capital', notes: 'Tocar timbre, departamento 4B.' }));
  await page.locator('[data-order-card="LT-0041"]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/v3-bandeja-nuevo.png` });
  findings.trayHeadline = await page.locator('[data-order-tray-headline]').textContent().catch(() => null);
  findings.soundBadge = await page.locator('[data-sound-count]').textContent().catch(() => null);

  // Aceptar → pasa a preparando
  await page.locator('[data-order-card="LT-0041"] [data-production-business-next]').click();
  await page.locator('[data-tray-section="preparando"] [data-order-card="LT-0041"]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/v3-bandeja-aceptado.png` });
  findings.transiciones = estado.transiciones.map((t) => t.p_new_status);
  await context.close();
}

await browser.close();
console.log(JSON.stringify(findings, null, 2));
