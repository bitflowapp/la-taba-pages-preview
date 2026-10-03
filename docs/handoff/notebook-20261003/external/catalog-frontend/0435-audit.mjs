import { chromium, webkit } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const OUT = '.local/mobile-audit';
const WIDTHS = [320, 390, 430];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const probe = () => {
  const R = (el) => el.getBoundingClientRect();
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = R(el); return r.width > 0 && r.height > 0;
  };
  const path = (el) => {
    const bits = [];
    let n = el, d = 0;
    while (n && n.nodeType === 1 && d < 4) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      const cls = (n.className && typeof n.className === 'string') ? n.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      if (cls) s += '.' + cls;
      const da = [...n.attributes].map(a => a.name).filter(a => a.startsWith('data-'))[0];
      if (da) s += '[' + da + ']';
      bits.unshift(s); n = n.parentElement; d++;
    }
    return bits.join(' > ');
  };

  const de = document.documentElement;
  const docOverflow = { docScrollWidth: de.scrollWidth, docClientWidth: de.clientWidth, bodyScrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth };

  const offenders = [];
  const vw = de.clientWidth;
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = R(el);
    const cs = getComputedStyle(el);
    const overRight = r.right - vw;
    const overLeft = -r.left;
    if (overRight > 1 || overLeft > 1) {
      offenders.push({ sel: path(el), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), overRight: +overRight.toFixed(1), overLeft: +overLeft.toFixed(1), pos: cs.position, ox: cs.overflowX });
    }
  }
  offenders.sort((a, b) => Math.max(b.overRight, b.overLeft) - Math.max(a.overRight, a.overLeft));

  const buySel = '[data-add-product], [data-qty], [data-cart-qty], [data-remove-item], [data-checkout-submit], [data-nav-view], [data-product-detail], button, a[href], input, select, [role="tab"]';
  const small = [];
  for (const el of document.querySelectorAll(buySel)) {
    if (!vis(el)) continue;
    const r = R(el);
    if (r.width < 44 || r.height < 44) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      small.push({ sel: path(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), text: t, aria: (el.getAttribute('aria-label') || '').slice(0, 40) });
    }
  }

  const tiny = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.replace(/\s+/g, ' ').trim();
    if (!own) continue;
    const fsz = parseFloat(getComputedStyle(el).fontSize);
    if (fsz < 12) tiny.push({ sel: path(el), fontSize: fsz, text: own.slice(0, 50) });
  }

  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
    if (!hasText) continue;
    const ovH = cs.overflowX === 'hidden' || cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis';
    const ovV = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
    if (ovH && el.scrollWidth - el.clientWidth > 2) {
      clipped.push({ sel: path(el), kind: 'h', over: el.scrollWidth - el.clientWidth, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
    } else if (ovV && el.scrollHeight - el.clientHeight > 2 && cs.webkitLineClamp === 'none') {
      clipped.push({ sel: path(el), kind: 'v', over: el.scrollHeight - el.clientHeight, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
    }
  }

  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);visibility:hidden';
  document.body.appendChild(t);
  const tc = getComputedStyle(t);
  const envSupport = { top: tc.paddingTop, bottom: tc.paddingBottom, left: tc.paddingLeft, right: tc.paddingRight, supportsEnv: CSS.supports('padding-bottom: env(safe-area-inset-bottom)') };
  t.remove();

  const chrome = {};
  const grab = (name, sel) => {
    const el = document.querySelector(sel);
    if (!el || !vis(el)) { chrome[name] = null; return; }
    const cs = getComputedStyle(el); const r = R(el);
    chrome[name] = { sel: path(el), pos: cs.position, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1), pb: cs.paddingBottom, pt: cs.paddingTop, z: cs.zIndex };
  };
  grab('bottomNav', '.mobile-nav, [data-mobile-nav], nav.mobile-nav');
  grab('header', 'header, .topbar, [data-topbar]');
  grab('floatingCart', '[data-cart-fab], .cart-fab, .floating-cart, [data-floating-cart], .cart-dock, [data-cart-dock]');
  chrome.bodyPaddingBottom = getComputedStyle(document.body).paddingBottom;
  const main = document.querySelector('main');
  if (main) chrome.mainPaddingBottom = getComputedStyle(main).paddingBottom;

  return {
    docOverflow,
    offenders: offenders.slice(0, 20),
    offendersTotal: offenders.length,
    small: small.slice(0, 40),
    smallTotal: small.length,
    tiny: tiny.slice(0, 20),
    tinyTotal: tiny.length,
    clipped: clipped.slice(0, 15),
    clippedTotal: clipped.length,
    envSupport,
    chrome,
    viewportMeta: document.querySelector('meta[name=viewport]') ? document.querySelector('meta[name=viewport]').getAttribute('content') : null
  };
};

