import { webkit } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://la-taba.pages.dev';
const OUT = '.local/mobile-audit';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const snap = () => {
  const g = (sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), pb: cs.paddingBottom, pos: cs.position };
  };
  const root = getComputedStyle(document.documentElement);
  const nav = document.querySelector('.mobile-nav');
  let navContent = null;
  if (nav) {
    const cs = getComputedStyle(nav);
    const inner = nav.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth || 0);
    const btn = nav.querySelector('button');
    navContent = { contentBox: +inner.toFixed(1), buttonH: btn ? +btn.getBoundingClientRect().height.toFixed(1) : null, navScrollH: nav.scrollHeight, navClientH: nav.clientHeight, overflow: +(nav.scrollHeight - nav.clientHeight).toFixed(1) };
  }
  return {
    safeB: root.getPropertyValue('--safe-b').trim(),
    safeAreaBottom: root.getPropertyValue('--safe-area-bottom').trim(),
    navBlock: root.getPropertyValue('--nav-block').trim(),
    nav: g('.mobile-nav'), navContent,
    header: g('header.topbar'),
    main: (() => { const m = document.querySelector('main'); return m ? { pb: getComputedStyle(m).paddingBottom, pt: getComputedStyle(m).paddingTop } : null; })(),
    floatingCart: g('.floating-cart'),
    trackingView: (() => { const v = document.querySelector('[data-view="tracking"]'); return v ? { pb: getComputedStyle(v).paddingBottom } : null; })(),
    trackingSheet: g('.tracking-sheet'),
    catalogSheetActions: g('.catalog-filters-actions'),
    modalActions: g('.modal-actions'),
    toast: g('.toast'),
    pwaBanner: g('.pwa-banner'),
  };
};

const b = await webkit.launch();
const out = {};
for (const inset of [0, 34]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
  await p.waitForTimeout(5000);
  if (inset) {
    await p.addStyleTag({ content: `:root{--safe-area-bottom:${inset}px !important;--safe-area-top:59px !important;--safe-b:${inset}px !important;--safe-t:59px !important;}` });
    await p.waitForTimeout(600);
  }
  await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  await p.waitForTimeout(400);
  const rec = { home: await p.evaluate(snap) };
  await p.screenshot({ path: `${OUT}/shots3/safe-${inset}-home.png` });
  // catalog + open filters sheet
  await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'catalog'); if (x) x.click(); });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { const s = document.querySelector('[data-catalog-filters] summary'); if (s) s.click(); });
  await p.waitForTimeout(1200);
  rec.catalogFilters = await p.evaluate(snap);
  await p.screenshot({ path: `${OUT}/shots3/safe-${inset}-filters.png` });
  await p.evaluate(() => { const d = document.querySelector('[data-catalog-filters]'); if (d) d.removeAttribute('open'); });
  await p.waitForTimeout(600);
  // product modal
  await p.evaluate(() => { const d = document.querySelector('[data-product-grid] [data-product-detail]') || document.querySelector('[data-product-detail]'); if (d) d.click(); });
  await p.waitForTimeout(2200);
  rec.ficha = await p.evaluate(snap);
  await p.screenshot({ path: `${OUT}/shots3/safe-${inset}-ficha.png` });
  await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  await p.waitForTimeout(600);
  // cart with items
  await p.evaluate(() => { [...document.querySelectorAll('[data-add-product]')].filter(x => !x.disabled).slice(0, 2).forEach(x => x.click()); });
  await p.waitForTimeout(1800);
  rec.catalogWithCart = await p.evaluate(snap);
  await p.screenshot({ path: `${OUT}/shots3/safe-${inset}-catalog-cart.png` });
  await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'cart'); if (x) x.click(); });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const s = document.querySelector('[data-checkout-submit]'); if (s) s.scrollIntoView({ block: 'end' }); });
  await p.waitForTimeout(1200);
  rec.checkoutBottom = await p.evaluate(snap);
  rec.submitVsNav = await p.evaluate(() => {
    const s = document.querySelector('[data-checkout-submit]'); const n = document.querySelector('.mobile-nav');
    if (!s || !n) return null;
    const sr = s.getBoundingClientRect(), nr = n.getBoundingClientRect();
    return { submitTop: +sr.top.toFixed(1), submitBottom: +sr.bottom.toFixed(1), navTop: +nr.top.toFixed(1), overlapPx: +Math.max(0, sr.bottom - nr.top).toFixed(1), vh: window.innerHeight };
  });
  await p.screenshot({ path: `${OUT}/shots3/safe-${inset}-checkout-bottom.png` });
  await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'tracking'); if (x) x.click(); });
  await p.waitForTimeout(2500);
  rec.tracking = await p.evaluate(snap);
  await p.screenshot({ path: `${OUT}/shots3/safe-${inset}-tracking.png` });
  out[inset] = rec;
  await ctx.close();
}
await b.close();
fs.writeFileSync(OUT + '/safearea.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
