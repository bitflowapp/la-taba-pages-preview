// Diagnóstico de "scroll fantasma": mide con precisión dónde termina el
// contenido real y dónde termina el documento, para encontrar la causa
// EXACTA de la superficie blanca desplazable. Usa el motor WebKit real.
// Vive FUERA del repositorio de producto.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..');
const BASE = process.env.TABA_BASE || 'http://127.0.0.1:8099';
const device = devices['iPhone 13']; // 390x844 lógicos

const browser = await webkit.launch();
const report = [];

async function newPage(seedPayload) {
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  await context.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
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
  return { context, page };
}

async function measure(page, label) {
  await page.evaluate(() => {
    const banner = document.querySelector('[data-app-update-banner]');
    if (banner) banner.hidden = true;
  }).catch(() => {});
  const data = await page.evaluate(() => {
    const isVisible = (node) => {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    // Contenido real de flujo: descarta texto para lectores de pantalla
    // (patrón `.sr-only`: absoluto, 1x1px, recortado) y cualquier elemento
    // `fixed`/`sticky` (es chrome, no contenido — y su posición "de
    // documento" no es estable: se recalcula con cada scroll).
    const isFlowContent = (node) => {
      const cs = getComputedStyle(node);
      if (cs.position === 'fixed' || cs.position === 'sticky') return false;
      const r = node.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1) return false;
      if (cs.clipPath === 'inset(50%)' || /^rect\(0px,?\s*0px,?\s*0px,?\s*0px\)$/.test(cs.clip || '')) return false;
      return true;
    };
    const root = document.scrollingElement ?? document.documentElement;
    // Scroll hasta el fondo real del documento (no una posición supuesta).
    window.scrollTo({ top: root.scrollHeight, behavior: 'instant' });

    // Último elemento con contenido visible y de flujo en la vista activa.
    const activeView = document.querySelector('.app-view:not([hidden])');
    let lastBottom = 0;
    let lastNode = null;
    if (activeView) {
      const walker = document.createTreeWalker(activeView, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        if (isVisible(node) && isFlowContent(node) && node.children.length === 0) {
          const r = node.getBoundingClientRect();
          const bottom = r.bottom + window.scrollY;
          if (bottom > lastBottom) { lastBottom = bottom; lastNode = `${node.tagName}.${node.className || ''}`; }
        }
        node = walker.nextNode();
      }
    }

    const fixedOrSticky = [...document.querySelectorAll('body *')]
      .filter(isVisible)
      .filter((n) => {
        const pos = getComputedStyle(n).position;
        return pos === 'fixed' || pos === 'sticky';
      })
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { sel: n.className || n.tagName, position: getComputedStyle(n).position, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
      });

    const hiddenViews = [...document.querySelectorAll('.app-view[hidden]')]
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { view: n.dataset.view, w: Math.round(r.width), h: Math.round(r.height) };
      });

    const box = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return {
        top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), h: Math.round(r.height),
        minHeight: cs.minHeight, height: cs.height, paddingBottom: cs.paddingBottom, marginBottom: cs.marginBottom,
        display: cs.display, flexDirection: cs.flexDirection,
      };
    };

    const cssSupportsDvh = CSS.supports('height', '100dvh');
    const cssSupportsSvh = CSS.supports('height', '100svh');

    window.scrollTo({ top: 0, behavior: 'instant' });

    const appShellBox = box('.app-shell');
    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      scrollingElementScrollHeight: root.scrollHeight,
      // Métrica AUTORITATIVA: el documento no debería exceder el borde
      // inferior real de `.app-shell` (que ya incluye la reserva inferior
      // intencional). Cualquier diferencia acá es scroll fantasma genuino.
      documentVsAppShellGap: Math.round(root.scrollHeight - (appShellBox?.bottom ?? 0)),
      // Diagnóstico best-effort (NO autoritativo): intenta ubicar la última
      // hoja de contenido real, pero un contenedor con `overflow` propio,
      // colapsado o con transform puede reportar una posición geométrica que
      // no corresponde al alto de scroll del documento. Se conserva sólo
      // como pista, no como veredicto de "hay/no hay" scroll fantasma.
      lastVisibleBottom: Math.round(lastBottom),
      lastVisibleNode: lastNode,
      appShell: appShellBox,
      main: box('main[data-app-main]'),
      activeView: activeView ? box(`[data-view="${activeView.dataset.view}"]`) : null,
      activeViewName: activeView?.dataset.view || null,
      fixedOrSticky,
      hiddenViewsWithSize: hiddenViews.filter((v) => v.h > 0 || v.w > 0),
      cssSupportsDvh,
      cssSupportsSvh,
      bodyDataset: { ...document.body.dataset },
    };
  });
  report.push({ view: label, ...data });
  return data;
}

