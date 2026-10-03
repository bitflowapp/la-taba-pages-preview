import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const OUT = '.local/mobile-audit';
const WIDTHS = [320, 390, 430];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// ---- in-page helpers -------------------------------------------------------
const probe2 = () => {
  const R = (el) => el.getBoundingClientRect();
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = R(el); return r.width > 0 && r.height > 0;
  };
  const path = (el) => {
    const bits = []; let n = el, d = 0;
    while (n && n.nodeType === 1 && d < 4) {
      let s = n.tagName.toLowerCase();
      const cls = (typeof n.className === 'string' && n.className.trim()) ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      s += cls;
      const da = [...n.attributes].map(a => a.name).find(a => a.startsWith('data-'));
      if (da) s += '[' + da + ']';
      bits.unshift(s); n = n.parentElement; d++;
    }
    return bits.join(' > ');
  };
  // ancestor that scrolls horizontally on purpose
  const inRail = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) return path(n);
      n = n.parentElement;
    }
    return null;
  };

  const de = document.documentElement;
  const vw = de.clientWidth;
  const docOverflow = { docScrollWidth: de.scrollWidth, docClientWidth: vw, bodyScrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth, canScrollX: de.scrollWidth > vw + 1 };

  const realOverflow = [];
  const railClipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = R(el);
    const over = Math.max(r.right - vw, -r.left);
    if (over <= 1) continue;
    const rail = inRail(el);
    const rec = { sel: path(el), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), over: +over.toFixed(1), pos: getComputedStyle(el).position };
    if (rail) { rec.rail = rail; railClipped.push(rec); } else realOverflow.push(rec);
  }
  realOverflow.sort((a, b) => b.over - a.over);

  // horizontally scrollable containers that are NOT meant to scroll (no rail class)
  const scrollers = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    if (el.scrollWidth - el.clientWidth > 2) {
      const cs = getComputedStyle(el);
      scrollers.push({ sel: path(el), over: el.scrollWidth - el.clientWidth, ox: cs.overflowX, cw: el.clientWidth });
    }
  }

  // touch targets, split by relevance
  const groups = {
    buy: '[data-add-product], [data-product-detail], [data-qty], [data-cart-qty], [data-quantity], [data-remove-item], [data-checkout-submit], .add-button, .qty-stepper button, .icon-button',
    filters: '[data-category-id], [data-catalog-filters] button, [data-catalog-filters] summary, [data-catalog-filters] select, [data-sort], .category-button',
    nav: '.mobile-nav button, .topbar button, header button, [data-nav-view]',
    other: 'button, a[href], input, select, [role="tab"], [role="button"]'
  };
  const touch = {};
  const seen = new Set();
  for (const [g, sel] of Object.entries(groups)) {
    touch[g] = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el) || seen.has(el)) continue;
      seen.add(el);
      const r = R(el);
      if (r.width < 44 || r.height < 44) {
        touch[g].push({ sel: path(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34), aria: (el.getAttribute('aria-label') || '').slice(0, 34) });
      }
    }
  }

  const tiny = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.replace(/\s+/g, ' ').trim();
    if (!own) continue;
    const f = parseFloat(getComputedStyle(el).fontSize);
    if (f < 12) tiny.push({ sel: path(el), f, text: own.slice(0, 40) });
  }
  const tinyByRule = {};
  for (const t of tiny) { const k = t.sel.split(' > ').pop() + '@' + t.f; tinyByRule[k] = (tinyByRule[k] || 0) + 1; }

  // clipped text
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!hasText) continue;
    const clampN = cs.webkitLineClamp;
    if ((cs.overflowX === 'hidden' || cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth - el.clientWidth > 2) {
      clipped.push({ sel: path(el), kind: 'ellipsis-x', over: el.scrollWidth - el.clientWidth, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) });
    } else if ((cs.overflowY === 'hidden' || cs.overflow === 'hidden') && el.scrollHeight - el.clientHeight > 2) {
      clipped.push({ sel: path(el), kind: clampN !== 'none' ? 'line-clamp-' + clampN : 'cut-y', over: el.scrollHeight - el.clientHeight, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) });
    }
  }

  // chrome geometry
  const geo = (sel) => {
    const el = document.querySelector(sel);
    if (!el || !vis(el)) return null;
    const cs = getComputedStyle(el); const r = R(el);
    return { sel: path(el), pos: cs.position, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1), pb: cs.paddingBottom, pt: cs.paddingTop, z: cs.zIndex };
  };
  const chrome = {
    nav: geo('.mobile-nav'),
    header: geo('header.topbar, header'),
    floatingCart: geo('.floating-cart'),
    catalogSticky: geo('.catalog-sticky, [data-catalog-sticky]'),
    main: (() => { const m = document.querySelector('main'); return m ? { pb: getComputedStyle(m).paddingBottom, pt: getComputedStyle(m).paddingTop } : null; })(),
    activeView: (() => { const v = document.querySelector('.app-view.is-active, .app-view:not([hidden])'); if (!v) return null; const cs = getComputedStyle(v); return { view: v.getAttribute('data-view'), pb: cs.paddingBottom, pt: cs.paddingTop }; })(),
    trackingSheet: geo('.tracking-sheet'),
    modalActions: geo('.modal-actions'),
  };

  // elements overlapped by the fixed bottom nav
  const navR = document.querySelector('.mobile-nav') ? R(document.querySelector('.mobile-nav')) : null;
  const underNav = [];
  if (navR) {
    for (const el of document.querySelectorAll('[data-add-product],[data-checkout-submit],[data-product-detail],.add-button,[data-qty],button.primary-button')) {
      if (!vis(el)) continue;
      const r = R(el);
      if (r.bottom > navR.top && r.top < navR.bottom && r.top < window.innerHeight) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') continue;
        underNav.push({ sel: path(el), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), navTop: +navR.top.toFixed(1), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) });
      }
    }
  }

  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden';
  document.body.appendChild(t);
  const tc = getComputedStyle(t);
  const env = { top: tc.paddingTop, bottom: tc.paddingBottom };
  t.remove();
  const rootTok = getComputedStyle(document.documentElement);
  const tokens = { safeB: rootTok.getPropertyValue('--safe-b').trim(), navBlock: rootTok.getPropertyValue('--nav-block').trim(), bottomReserve: getComputedStyle(document.body).getPropertyValue('--bottom-reserve').trim() };

  const openDialog = (() => { const d = document.querySelector('dialog[open]'); return d ? { sel: path(d), text: (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), modal: d.matches(':modal') } : null; })();

  return { docOverflow, realOverflow: realOverflow.slice(0, 15), realOverflowTotal: realOverflow.length, railClippedTotal: railClipped.length, scrollers: scrollers.slice(0, 12), touch, tinyTotal: tiny.length, tinyByRule, tiny: tiny.slice(0, 8), clipped: clipped.slice(0, 15), clippedTotal: clipped.length, chrome, underNav: underNav.slice(0, 10), env, tokens, openDialog, viewportMeta: (document.querySelector('meta[name=viewport]') || {}).content };
};

