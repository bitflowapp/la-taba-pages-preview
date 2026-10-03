// Medición dirigida: comprueba empíricamente las hipótesis derivadas del CSS.
// No afirma nada que no se pueda medir en el navegador.
import { writeFile } from 'node:fs/promises';

const { chromium } = await import(
  'file:///C:/Users/marco/dev/la-taba-pages-preview/node_modules/playwright/index.mjs'
);

const BASE = 'http://127.0.0.1:8791';
const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x900', width: 1280, height: 900 },
  { name: '1440x1000', width: 1440, height: 1000 },
];

const PROBE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const lab = (el) => {
    if (!el) return null;
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  // A. Contenedores con scroll horizontal: cuánto queda fuera de vista.
  const scrollClipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    const scrolls = ['auto', 'scroll'].includes(s.overflowX);
    if (!scrolls) continue;
    const hidden = el.scrollWidth - el.clientWidth;
    if (hidden <= 2) continue;
    const kids = [...el.children].filter(vis);
    const offscreen = kids.filter((k) => {
      const kr = k.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return kr.right > er.right + 1;
    });
    scrollClipped.push({
      el: lab(el),
      visiblePx: el.clientWidth,
      totalPx: el.scrollWidth,
      hiddenPx: hidden,
      hiddenPct: Math.round((hidden / el.scrollWidth) * 100),
      children: kids.length,
      childrenOffscreen: offscreen.length,
      firstHidden: offscreen[0] ? (offscreen[0].textContent || '').trim().slice(0, 30) : null,
    });
  }

  // B. Superficies fijas inferiores y contenido reamente ocluido.
  const fixedBottom = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    if (s.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < vh * 0.6) continue;
    const occluded = new Set();
    for (let i = 1; i <= 5; i += 1) {
      const x = r.left + (r.width * i) / 6;
      const y = r.top + r.height / 2;
      if (x < 0 || x > vw || y < 0 || y > vh) continue;
      const stack = document.elementsFromPoint(x, y);
      const idx = stack.indexOf(el);
      if (idx < 0) continue;
      for (const n of stack.slice(idx + 1)) {
        if (el.contains(n) || n === document.body || n === document.documentElement) continue;
        const t = (n.textContent || '').trim();
        if (t) { occluded.add(`${lab(n)} "${t.slice(0, 34)}"`); break; }
      }
    }
    fixedBottom.push({
      el: lab(el),
      top: Math.round(r.top),
      height: Math.round(r.height),
      pctOfViewport: Math.round((r.height / vh) * 100),
      occludes: [...occluded],
    });
  }
  // Espacio vertical total consumido por barras fijas inferiores.
  const bottomBandTop = fixedBottom.length ? Math.min(...fixedBottom.map((f) => f.top)) : vh;
  const bottomBandPct = Math.round(((vh - bottomBandTop) / vh) * 100);

  // C. ¿Hay algo comprable (precio) en el primer viewport?
  const priceNodes = [...document.querySelectorAll('.price strong, .price-amounts strong, .home-product-price')]
    .filter(vis);
  const priceInFirstViewport = priceNodes.filter((n) => {
    const r = n.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= bottomBandTop;
  }).length;
  const firstPriceTop = priceNodes.length
    ? Math.round(Math.min(...priceNodes.map((n) => n.getBoundingClientRect().top + window.scrollY)))
    : null;
  const firstCard = document.querySelector('.product-grid .product-card');
  const firstCardTop = firstCard
    ? Math.round(firstCard.getBoundingClientRect().top + window.scrollY) : null;

  // D. Tamaños reales de controles clave (verifica, no asume).
  const sample = (sel) => {
    const el = [...document.querySelectorAll(sel)].find(vis);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  const controls = {
    homeCategoryCard: sample('.home-category-card'),
    catalogCategoryButton: sample('[data-view="catalog"] .category-button'),
    mobileNavButton: sample('.mobile-nav button'),
    addButton: sample('.add-button'),
    favorite: sample('.product-favorite'),
    sortSelect: sample('[data-sort-select]'),
    businessJumpButton: sample('.business-jump-nav button'),
    inboxTab: sample('.inbox-tab'),
    statTile: sample('.stat-tile'),
    searchInput: sample('.catalog-search input, .taba-home-search input'),
  };

  // E. Deriva del control flotante de cantidad respecto del borde de la imagen.
  const drift = [];
  for (const card of [...document.querySelectorAll('.product-card')].slice(0, 6)) {
    const media = card.querySelector('.product-media');
    const ctrl = card.querySelector('.product-media-control');
    if (!media || !ctrl) continue;
    const mr = media.getBoundingClientRect();
    const cr = ctrl.getBoundingClientRect();
    drift.push({
      cardHeight: Math.round(card.getBoundingClientRect().height),
      mediaBottom: Math.round(mr.bottom),
      controlCenter: Math.round(cr.top + cr.height / 2),
      // >0 significa que el control cayó por debajo de la imagen, sobre el texto.
      offsetBelowMedia: Math.round(cr.top + cr.height / 2 - mr.bottom),
    });
  }

  // F. Custom properties sin definir que rompen declaraciones.
  const probeEl = document.querySelector('.production-rider-assignment select')
    || document.documentElement;
  const borderStrong = getComputedStyle(document.documentElement)
    .getPropertyValue('--taba-border-strong').trim();

  return {
    viewport: { w: vw, h: vh },
    scrollClipped,
    fixedBottom,
    bottomBandPct,
    bottomBandTop,
    commerce: { priceNodesTotal: priceNodes.length, priceInFirstViewport, firstPriceTop, firstCardTop },
    controls,
    quantityControlDrift: drift,
    tokens: { tabaBorderStrong: borderStrong || '(UNDEFINED)' },
  };
};