// ---------- Contenido corto vs largo, home / catalog / cart / checkout / profile / tracking / business / rider ----------

async function scenario(label, hash, seedPayload, act) {
  console.log(`-> ${label} iniciando...`);
  const { context, page } = await newPage(seedPayload);
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  try {
    // 'load' en vez de 'networkidle': una conexión SSE de tiempo real (sin
    // relay corriendo en esta auditoría) mantiene actividad de red y nunca
    // deja que 'networkidle' se cumpla.
    await page.goto(`${BASE}/?demo=1${hash}`, { waitUntil: 'load', timeout: 15000 });
    // Oculto de forma permanente vía CSS (no sólo `hidden`): un service worker
    // de una corrida anterior puede volver a mostrarlo entre navegaciones
    // internas de la SPA (hash routing) y tapar clics con pointer-events.
    await page.addStyleTag({ content: '[data-app-update-banner]{display:none!important;}' }).catch(() => {});
    if (act) await act(page);
    await page.waitForTimeout(300);
    await measure(page, label);
    console.log(`   ${label} ok`);
  } catch (err) {
    const firstLine = String(err.message || err).split('\n')[0];
    console.log(`   ${label} FALLA: ${firstLine}`);
  } finally {
    await context.close();
  }
}

await scenario('home', '', null, async (page) => {
  await page.waitForSelector('[data-view="home"] .home-catalog-card');
});

await scenario('catalog', '#catalog', null, async (page) => {
  await page.waitForSelector('[data-product-grid] .product-card');
});

await scenario('catalog:filtered-short', '#catalog', null, async (page) => {
  await page.waitForSelector('[data-product-grid] .product-card');
  await page.locator('[data-view="catalog"] [data-search-input]').fill('imperial golden');
  await page.waitForTimeout(400);
});

await scenario('cart:empty', '#cart', null, async (page) => {
  await page.waitForSelector('[data-view="cart"]');
});

await scenario('cart:filled', '#catalog', null, async (page) => {
  await page.waitForSelector('[data-product-grid] .product-card');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await page.waitForSelector('[data-checkout-form]:not([hidden])');
});

await scenario('checkout', '#catalog', null, async (page) => {
  await page.waitForSelector('[data-product-grid] .product-card');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-floating-cart]').click();
  await page.waitForSelector('[data-checkout-form]:not([hidden])');
  await page.waitForTimeout(3200);
});

await scenario('profile', '#profile', null, async (page) => {
  await page.waitForSelector('[data-customer-profile]');
});

await scenario('tracking:empty', '#tracking', null, async (page) => {
  await page.waitForSelector('[data-tracking-panel]');
});

await scenario('tracking:on-the-way', '#tracking', { state: seedTrackingState('on_the_way'), admin: false }, async (page) => {
  await page.waitForSelector('[data-tracking-panel] .track-layout');
});

await scenario('business:few-orders', '#business', { state: seedBusinessState(1), admin: true }, async (page) => {
  await page.waitForSelector('[data-order-inbox]');
});

await scenario('business:many-orders', '#business', { state: seedBusinessState(8), admin: true }, async (page) => {
  await page.waitForSelector('[data-order-inbox]');
});

