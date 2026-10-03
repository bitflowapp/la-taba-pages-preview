import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
const BASE = 'https://la-taba.pages.dev';
const OUT = '.local/mobile-audit';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// Safari on iPhone: the visible viewport in a tab is smaller than the layout
// viewport. We report both: layout fold (= viewport height) and a Safari-real
// fold that subtracts the browser chrome that Playwright does not draw.
const SAFARI_CHROME = { 320: 124, 390: 141, 430: 141 }; // top bar + bottom bar, iOS 17 tab

const count = ({ fold }) => {
  const vw = document.documentElement.clientWidth;
  const nav = document.querySelector('.mobile-nav');
  const navTop = nav ? nav.getBoundingClientRect().top : fold;
  const ceiling = Math.min(fold, navTop);
  const inside = (r) => r.top >= 0 && r.bottom <= ceiling && r.left >= 0 && r.right <= vw && r.width > 0 && r.height > 0;
  const shown = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const occluded = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || x > vw || y < 0 || y > ceiling) return true;
    const hit = document.elementFromPoint(x, y);
    return !(hit && (el.contains(hit) || hit.contains(el)));
  };
  const priceRe = /\$\s?\d[\d.,]{2,}/;

  const cards = new Set();
  for (const c of document.querySelectorAll('[data-add-product], [data-product-detail]')) {
    const card = c.closest('article, li, [data-product-id]');
    if (card) cards.add(card);
  }
  let fullyVisible = 0, withPrice = 0, withAdd = 0, buyable = 0;
  const detail = [];
  for (const card of cards) {
    if (!shown(card)) continue;
    const r = card.getBoundingClientRect();
    if (!inside(r)) continue;
    if (occluded(card)) continue;
    fullyVisible++;
    const priceEl = [...card.querySelectorAll('*')].find(e => !e.children.length && priceRe.test((e.textContent || '').trim()) && shown(e) && inside(e.getBoundingClientRect()) && !occluded(e));
    const addEl = [...card.querySelectorAll('[data-add-product]')].find(e => shown(e) && inside(e.getBoundingClientRect()) && !occluded(e));
    if (priceEl) withPrice++;
    if (addEl) withAdd++;
    if (priceEl && addEl) buyable++;
    detail.push({ name: (card.querySelector('h3, strong') || {}).textContent?.trim().slice(0, 30) || '', price: priceEl ? priceEl.textContent.trim() : null, add: !!addEl });
  }
  // any visible price anywhere above the fold
  let anyPrice = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!priceRe.test(t)) continue;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (!inside(r) || occluded(el)) continue;
    anyPrice++;
  }
  return { ceiling: +ceiling.toFixed(0), navTop: +navTop.toFixed(0), cardsFullyVisible: fullyVisible, cardsWithVisiblePrice: withPrice, cardsWithVisibleAdd: withAdd, buyableCards: buyable, anyVisiblePrice: anyPrice, detail: detail.slice(0, 12) };
};

async function go(engine, name, ua) {
  const b = await engine.launch();
  const res = {};
  for (const w of [320, 390, 430]) {
    const h = w === 320 ? 568 : (w === 390 ? 844 : 932);
    const o = { viewport: { width: w, height: h }, userAgent: ua, hasTouch: true, deviceScaleFactor: 2 };
    if (name === 'chromium') o.isMobile = true;
    const ctx = await b.newContext(o);
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
    await p.waitForTimeout(5000);
    const rec = {};
    rec.firstPaintDialog = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); return d ? (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : null; });
    rec.homeWithDialog = await p.evaluate(count, { fold: h });
    await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) { const n = [...d.querySelectorAll('button')].find(b => /ahora no/i.test(b.textContent || '')); n ? n.click() : d.close(); } });
    await p.waitForTimeout(900);
    rec.homeLayoutFold = await p.evaluate(count, { fold: h });
    rec.homeSafariFold = await p.evaluate(count, { fold: h - SAFARI_CHROME[w] });
    await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'catalog'); if (x) x.click(); });
    await p.waitForTimeout(2500);
    rec.catalogLayoutFold = await p.evaluate(count, { fold: h });
    rec.catalogSafariFold = await p.evaluate(count, { fold: h - SAFARI_CHROME[w] });
    await p.screenshot({ path: `${OUT}/shots4/${name}-${w}-catalog.png` });
    res[w] = rec;
    await ctx.close();
  }
  await b.close();
  return res;
}
fs.mkdirSync(OUT + '/shots4', { recursive: true });
const out = { webkit: await go(webkit, 'webkit', IPHONE_UA), chromium: await go(chromium, 'chromium', ANDROID_UA) };
fs.writeFileSync(OUT + '/fold.json', JSON.stringify(out, null, 1));
for (const [eng, ws] of Object.entries(out)) for (const [w, r] of Object.entries(ws)) {
  console.log('###', eng, w, 'dialog:', r.firstPaintDialog);
  for (const k of ['homeWithDialog', 'homeLayoutFold', 'homeSafariFold', 'catalogLayoutFold', 'catalogSafariFold']) {
    const v = r[k]; console.log('  ' + k.padEnd(20), 'ceiling', v.ceiling, '| cards', v.cardsFullyVisible, '| conPrecio', v.cardsWithVisiblePrice, '| conAgregar', v.cardsWithVisibleAdd, '| comprables', v.buyableCards, '| preciosVisibles', v.anyVisiblePrice);
  }
}
