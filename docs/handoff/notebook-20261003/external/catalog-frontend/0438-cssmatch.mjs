import { webkit } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://la-taba.pages.dev';
const OUT = '.local/mobile-audit';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const matched = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const hits = [];
  const walk = (rules, media) => {
    for (const r of rules) {
      if (r.type === 4 || r.type === 12) { walk(r.cssRules || [], (media ? media + ' && ' : '') + (r.conditionText || r.media?.mediaText || '')); continue; }
      if (r.type !== 1) continue;
      let m = false;
      try { m = el.matches(r.selectorText); } catch (_) { }
      if (!m) continue;
      const txt = r.style.cssText;
      if (!/padding|bottom|top|height|margin|inset/.test(txt)) continue;
      hits.push({ media: media || '(all)', selector: r.selectorText.slice(0, 120), css: txt.slice(0, 300), href: (r.parentStyleSheet && r.parentStyleSheet.href || '').split('/').pop() });
    }
  };
  for (const ss of document.styleSheets) {
    try { walk(ss.cssRules || [], ''); } catch (_) { hits.push({ media: 'CORS-BLOCKED', selector: ss.href || '?', css: '', href: '' }); }
  }
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { sel, found: true, computed: { pb: cs.paddingBottom, pt: cs.paddingTop, bottom: cs.bottom, height: cs.height, position: cs.position }, rect: { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }, vh: window.innerHeight, gapBelow: +(window.innerHeight - r.bottom).toFixed(1), hits };
};

const b = await webkit.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA, hasTouch: true });
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
await p.waitForTimeout(5000);
await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
const out = {};
out.nav = await p.evaluate(matched, '.mobile-nav');
out.topbar = await p.evaluate(matched, 'header.topbar');
// catalog + filters sheet
await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'catalog'); if (x) x.click(); });
await p.waitForTimeout(2200);
await p.evaluate(() => { const s = document.querySelector('[data-catalog-filters] summary'); if (s) s.click(); });
await p.waitForTimeout(1500);
out.filtersSheet = await p.evaluate(matched, '.catalog-filters-sheet');
out.filtersActions = await p.evaluate(matched, '.catalog-filters-actions');
out.filtersOpen = await p.evaluate(() => { const d = document.querySelector('[data-catalog-filters]'); return d ? { open: d.hasAttribute('open'), cls: d.className } : null; });
await p.evaluate(() => { const d = document.querySelector('[data-catalog-filters]'); if (d) d.removeAttribute('open'); });
await p.waitForTimeout(600);
// ficha modal
await p.evaluate(() => { const d = document.querySelector('[data-product-grid] [data-product-detail]') || document.querySelector('[data-product-detail]'); if (d) d.click(); });
await p.waitForTimeout(2200);
out.modalActions = await p.evaluate(matched, '.modal-actions');
out.productModal = await p.evaluate(matched, '.product-modal, dialog[open] .modal-card');
await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
await p.waitForTimeout(600);
// floating cart
await p.evaluate(() => { [...document.querySelectorAll('[data-add-product]')].filter(x => !x.disabled).slice(0, 1).forEach(x => x.click()); });
await p.waitForTimeout(1800);
out.floatingCart = await p.evaluate(matched, '.floating-cart');
// tracking
await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'tracking'); if (x) x.click(); });
await p.waitForTimeout(2500);
out.trackingSheet = await p.evaluate(matched, '.tracking-sheet');
out.trackingView = await p.evaluate(matched, '[data-view="tracking"]');
await ctx.close(); await b.close();
fs.writeFileSync(OUT + '/cssmatch.json', JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  if (!v || !v.found) { console.log('###', k, JSON.stringify(v)); continue; }
  console.log('###', k, '| computed', JSON.stringify(v.computed), '| rect', JSON.stringify(v.rect), 'gapBelow', v.gapBelow);
  (v.hits || []).forEach(h => console.log('   [' + h.href + '] ' + h.media + ' :: ' + h.selector + ' { ' + h.css + ' }'));
}