await scenario('business:empty', '#business', { state: seedBusinessState(0), admin: true }, async (page) => {
  await page.waitForSelector('[data-order-inbox]');
});

await scenario('rider:empty', '#rider', { state: seedBusinessState(0), admin: true }, async (page) => {
  await page.waitForSelector('[data-delivery-panel]');
});

await browser.close();

fs.writeFileSync(path.join(outDir, 'phantom-scroll-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`vistas medidas=${report.length}`);
const withPhantom = report.filter((r) => Math.abs(r.documentVsAppShellGap) > 1);
console.log(`\nscroll fantasma real (documentScrollHeight - appShell.bottom != 0) en ${withPhantom.length}/${report.length} vistas`);

for (const r of report) {
  console.log(`\n${r.view} (${r.activeViewName})`);
  console.log(`  innerHeight=${r.innerHeight} documentScrollHeight=${r.documentScrollHeight}`);
  console.log(`  documentVsAppShellGap=${r.documentVsAppShellGap}px ${Math.abs(r.documentVsAppShellGap) > 1 ? '<-- FALLA' : '(ok)'}`);
  console.log(`  [diagnóstico no autoritativo] lastVisibleBottom=${r.lastVisibleBottom} lastVisibleNode=${r.lastVisibleNode}`);
  console.log(`  appShell=${JSON.stringify(r.appShell)}`);
  console.log(`  main=${JSON.stringify(r.main)}`);
  console.log(`  activeView=${JSON.stringify(r.activeView)}`);
  if (r.hiddenViewsWithSize.length) console.log(`  hiddenViewsWithSize=${JSON.stringify(r.hiddenViewsWithSize)}`);
  console.log(`  fixedOrSticky=${JSON.stringify(r.fixedOrSticky)}`);
  console.log(`  dvh=${r.cssSupportsDvh} svh=${r.cssSupportsSvh}`);
}

function seedTrackingState(status) {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders: [{
      id: 'LT-2050', customerName: 'Cliente Demo', customerPhone: '2990000001',
      address: 'Mendoza 851, Centro',
      addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
      deliveryMode: 'delivery', paymentMethod: 'Efectivo al recibir', paymentMethodCode: 'cash', notes: '',
      createdAt: at(22), status,
      items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 2, unitPrice: 3576, unit: 'unidad' }],
      subtotal: 7152, deliveryFee: 0, total: 7152,
      statusHistory: [
        { status: 'received', at: at(22) }, { status: 'preparing', at: at(18) },
        { status: 'ready', at: at(12) }, { status: 'on_the_way', at: at(8) },
      ],
      delivery: { driverName: 'Juli Reparto', driverPhone: '2991112233' },
    }],
    lastOrderId: 'LT-2050',
    cart: [],
  };
}

function seedBusinessState(count) {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60000).toISOString();
  const statuses = ['received', 'preparing', 'ready', 'on_the_way'];
  const orders = Array.from({ length: count }, (_, i) => ({
    id: `LT-${1000 + i}`,
    customerName: `Cliente ${i + 1}`,
    customerPhone: '2990000001',
    address: 'Mendoza 851, Centro',
    addressDetails: { streetLine: 'Mendoza 851', neighborhood: 'Centro', label: 'Mendoza 851, Centro' },
    deliveryMode: i % 2 === 0 ? 'delivery' : 'pickup',
    paymentMethod: 'Efectivo al recibir',
    paymentMethodCode: 'cash',
    notes: '',
    createdAt: at(12 + i),
    status: statuses[i % statuses.length],
    items: [{ productId: 'red-bull-original-lata-250ml', name: 'Red Bull', quantity: 1, unitPrice: 3576, unit: 'unidad' }],
    subtotal: 3576, deliveryFee: 0, total: 3576,
    statusHistory: [{ status: 'received', at: at(12 + i) }],
  }));
  return {
    schemaVersion: 4,
    dataVersion: 'la-taba-runtime-v2',
    appMode: 'demo',
    orders,
    lastOrderId: orders.length ? orders[0].id : null,
    cart: [],
  };
}