const foldCount = (fold) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0 && r.top < fold && r.bottom > 0 && r.right > 0;
  };
  const cards = [...document.querySelectorAll('[data-add-product], [data-product-detail]')];
  const seen = new Set();
  let n = 0;
  const names = [];
  for (const c of cards) {
    if (!visible(c)) continue;
    const card = c.closest('[data-product-id], article, li') || c.parentElement || c;
    if (seen.has(card)) continue;
    seen.add(card); n++;
    names.push((card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 45));
  }
  const priceRe = /\$\s?[\d][\d.,]{2,}/;
  let prices = 0;
  const pricesTxt = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const txt = (el.textContent || '').trim();
    if (!priceRe.test(txt)) continue;
    if (!visible(el)) continue;
    prices++; pricesTxt.push(txt.slice(0, 30));
  }
  return { productsAboveFold: n, pricesAboveFold: prices, fold, names: names.slice(0, 10), pricesTxt: pricesTxt.slice(0, 10) };
};

async function run(engine, name, ua) {
  const b = await engine.launch();
  const results = {};
  for (const w of WIDTHS) {
    const h = w === 320 ? 568 : (w === 390 ? 844 : 932);
    const opts = { viewport: { width: w, height: h }, userAgent: ua, hasTouch: true, deviceScaleFactor: 2 };
    if (name === 'chromium') opts.isMobile = true;
    const ctx = await b.newContext(opts);
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    p.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 160)));
    const per = {};
    try {
      await p.goto(BASE, { waitUntil: 'networkidle', timeout: 90000 });
      await p.waitForTimeout(4500);

      for (const v of ['home', 'catalog', 'cart', 'tracking', 'profile']) {
        if (v !== 'home') {
          await p.evaluate((vv) => {
            const btn = [...document.querySelectorAll('[data-nav-view]')].find(x => x.getAttribute('data-nav-view') === vv && !x.hasAttribute('data-nav-passive'));
            if (btn) btn.click();
          }, v);
          await p.waitForTimeout(2200);
        }
        per[v] = await p.evaluate(probe);
        per[v].fold = await p.evaluate(foldCount, h);
        await p.screenshot({ path: OUT + '/shots/' + name + '-' + w + '-' + v + '.png' });
      }

      await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'catalog'); if (x) x.click(); });
      await p.waitForTimeout(2000);
      const opened = await p.evaluate(() => { const d = document.querySelector('[data-product-detail]'); if (d) { d.click(); return true; } return false; });
      if (opened) {
        await p.waitForTimeout(2200);
        per.ficha = await p.evaluate(probe);
        per.ficha.fold = await p.evaluate(foldCount, h);
        await p.screenshot({ path: OUT + '/shots/' + name + '-' + w + '-ficha.png' });
        await p.keyboard.press('Escape').catch(() => {});
        await p.waitForTimeout(1000);
      } else { per.ficha = { error: 'no data-product-detail' }; }

      const added = await p.evaluate(() => {
        const btns = [...document.querySelectorAll('[data-add-product]')].filter(x => !x.disabled);
        if (!btns.length) return 0;
        btns[0].click(); if (btns[1]) btns[1].click();
        return btns.length;
      });
      await p.waitForTimeout(2000);
      await p.evaluate(() => { const x = [...document.querySelectorAll('[data-nav-view]')].find(y => y.getAttribute('data-nav-view') === 'cart'); if (x) x.click(); });
      await p.waitForTimeout(2800);
      per.cartFull = await p.evaluate(probe);
      per.cartFull.addedButtons = added;
      await p.screenshot({ path: OUT + '/shots/' + name + '-' + w + '-cart-full.png' });
      await p.screenshot({ path: OUT + '/shots/' + name + '-' + w + '-cart-full-page.png', fullPage: true });

      const chk = await p.evaluate(() => {
        const f = document.querySelector('[data-checkout-form]');
        if (!f) return false;
        f.scrollIntoView({ block: 'start' });
        return true;
      });
      if (chk) {
        await p.waitForTimeout(1200);
        per.checkout = await p.evaluate(probe);
        await p.screenshot({ path: OUT + '/shots/' + name + '-' + w + '-checkout.png' });
      } else { per.checkout = { error: 'no checkout form' }; }
    } catch (e) {
      per.__error = String(e).slice(0, 500);
    }
    per.__console = errs.slice(0, 10);
    results[w] = per;
    await ctx.close();
  }
  await b.close();
  return results;
}

const out = {};
out.webkit = await run(webkit, 'webkit', IPHONE_UA);
console.log('webkit done');
out.chromium = await run(chromium, 'chromium', ANDROID_UA);
console.log('chromium done');
fs.writeFileSync(OUT + '/results.json', JSON.stringify(out, null, 1));
console.log('WROTE results.json');
