// Sonda del panel del negocio. No pertenece al repositorio de producto.
import { chromium } from '@playwright/test';

const BASE = process.env.TABA_BASE || 'http://127.0.0.1:8099';
const viewports = [
  { name: 'business-mobile-320x700', width: 320, height: 700 },
  { name: 'business-mobile-390x844', width: 390, height: 844 },
  { name: 'business-mobile-360x800', width: 360, height: 800 },
  { name: 'business-desktop-1024x768', width: 1024, height: 768 },
  { name: 'business-desktop-1280x900', width: 1280, height: 900 },
  { name: 'business-desktop-1440x1000', width: 1440, height: 1000 },
  { name: 'business-desktop-1920x1080', width: 1920, height: 1080 },
];

const browser = await chromium.launch();
const results = [];
for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript((seed) => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(seed));
      sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
    } catch (_) { /* ignore */ }
  }, seedState());
  await page.goto(`${BASE}/?demo=1#business`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-order-inbox]', { timeout: 20000 });
  await page.waitForTimeout(300);
  const measure = await page.evaluate(() => {
    const visible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const inViewport = (node) => {
      const r = node.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    };
    const primaries = [...document.querySelectorAll('[data-view="business"] .primary-button')]
      .filter((n) => visible(n) && inViewport(n));
    const smallTargets = [...document.querySelectorAll('[data-view="business"] button, [data-view="business"] a, [data-view="business"] select, [data-view="business"] input')]
      .filter(visible)
      .map((n) => ({ tag: n.tagName, label: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 30), r: n.getBoundingClientRect() }))
      .filter((x) => x.r.height < 44 || x.r.width < 44)
      .map((x) => `${x.tag}:${x.label}:${Math.round(x.r.width)}x${Math.round(x.r.height)}`);
    const smallFonts = [...document.querySelectorAll('[data-view="business"] input, [data-view="business"] select, [data-view="business"] textarea')]
      .filter(visible)
      .map((n) => parseFloat(getComputedStyle(n).fontSize))
      .filter((size) => size < 16);
    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      visiblePrimaries: primaries.map((n) => n.textContent.trim().slice(0, 40)),
      hasMasterDetail: Boolean(document.querySelector('.d-panels')),
      queueCards: document.querySelectorAll('[data-inbox-order]').length,
      smallTargets,
      smallFonts,
      syncVisible: Boolean(document.querySelector('[data-realtime-sync="business"], .b-connection')),
      showsCorrectDeliveryCode: /\bcódigo\s*[:=]?\s*\d{4,}/i.test(document.querySelector('[data-view="business"]').innerText),
    };
  });
  await page.screenshot({ path: new URL(`../screenshots/${vp.name}.png`, import.meta.url).pathname.slice(1), fullPage: false });
  results.push({ viewport: vp.name, ...measure, errors });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));

function seedState() {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  const order = (id, name, status, total, mode) => ({
    id,
    customerName: name,
    customerPhone: '2990000001',
    address: 'Mendoza 851, Centro',
    addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', reference: 'Porton gris', label: 'Mendoza 851, Centro' },
    deliveryMode: mode,
    paymentMethod: 'Efectivo al recibir',
    paymentMethodCode: 'cash',
    notes: 'Sin sal',
    createdAt: at(12),
    status,
    items: [
      { productId: 'red-bull-original-lata-250ml', name: 'Red Bull Energy Drink', icon: '', quantity: 2, unitPrice: 3576, unit: 'unidad' },
      { productId: 'heineken-original-lata-473ml', name: 'Heineken Original', icon: '', quantity: 4, unitPrice: 2900, unit: 'unidad' },
    ],
    subtotal: total,
    deliveryFee: 0,
    total,
    statusHistory: [{ status: 'received', at: at(12) }],
  });
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [
      order('LT-1042', 'M. Alvarez', 'received', 58900, 'delivery'),
      order('LT-1041', 'J. Perez', 'preparing', 21400, 'delivery'),
      order('LT-1040', 'C. Suarez', 'ready', 17100, 'pickup'),
      order('LT-1039', 'R. Gomez', 'on_the_way', 34200, 'delivery'),
    ],
    lastOrderId: 'LT-1042',
    cart: [],
  };
}
