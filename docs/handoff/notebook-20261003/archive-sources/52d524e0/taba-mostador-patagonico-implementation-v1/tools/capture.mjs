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
  || r.horizontalOverflow > 1 || r.smallTargets.length || r.smallFonts.length || r.stickyOverlaps.length);
console.log(`capturas=${report.length} fallos=${failures.length}`);
for (const f of failures) console.log('FALLA', f.name, JSON.stringify({
  consoleErrors: f.consoleErrors, pageErrors: f.pageErrors, overflow: f.horizontalOverflow,
  smallTargets: f.smallTargets, smallFonts: f.smallFonts, stickyOverlaps: f.stickyOverlaps,
}));

async function scene(name, width, height, hash, act, business = false) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  if (business) {
    await page.addInitScript((state) => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('la_taba_mvp_v4_state', JSON.stringify(state));
        sessionStorage.setItem('la_taba_mvp_v4_admin_unlocked', 'true');
      } catch (_) { /* ignore */ }
    }, seed);
  }
  await page.goto(`${BASE}/?demo=1${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(business ? '[data-order-inbox]' : '[data-product-grid] .product-card', { timeout: 20000 });
  if (act) await act(page);
  await page.waitForTimeout(250);

  const measure = await page.evaluate(() => {
    const view = document.querySelector('.app-view:not([hidden])');
    const isVisible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    };
    const controls = [...view.querySelectorAll('button, a[href], select, input:not([type="hidden"]), [role="button"]')]
      .filter(isVisible);
    const smallTargets = controls
      .map((n) => ({ label: (n.getAttribute('aria-label') || n.textContent || n.name || '').trim().slice(0, 34), r: n.getBoundingClientRect() }))
      .filter((x) => x.r.height < 43.5 || x.r.width < 43.5)
      .map((x) => `${x.label}:${Math.round(x.r.width)}x${Math.round(x.r.height)}`);
    const smallFonts = [...view.querySelectorAll('input:not([type="hidden"]), select, textarea')]
      .filter(isVisible)
      .map((n) => `${n.name || n.type}:${getComputedStyle(n).fontSize}`)
      .filter((entry) => Number.parseFloat(entry.split(':')[1]) < 16);

    // Solapes con superficies sticky/fixed al final del scroll.
    const root = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: root.scrollHeight - root.clientHeight, behavior: 'instant' });
    const sticky = ['.mobile-nav', '.floating-cart:not(.hidden)', '.checkout-form .button-row']
      .flatMap((sel) => [...document.querySelectorAll(sel)])
      .filter(isVisible)
      .map((n) => ({ sel: n.className, r: n.getBoundingClientRect() }));
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    const stickyOverlaps = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent.trim();
      if (text) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          for (const s of sticky) {
            const overlap = r.bottom > s.r.top + 1 && r.top < s.r.bottom - 1
              && r.right > s.r.left + 1 && r.left < s.r.right - 1;
            if (overlap) stickyOverlaps.push(`${text.slice(0, 26)} ⨯ ${s.sel}`);
          }
        }
      }
      node = walker.nextNode();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
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