// occlusion-aware above-the-fold count
const fold2 = (h) => {
  const topOf = (x, y) => document.elementFromPoint(x, y);
  const visRect = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    if (r.top >= h || r.bottom <= 0 || r.width <= 0 || r.height <= 0) return null;
    return r;
  };
  const reachable = (el) => {
    const r = visRect(el); if (!r) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 2), window.innerWidth - 2);
    const y = Math.min(Math.max(r.top + r.height / 2, 2), h - 2);
    const hit = topOf(x, y);
    return !!hit && (el.contains(hit) || hit.contains(el) || el === hit);
  };
  const cards = new Map();
  for (const c of document.querySelectorAll('[data-add-product], [data-product-detail]')) {
    const card = c.closest('article, li, [data-product-id]') || c.parentElement || c;
    if (!cards.has(card)) cards.set(card, []);
    cards.get(card).push(c);
  }
  let products = 0, productsReachable = 0;
  const names = [];
  for (const [card, ctrls] of cards) {
    const r = visRect(card); if (!r) continue;
    products++;
    if (ctrls.some(reachable)) { productsReachable++; names.push((card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)); }
  }
  const priceRe = /\$\s?\d[\d.,]{2,}/;
  let prices = 0, pricesReachable = 0;
  const ptxt = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const txt = (el.textContent || '').trim();
    if (!priceRe.test(txt)) continue;
    if (!visRect(el)) continue;
    prices++;
    if (reachable(el)) { pricesReachable++; ptxt.push(txt.slice(0, 24)); }
  }
  return { fold: h, products, productsReachable, prices, pricesReachable, names: names.slice(0, 12), ptxt: ptxt.slice(0, 12) };
};

const dismissInvite = async (p) => {
  await p.evaluate(() => {
    for (const d of document.querySelectorAll('dialog[open]')) {
      const no = [...d.querySelectorAll('button')].find(b => /ahora no|cerrar|no gracias/i.test(b.textContent || '') || /cerrar/i.test(b.getAttribute('aria-label') || ''));
      if (no) no.click(); else d.close();
    }
  });
  await p.waitForTimeout(700);
};

const nav = async (p, v) => {
  await p.evaluate((vv) => {
    const b = [...document.querySelectorAll('[data-nav-view]')].find(x => x.getAttribute('data-nav-view') === vv && !x.hasAttribute('data-nav-passive'));
    if (b) b.click();
  }, v);
  await p.waitForTimeout(2200);
};

