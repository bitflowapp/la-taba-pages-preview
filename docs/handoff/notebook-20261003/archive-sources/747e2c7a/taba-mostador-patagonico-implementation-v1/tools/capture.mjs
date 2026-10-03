// Captura y validación de la implementación "Mostrador Patagónico" V1.
// Vive FUERA del repositorio de producto. No modifica el árbol de trabajo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..');
const shots = outDir;
const BASE = process.env.TABA_BASE || 'http://127.0.0.1:8099';

const seed = seedState();
const report = [];

const browser = await chromium.launch();

// ---------- Catálogo cliente ----------
await scene('catalog-mobile-320x568', 320, 568, '#catalog');
await scene('catalog-mobile-390x844', 390, 844, '#catalog');
await scene('catalog-mobile-cart-390x844', 390, 844, '#catalog', async (page) => {
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(3000); // el toast se retira solo
});
await scene('catalog-mobile-empty-390x844', 390, 844, '#catalog', async (page) => {
  await page.locator('[data-view="catalog"] [data-search-input]').fill('zzzzqqq');
  await page.waitForTimeout(400);
});
await scene('catalog-desktop-1280x900', 1280, 900, '#catalog');

await scene('home-mobile-390x844', 390, 844, '');
await scene('checkout-mobile-390x844', 390, 844, '#catalog', async (page) => {
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-floating-cart]').click();
  await page.waitForSelector('[data-checkout-form]');
  await page.waitForTimeout(3000);
});
await scene('profile-addresses-390x844', 390, 844, '#profile', async (page) => {
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('[data-view="profile"] *')]
      .find((node) => node.children.length === 0 && node.textContent.trim() === 'Tus lugares de entrega');
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  await page.waitForTimeout(250);
});
await scene('tracking-on-the-way-390x844', 390, 844, '#tracking', null, false, trackingState('on_the_way'));
await scene('tracking-arriving-390x844', 390, 844, '#tracking', null, false, trackingState('arriving'));

// ---------- Panel del negocio ----------
await scene('business-mobile-320x700', 320, 700, '#business', null, true);
await scene('business-mobile-390x844', 390, 844, '#business', null, true);
await scene('business-mobile-order-390x844', 390, 844, '#business', async (page) => {
  await page.locator('.inbox-card-details summary').first().click();
  await page.waitForTimeout(300);
}, true);
await scene('business-desktop-1024x768', 1024, 768, '#business', null, true);
await scene('business-desktop-1280x900', 1280, 900, '#business', null, true);
await scene('business-desktop-1440x1000', 1440, 1000, '#business', null, true);
await scene('business-desktop-1920x1080', 1920, 1080, '#business', null, true);

await browser.close();