async function settle(page) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
}

const out = {};
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.width <= 430,
    hasTouch: vp.width <= 768,
  });
  const page = await context.newPage();
  const bucket = {};

  await page.goto(`${BASE}/?reset=1&demo=1#home`);
  await settle(page);
  bucket.home = await page.evaluate(PROBE);

  await page.goto(`${BASE}/?demo=1#catalog`);
  await settle(page);
  bucket.catalog = await page.evaluate(PROBE);

  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()
    .click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  bucket.catalogWithCart = await page.evaluate(PROBE);

  await page.goto(`${BASE}/?demo=1#business`);
  await settle(page);
  await page.locator('[data-open-pin][data-admin-target="business"]').first()
    .click({ timeout: 4000 }).catch(() => {});
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234').catch(() => {});
  await page.locator('[data-pin-form]').press('Enter').catch(() => {});
  await page.waitForTimeout(900);
  bucket.business = await page.evaluate(PROBE);

  out[vp.name] = bucket;

  const c = bucket.catalog;
  const b = bucket.business;
  console.log(`\n== ${vp.name} ==`);
  console.log(`  catálogo: primera tarjeta y=${c.commerce.firstCardTop}, primer precio y=${c.commerce.firstPriceTop}, precios visibles en 1er viewport=${c.commerce.priceInFirstViewport}/${c.commerce.priceNodesTotal}`);
  console.log(`  banda inferior fija: ${bucket.catalogWithCart.bottomBandPct}% del viewport (con carrito)`);
  for (const s of b.scrollClipped) {
    console.log(`  negocio recortado: ${s.el} muestra ${s.visiblePx}/${s.totalPx}px (oculta ${s.hiddenPct}%, ${s.childrenOffscreen} items, 1ro oculto: "${s.firstHidden}")`);
  }
  for (const s of c.scrollClipped) {
    console.log(`  catálogo recortado: ${s.el} oculta ${s.hiddenPct}% (${s.childrenOffscreen} items)`);
  }
  console.log(`  chips: home=${JSON.stringify(b.controls.homeCategoryCard || c.controls.homeCategoryCard)} catálogo=${JSON.stringify(c.controls.catalogCategoryButton)} navBtn=${JSON.stringify(c.controls.mobileNavButton)}`);
  console.log(`  --taba-border-strong = ${c.tokens.tabaBorderStrong}`);
  if (c.quantityControlDrift.length) {
    console.log(`  deriva control cantidad: ${JSON.stringify(c.quantityControlDrift.slice(0, 3))}`);
  }
  await context.close();
}

await browser.close();
await writeFile(
  'C:/1212/artifacts/taba-opus-design-review/screenshots/current/measurements.json',
  JSON.stringify(out, null, 2),
);
console.log('\nmediciones guardadas');