async function run(engine, name, ua, safeArea) {
  const b = await engine.launch();
  const res = {};
  for (const w of WIDTHS) {
    const h = w === 320 ? 568 : (w === 390 ? 844 : 932);
    const o = { viewport: { width: w, height: h }, userAgent: ua, hasTouch: true, deviceScaleFactor: 2 };
    if (name === 'chromium') o.isMobile = true;
    const ctx = await b.newContext(o);
    if (safeArea) {
      await ctx.addInitScript(() => {
        const s = document.createElement('style');
        s.textContent = ':root{--safe-area-bottom:34px !important;--safe-area-top:59px !important;}';
        (document.head || document.documentElement).appendChild(s);
        new MutationObserver(() => { if (document.head && s.parentNode !== document.head) document.head.appendChild(s); }).observe(document.documentElement, { childList: true });
      });
    }
    const p = await ctx.newPage();
    const per = {};
    const tag = name + (safeArea ? '-safe' : '') + '-' + w;
    try {
      await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
      await p.waitForTimeout(5000);
      per.firstPaint = { probe: await p.evaluate(probe2), fold: await p.evaluate(fold2, h) };
      await p.screenshot({ path: `${OUT}/shots2/${tag}-00-firstpaint.png` });
      await dismissInvite(p);

      for (const v of ['home', 'catalog']) {
        if (v !== 'home') await nav(p, v); else await nav(p, 'home');
        await dismissInvite(p);
        per[v] = { probe: await p.evaluate(probe2), fold: await p.evaluate(fold2, h) };
        await p.screenshot({ path: `${OUT}/shots2/${tag}-${v}.png` });
      }

      // ficha
      await nav(p, 'catalog'); await dismissInvite(p);
      const opened = await p.evaluate(() => {
        const grid = document.querySelector('[data-product-grid]');
        const d = (grid && grid.querySelector('[data-product-detail]')) || document.querySelector('[data-product-detail]');
        if (!d) return false; d.click(); return true;
      });
      await p.waitForTimeout(2500);
      per.ficha = { opened, probe: await p.evaluate(probe2), fold: await p.evaluate(fold2, h) };
      await p.screenshot({ path: `${OUT}/shots2/${tag}-ficha.png` });
      await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
      await p.waitForTimeout(800);

      // add 2 products
      const added = await p.evaluate(() => {
        const bs = [...document.querySelectorAll('[data-add-product]')].filter(x => !x.disabled);
        bs.slice(0, 2).forEach(x => x.click());
        return bs.length;
      });
      await p.waitForTimeout(2000);
      per.catalogWithCart = { added, probe: await p.evaluate(probe2), fold: await p.evaluate(fold2, h) };
      await p.screenshot({ path: `${OUT}/shots2/${tag}-catalog-cart.png` });

      await nav(p, 'cart'); await dismissInvite(p);
      per.cart = { probe: await p.evaluate(probe2) };
      await p.screenshot({ path: `${OUT}/shots2/${tag}-cart.png` });
      await p.screenshot({ path: `${OUT}/shots2/${tag}-cart-fullpage.png`, fullPage: true });

      const ok = await p.evaluate(() => { const f = document.querySelector('[data-checkout-form]'); if (!f) return false; f.scrollIntoView({ block: 'start' }); return true; });
      if (ok) { await p.waitForTimeout(1200); per.checkout = { probe: await p.evaluate(probe2) }; await p.screenshot({ path: `${OUT}/shots2/${tag}-checkout.png` }); }

      // checkout bottom (submit button area)
      await p.evaluate(() => { const s = document.querySelector('[data-checkout-submit]'); if (s) s.scrollIntoView({ block: 'end' }); });
      await p.waitForTimeout(1000);
      per.checkoutBottom = { probe: await p.evaluate(probe2) };
      await p.screenshot({ path: `${OUT}/shots2/${tag}-checkout-bottom.png` });

      await nav(p, 'tracking'); await dismissInvite(p);
      per.tracking = { probe: await p.evaluate(probe2) };
      await p.screenshot({ path: `${OUT}/shots2/${tag}-tracking.png` });
      await p.screenshot({ path: `${OUT}/shots2/${tag}-tracking-fullpage.png`, fullPage: true });
    } catch (e) { per.__error = String(e).slice(0, 400); }
    res[w] = per;
    await ctx.close();
  }
  await b.close();
  return res;
}

fs.mkdirSync(OUT + '/shots2', { recursive: true });
const out = {};
out.webkit = await run(webkit, 'webkit', IPHONE_UA, false);
console.log('wk plain done');
out.webkitSafe = await run(webkit, 'webkit', IPHONE_UA, true);
console.log('wk safe done');
out.chromium = await run(chromium, 'chromium', ANDROID_UA, false);
console.log('cr done');
fs.writeFileSync(OUT + '/results2.json', JSON.stringify(out, null, 1));
console.log('WROTE results2.json');