fs.writeFileSync(path.join(outDir, 'capture-results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const failures = report.filter((r) => r.consoleErrors.length || r.pageErrors.length
  || r.horizontalOverflow > 1 || r.smallTargets.length || r.smallFonts.length
  || r.stickyOverlaps.length || r.clippedText.length);
console.log(`capturas=${report.length} fallos=${failures.length}`);
for (const f of failures) console.log('FALLA', f.name, JSON.stringify({
  consoleErrors: f.consoleErrors, pageErrors: f.pageErrors, overflow: f.horizontalOverflow,
  smallTargets: f.smallTargets, smallFonts: f.smallFonts, stickyOverlaps: f.stickyOverlaps,
  clippedText: f.clippedText,
}));

async function scene(name, width, height, hash, act, business = false, customSeed = null) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  if (business || customSeed) {
    await page.addInitScript((payload) => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(payload.state));
        if (payload.admin) sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
      } catch (_) { /* ignore */ }
    }, { state: customSeed || seed, admin: business });
  }
  await page.goto(`${BASE}/?demo=1${hash}`, { waitUntil: 'networkidle' });
  const readySelector = business
    ? '[data-order-inbox]'
    : customSeed
      ? '[data-tracking-panel] .track-layout'
      : hash === '#profile'
        ? '[data-customer-profile]'
        : hash === ''
          ? '[data-view="home"]:not([hidden]) .home-catalog-card'
          : '[data-product-grid] .product-card';
  await page.waitForSelector(readySelector, { timeout: 20000 });
  if (act) await act(page);
  await page.waitForTimeout(250);

  const measure = await page.evaluate(() => {
    const view = document.querySelector('.app-view:not([hidden])');
    // Chrome mantiene cajas medibles para el contenido de un <details>
    // cerrado y para el texto fuera de pantalla (.sr-only): ninguno de los dos
    // se ve, así que no cuenta ni como objetivo táctil ni como solape.
    const isRendered = (node) => {
      if (node.closest('details:not([open]) > *:not(summary)')) return false;
      if (node.closest('.sr-only')) return false;
      return true;
    };
    const isVisible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'
        && cs.display !== 'none' && Number(cs.opacity) > 0 && isRendered(node);
    };
    const controls = [...view.querySelectorAll('button, a[href], select, input:not([type="hidden"]), [role="button"]')]
      .filter(isVisible);
    const smallTargets = controls
      .map((n) => {
        // El área táctil de un radio o checkbox es la etiqueta que lo envuelve.
        const target = (n.type === 'radio' || n.type === 'checkbox')
          ? (n.closest('label') || n)
          : n;
        return { label: (n.getAttribute('aria-label') || n.textContent || n.name || '').trim().slice(0, 34), r: target.getBoundingClientRect() };
      })
      .filter((x) => x.r.height < 43.5 || x.r.width < 43.5)
      .map((x) => `${x.label}:${Math.round(x.r.width)}x${Math.round(x.r.height)}`);
    const smallFonts = [...view.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter(isVisible)
      .map((n) => `${n.name || n.type}:${getComputedStyle(n).fontSize}`)
      .filter((entry) => Number.parseFloat(entry.split(':')[1]) < 16);

    // Solapes con superficies sticky/fixed al final del scroll.
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: root.scrollHeight - root.clientHeight, behavior: 'instant' });
    const sticky = ['.mobile-nav', '.floating-cart:not(.hidden)', '.checkout-form .button-row', '.b-bottomnav']
      .flatMap((sel) => [...document.querySelectorAll(sel)])
      .filter(isVisible)
      .map((n) => ({ node: n, sel: n.className, r: n.getBoundingClientRect() }));
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    const stickyOverlaps = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent.trim();
      const owner = node.parentElement;
      if (text && owner && isRendered(owner) && owner.offsetParent !== null) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          for (const s of sticky) {
            // El texto propio de la superficie no se tapa a sí mismo.
            if (s.node.contains(owner)) continue;
            const overlap = r.bottom > s.r.top + 1 && r.top < s.r.bottom - 1
              && r.right > s.r.left + 1 && r.left < s.r.right - 1;
            if (overlap) stickyOverlaps.push(`${text.slice(0, 26)} ⨯ ${s.sel}`);
          }
        }
      }
      node = walker.nextNode();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Texto cortado: contenedores de una sola linea cuyo contenido no entra.
    // Se excluyen los que truncan por diseno con elipsis visible y afordancia.
    const INTENTIONAL_ELLIPSIS = [
      '.topbar-address .address-chip-text strong',
      '.catalog-head .view-title',
      '.o-card-address',
      '.inbox-address-summary',
      '.cart-button-copy strong',
    ].join(',');
    const clippedText = [...view.parentElement.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && n.textContent.trim() && isVisible(n))
      .filter((n) => {
        const cs = getComputedStyle(n);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false;
        if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') return false;
        return n.scrollWidth > n.clientWidth + 1;
      })
      .filter((n) => !n.closest(INTENTIONAL_ELLIPSIS) && !n.matches(INTENTIONAL_ELLIPSIS))
      .map((n) => `${n.className || n.tagName}|${n.parentElement?.className || ''}|${n.textContent.trim().slice(0, 24)}|${n.scrollWidth}>${n.clientWidth}`);

    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      clippedText: [...new Set(clippedText)],
      smallTargets,
      smallFonts,
      stickyOverlaps: [...new Set(stickyOverlaps)],
      bottomReserve: getComputedStyle(document.querySelector('main[data-app-main]')).paddingBottom,
      visiblePrimaries: [...document.querySelectorAll('.app-view:not([hidden]) .primary-button')]
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return isVisible(n) && r.top < window.innerHeight && r.bottom > 0;
        })
        .map((n) => n.textContent.trim().slice(0, 32)),
      exposesDeliveryCode: /c[oó]digo\D{0,24}\b\d{4,}\b/i.test(view.innerText),
      previewLabel: /PREVIEW INTERNA/i.test(view.innerText),
    };
  });

  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  report.push({ name, width, height, consoleErrors, pageErrors, ...measure });
  await context.close();
}

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

// Estado de seguimiento del cliente: pedido real en reparto o llegando. Solo
// cambia el estado persistido; no toca GPS, MapLibre ni la logica de tracking.
function trackingState(status) {
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
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', reference: 'Porton gris', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery',
      paymentMethod: 'Efectivo al recibir',
      paymentMethodCode: 'cash',
      notes: 'Sin sal',
      createdAt: at(22),
      status,
      items: [
        { productId: 'red-bull-original-lata-250ml', name: 'Red Bull Energy Drink', icon: '', quantity: 2, unitPrice: 3576, unit: 'unidad' },
        { productId: 'heineken-original-lata-473ml', name: 'Heineken Original', icon: '', quantity: 4, unitPrice: 2900, unit: 'unidad' },
      ],
      subtotal: 18752,
      deliveryFee: 0,
      total: 18752,
      statusHistory: [
        { status: 'received', at: at(22) },
        { status: 'preparing', at: at(18) },
        { status: 'ready', at: at(12) },
        { status: 'on_the_way', at: at(8) },
        ...(status === 'arriving' ? [{ status: 'arriving', at: at(2) }] : []),
      ],
      delivery: { driverName: 'Juli Reparto', driverPhone: '2991112233', currentLocationLabel: 'El repartidor salio del local' },
    }],
    lastOrderId: 'LT-2050',
    cart: [],
  };
}
