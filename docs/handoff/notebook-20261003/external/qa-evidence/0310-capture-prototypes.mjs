// Captura obligatoria de los prototipos + verificación con las mismas métricas
// que se aplicaron al estado actual, para que la comparación sea legítima.
import { writeFile } from 'node:fs/promises';

const { chromium } = await import(
  'file:///C:/Users/marco/dev/la-taba-pages-preview/node_modules/playwright/index.mjs'
);

const BASE = 'http://127.0.0.1:8792';
const OUT = 'C:/1212/artifacts/taba-opus-design-review/screenshots';

const SHOTS = [
  { file: 'business-mobile-390x844', page: 'prototype-business-mobile.html', w: 390, h: 844 },
  { file: 'business-mobile-430x932', page: 'prototype-business-mobile.html', w: 430, h: 932 },
  { file: 'business-desktop-1280x900', page: 'prototype-business-desktop.html', w: 1280, h: 900 },
  { file: 'catalog-mobile-320x568', page: 'prototype-catalog-mobile.html', w: 320, h: 568 },
  { file: 'catalog-mobile-390x844', page: 'prototype-catalog-mobile.html', w: 390, h: 844 },
  { file: 'catalog-mobile-430x932', page: 'prototype-catalog-mobile.html', w: 430, h: 932 },
  { file: 'catalog-tablet-768x1024', page: 'prototype-catalog-desktop.html', w: 768, h: 1024 },
  { file: 'catalog-desktop-1280x900', page: 'prototype-catalog-desktop.html', w: 1280, h: 900 },
  // Extras de verificación, no obligatorias.
  { file: 'extra-business-mobile-320x568', page: 'prototype-business-mobile.html', w: 320, h: 568 },
  { file: 'extra-business-desktop-1440x1000', page: 'prototype-business-desktop.html', w: 1440, h: 1000 },
  { file: 'extra-catalog-desktop-1440x1000', page: 'prototype-catalog-desktop.html', w: 1440, h: 1000 },
];

const AUDIT = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const lab = (el) => {
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${cls}`;
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  const overflow = Math.max(0, document.documentElement.scrollWidth - vw);

  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab], [role=option]')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    // Área táctil ampliada por pseudo-elemento (chips de categoría).
    const extra = getComputedStyle(el, '::after').content !== 'none' ? 4 : 0;
    if (r.width < 44 || r.height + extra < 44) {
      small.push({ el: lab(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.children.length) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const s = getComputedStyle(el);
      if (['auto', 'scroll'].includes(s.overflowX)) continue;
      if (s.textOverflow === 'ellipsis') continue; // truncado deliberado
      clipped.push({ el: lab(el), scroll: el.scrollWidth, client: el.clientWidth });
    }
  }

  const tiny = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.children.length) continue;
    if (!(el.textContent || '').trim()) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 11) tiny.push({ el: lab(el), px });
  }

  // Superficies fijas y contenido realmente ocluido.
  const fixed = [];
  let bandTop = vh;
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    if (getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < vh * 0.6) continue;
    bandTop = Math.min(bandTop, r.top);
    const occ = new Set();
    for (let i = 1; i <= 5; i += 1) {
      const x = r.left + (r.width * i) / 6;
      const y = r.top + r.height / 2;
      const stack = document.elementsFromPoint(x, y);
      const idx = stack.indexOf(el);
      if (idx < 0) continue;
      for (const n of stack.slice(idx + 1)) {
        if (el.contains(n) || n === document.body || n === document.documentElement) continue;
        const t = (n.textContent || '').trim();
        if (t) { occ.add(`${lab(n)} "${t.slice(0, 30)}"`); break; }
      }
    }
    fixed.push({ el: lab(el), h: Math.round(r.height), occludes: [...occ] });
  }

  // Solapamiento real entre superficies fijas.
  let stickyOverlap = 0;
  if (fixed.length >= 2) {
    const rects = [...document.querySelectorAll('body *')]
      .filter((el) => vis(el) && getComputedStyle(el).position === 'fixed')
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.bottom >= vh * 0.6)
      .sort((a, b) => a.top - b.top);
    for (let i = 0; i < rects.length - 1; i += 1) {
      stickyOverlap = Math.max(stickyOverlap, Math.round(rects[i].bottom - rects[i + 1].top));
    }
  }

  // Comercio: precios visibles en el primer viewport.
  const prices = [...document.querySelectorAll('.product-price')].filter(vis);
  const visiblePrices = prices.filter((n) => {
    const r = n.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= bandTop;
  }).length;
  const firstCard = document.querySelector('.product-card');
  const firstPrice = prices[0];

  return {
    viewport: { w: vw, h: vh },
    horizontalOverflowPx: overflow,
    smallTargets: small,
    clippedText: clipped,
    tinyText: tiny,
    fixedSurfaces: fixed,
    stickyOverlapPx: Math.max(0, stickyOverlap),
    bottomBandPct: Math.round(((vh - bandTop) / vh) * 100),
    commerce: {
      priceNodes: prices.length,
      pricesInFirstViewport: visiblePrices,
      firstCardTop: firstCard ? Math.round(firstCard.getBoundingClientRect().top + window.scrollY) : null,
      firstPriceTop: firstPrice ? Math.round(firstPrice.getBoundingClientRect().top + window.scrollY) : null,
    },
  };
};

const report = {};
const browser = await chromium.launch();

for (const s of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
    isMobile: s.w <= 430,
    hasTouch: s.w <= 768,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/${s.page}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);

  const audit = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${OUT}/${s.file}.png` });
  await page.screenshot({ path: `${OUT}/${s.file}-full.png`, fullPage: true });
  report[s.file] = audit;

  const flags = [];
  if (audit.horizontalOverflowPx) flags.push(`OVERFLOW +${audit.horizontalOverflowPx}px`);
  if (audit.smallTargets.length) flags.push(`${audit.smallTargets.length} <44px`);
  if (audit.clippedText.length) flags.push(`${audit.clippedText.length} truncados`);
  if (audit.tinyText.length) flags.push(`${audit.tinyText.length} texto <11px`);
  if (audit.stickyOverlapPx > 0) flags.push(`SOLAPE ${audit.stickyOverlapPx}px`);
  const c = audit.commerce;
  const commerce = c.priceNodes
    ? ` | precios 1er viewport ${c.pricesInFirstViewport}/${c.priceNodes}, 1er precio y=${c.firstPriceTop}`
    : '';
  console.log(`${s.file}: ${flags.length ? flags.join(' | ') : 'limpio'}${commerce}`);
  if (audit.smallTargets.length) console.log(`   ${JSON.stringify(audit.smallTargets.slice(0, 4))}`);
  if (audit.clippedText.length) console.log(`   ${JSON.stringify(audit.clippedText.slice(0, 3))}`);
  await context.close();
}

await browser.close();
await writeFile(`${OUT}/prototype-metrics.json`, JSON.stringify(report, null, 2));
console.log('\nlisto');
