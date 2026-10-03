// Auditoria de autozoom Safari: mide font-size computado de TODOS los
// controles editables reales en cada superficie de la app, usando el motor
// WebKit real (no Chromium) para reproducir el comportamiento de iOS Safari.
// Vive FUERA del repositorio de producto.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..');
const BASE = process.env.TABA_BASE || 'http://127.0.0.1:8099';
const device = devices['iPhone 13'];

const browser = await webkit.launch();
const report = [];

async function newPage(seedPayload) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Un service worker de una corrida anterior puede quedar "esperando" en
  // este origen y disparar el banner de actualización, que no forma parte de
  // la auditoría y tapa controles con pointer-events. Se desregistra antes de
  // cada navegación para partir de un estado limpio, igual que un dispositivo
  // que instala la PWA por primera vez.
  await context.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      }).catch(() => {});
    }
  });
  if (seedPayload) {
    await page.addInitScript((payload) => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(payload.state));
        if (payload.admin) sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
      } catch (_) { /* ignore */ }
    }, seedPayload);
  }
  return { context, page, consoleErrors, pageErrors };
}

// El banner de actualización de la PWA es ajeno a esta auditoría: en este
// servidor local reutilizado entre corridas puede quedar un service worker
// "waiting" de una versión anterior de sw.js y el banner tapa controles con
// pointer-events. Se oculta antes de interactuar, igual que haría el usuario
// tocando "Actualizar ahora" o simplemente ignorándolo.
async function dismissUpdateBanner(page) {
  await page.evaluate(() => {
    const banner = document.querySelector('[data-app-update-banner]');
    if (banner) banner.hidden = true;
  }).catch(() => {});
}

async function auditPage(page, label) {
  await dismissUpdateBanner(page);
  const controls = await page.evaluate(() => {
    const isVisible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const nodes = [...document.querySelectorAll('input, select, textarea')]
      .filter((n) => n.type !== 'hidden')
      .filter(isVisible);
    return nodes.map((n) => {
      const cs = getComputedStyle(n);
      const rect = n.getBoundingClientRect();
      return {
        tag: n.tagName.toLowerCase(),
        type: n.type || '',
        name: n.name || '',
        id: n.id || '',
        classes: n.className || '',
        placeholder: n.placeholder || '',
        ariaLabel: n.getAttribute('aria-label') || '',
        fontSize: cs.fontSize,
        fontSizePx: Number.parseFloat(cs.fontSize),
        disabled: n.disabled,
        textSizeAdjust: cs.webkitTextSizeAdjust || cs.textSizeAdjust || '',
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    });
  });
  for (const c of controls) {
    report.push({ view: label, ...c, state: 'default' });
  }
  return controls;
}

async function auditFocusStates(page, label) {
  await dismissUpdateBanner(page);
  const handles = await page.$$('input:not([type="hidden"]), select, textarea');
  for (const handle of handles) {
    const visible = await handle.isVisible();
    if (!visible) continue;
    try {
      await handle.focus({ timeout: 2000 });
    } catch (_) {
      continue;
    }
    const info = await handle.evaluate((n) => {
      const cs = getComputedStyle(n);
      return {
        tag: n.tagName.toLowerCase(), type: n.type || '', name: n.name || '',
        classes: n.className || '', fontSize: cs.fontSize, fontSizePx: Number.parseFloat(cs.fontSize),
      };
    });
    const scale = await page.evaluate(() => window.visualViewport ? window.visualViewport.scale : null);
    report.push({ view: label, ...info, state: 'focus', visualViewportScale: scale });
    await handle.evaluate((n) => n.blur());
  }
}

// ---------- Home / búsqueda ----------
{
  const { context, page, consoleErrors, pageErrors } = await newPage(null);
  await page.goto(`${BASE}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-view="home"] .home-catalog-card');
  await auditPage(page, 'home');
  await auditFocusStates(page, 'home:focus');
  if (consoleErrors.length || pageErrors.length) console.log('home errores', consoleErrors, pageErrors);
  await context.close();
}

// ---------- Catálogo ----------
{
  const { context, page } = await newPage(null);
  await page.goto(`${BASE}/?demo=1#catalog`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-product-grid] .product-card');
  await auditPage(page, 'catalog');
  await auditFocusStates(page, 'catalog:focus');
  // Detalle del producto (bottom sheet)
  await page.locator('[data-product-grid] [data-product-detail]').first().click();
  await page.waitForSelector('[data-product-modal][open]').catch(() => {});
  await auditPage(page, 'catalog:product-detail-sheet');
  await context.close();
}

// ---------- Carrito / checkout ----------
{
  const { context, page } = await newPage(null);
  await page.goto(`${BASE}/?demo=1#catalog`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-product-grid] .product-card');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-floating-cart]').click();
  await page.waitForSelector('[data-checkout-form]:not([hidden])');
  await auditPage(page, 'checkout');
  await auditFocusStates(page, 'checkout:focus');
  // Abrir "Agregar indicaciones" para exponer el textarea
  await page.locator('.checkout-instructions summary').click().catch(() => {});
  await auditPage(page, 'checkout:instructions-open');
  await auditFocusStates(page, 'checkout:instructions-open:focus');
  await context.close();
}

// ---------- Perfil ----------
{
  const { context, page } = await newPage(null);
  await page.goto(`${BASE}/?demo=1#profile`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-customer-profile]');
  await auditPage(page, 'profile');
  // Editar datos personales
  const editButtons = page.locator('[data-customer-profile] button', { hasText: 'Editar' });
  const editCount = await editButtons.count();
  if (editCount) {
    await editButtons.first().click();
    await page.waitForTimeout(300);
    await auditPage(page, 'profile:edit-personal');
    await auditFocusStates(page, 'profile:edit-personal:focus');
  }
  await context.close();
}

// ---------- Direcciones (agregar) ----------
{
  const { context, page } = await newPage(null);
  await page.goto(`${BASE}/?demo=1#profile`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-customer-profile]');
  const addAddress = page.getByRole('button', { name: /Agregar dirección/i });
  if (await addAddress.count()) {
    await addAddress.first().click();
    await page.waitForTimeout(300);
    await auditPage(page, 'profile:add-address');
    await auditFocusStates(page, 'profile:add-address:focus');
  }
  await context.close();
}

// ---------- PIN (negocio / rider) ----------
{
  const { context, page } = await newPage(null);
  await page.goto(`${BASE}/?demo=1#business`, { waitUntil: 'networkidle' });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.waitForSelector('[data-pin-modal][open]').catch(() => {});
  await auditPage(page, 'pin-modal');
  await auditFocusStates(page, 'pin-modal:focus');
  await context.close();
}

// ---------- Negocio (autenticado, catálogo/config) ----------
{
  const { context, page } = await newPage({ state: seedBusinessState(), admin: true });
  await page.goto(`${BASE}/?demo=1#business`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-order-inbox]');
  await auditPage(page, 'business:orders');
  await auditFocusStates(page, 'business:orders:focus');
  await page.locator('[data-business-view="local"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-scroll-catalog]').click();
  await page.waitForTimeout(300);
  await auditPage(page, 'business:catalog');
  await auditFocusStates(page, 'business:catalog:focus');
  const newProduct = page.locator('[data-catalog-new-product], [data-catalog-add-product]');
  if (await newProduct.count()) {
    await newProduct.first().click();
    await page.waitForTimeout(300);
    await auditPage(page, 'business:catalog:new-product-form');
    await auditFocusStates(page, 'business:catalog:new-product-form:focus');
  }
  await page.locator('[data-business-view="local"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-scroll-business-setup]').click();
  await page.waitForTimeout(300);
  await auditPage(page, 'business:setup');
  await auditFocusStates(page, 'business:setup:focus');
  await context.close();
}

// ---------- Rider ----------
{
  const { context, page } = await newPage(null);
  await page.goto(`${BASE}/?demo=1#rider`, { waitUntil: 'networkidle' });
  await page.locator('[data-open-pin][data-admin-target="rider"]').click();
  await page.waitForSelector('[data-pin-modal][open]').catch(() => {});
  await auditPage(page, 'rider:pin-modal');
  await context.close();
}

// ---------- Rider: confirmar código de entrega ----------
{
  const { context, page } = await newPage({ state: seedArrivingState(), admin: true });
  await page.goto(`${BASE}/?demo=1#rider`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-delivery-panel]');
  await page.waitForSelector('[data-delivery-code-input]', { timeout: 5000 }).catch(() => {});
  await auditPage(page, 'rider:delivery-code');
  await auditFocusStates(page, 'rider:delivery-code:focus');
  await context.close();
}

await browser.close();

fs.writeFileSync(path.join(outDir, 'autozoom-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const under16 = report.filter((r) => r.fontSizePx < 16);
console.log(`controles auditados=${report.length} bajo-16px=${under16.length}`);
for (const r of under16) {
  console.log(`FALLA ${r.view} [${r.state}] ${r.tag}${r.type ? `[${r.type}]` : ''} name="${r.name}" class="${r.classes}" font-size=${r.fontSize}`);
}
if (!under16.length) console.log('Todos los controles editables tienen font-size >= 16px.');

function seedArrivingState() {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [{
      id: 'LT-2050',
      customerName: 'Cliente Demo',
      customerPhone: '2990000001',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo al recibir',
      paymentMethodCode: 'cash',
      notes: '',
      createdAt: at(22),
      status: 'arriving',
      assignedRiderId: 'preview-rider',
      deliveryCode: '4821',
      items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 1, unitPrice: 3576, unit: 'unidad' }],
      subtotal: 3576,
      deliveryFee: 0,
      total: 3576,
      statusHistory: [
        { status: 'received', at: at(22) },
        { status: 'preparing', at: at(18) },
        { status: 'ready', at: at(12) },
        { status: 'on_the_way', at: at(8) },
        { status: 'arriving', at: at(2) },
      ],
      delivery: { driverName: 'Juli Reparto', driverPhone: '2991112233' },
    }],
    lastOrderId: 'LT-2050',
    cart: [],
  };
}

function seedBusinessState() {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [{
      id: 'LT-1042',
      customerName: 'M. Alvarez',
      customerPhone: '2990000001',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo al recibir',
      paymentMethodCode: 'cash',
      notes: '',
      createdAt: at(12),
      status: 'received',
      items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 1, unitPrice: 3576, unit: 'unidad' }],
      subtotal: 3576,
      deliveryFee: 0,
      total: 3576,
      statusHistory: [{ status: 'received', at: at(12) }],
    }],
    lastOrderId: 'LT-1042',
    cart: [],
  };
}
