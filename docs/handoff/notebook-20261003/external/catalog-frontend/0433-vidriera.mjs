import { chromium } from '@playwright/test';
const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const OUT = process.env.OUT || './.local/shots';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:2,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
const errs=[]; p.on('console', m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
p.on('pageerror', e=>errs.push('PAGEERROR '+String(e).slice(0,200)));
await p.goto(BASE, { waitUntil:'networkidle', timeout:90000 });
await p.waitForTimeout(5000);

await p.screenshot({ path: OUT+'/01-fold-390.png' });
await p.screenshot({ path: OUT+'/02-full-390.png', fullPage: true });

const r = await p.evaluate(() => {
  const FOLD = window.innerHeight;
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.top < FOLD && b.bottom > 0 && b.width>0 && b.height>0; };
  const rect = (el) => { const b = el.getBoundingClientRect(); return {t:Math.round(b.top+window.scrollY), h:Math.round(b.height)}; };
  const clean = (s) => (s||'').replace(/\s+/g,' ').trim();

  // Todo el texto visible antes del pliegue
  const foldTexts = [];
  document.querySelectorAll('body *').forEach(el=>{
    if (el.children.length) return;
    const t = clean(el.textContent); if (!t) return;
    if (!vis(el)) return;
    const cs = getComputedStyle(el); if (cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0) return;
    foldTexts.push(t);
  });

  const cards = [...document.querySelectorAll('[data-add-product]')];
  const allCards = [...document.querySelectorAll('article, [data-product-id], .product-card, [data-offer-card]')];

  // precios visibles
  const priceEls = [...document.querySelectorAll('body *')].filter(el=>!el.children.length && /^\$\s?[\d.,]+/.test(clean(el.textContent)));
  const pricesFold = priceEls.filter(vis).map(e=>clean(e.textContent));

  // productos con nombre visibles en pliegue
  const nameSel = '[data-product-name-text], .offer-card-name, .product-card-name, .product-name, h3';
  const namesFold = [...document.querySelectorAll(nameSel)].filter(vis).map(e=>clean(e.textContent)).filter(Boolean);

  // secciones de la home en orden
  const home = document.querySelector('[data-view="home"]');
  const secs = home ? [...home.querySelectorAll('section, .home-merch-section, [data-home-sections] > *, .home-brand-banners > *, .home-hero-promo-slot')]
    .filter(s=>s.offsetParent!==null || s.getBoundingClientRect().height>0)
    .map(s=>({ tag:s.tagName, cls:(s.className||'').toString().slice(0,70), h:clean((s.querySelector('h1,h2,h3')||{}).textContent), ...rect(s), hidden:s.hasAttribute('hidden'), cards:s.querySelectorAll('[data-add-product]').length })) : [];

  const railItems = (sel) => [...document.querySelectorAll(sel+' [data-add-product]')].map(btn=>{
    const card = btn.closest('article,[data-product-id],li,div');
    return clean(card?.innerText).slice(0,110);
  });

  return {
    url: location.href, title: document.title, fold: FOLD, docH: document.documentElement.scrollHeight,
    businessName: clean(document.querySelector('[data-business-name]')?.textContent),
    searchAria: document.querySelector('.topbar-search')?.getAttribute('aria-label'),
    foldTexts,
    foldPriceCount: pricesFold.length, pricesFold,
    foldNames: namesFold,
    foldAddButtons: cards.filter(vis).length,
    totalAddButtons: cards.length,
    secs,
    bestSellers: railItems('[data-home-best-sellers]'),
    combos: railItems('[data-combos-rail]'),
    promotions: railItems('[data-home-promotions]'),
    homeSectionsOrder: [...document.querySelectorAll('[data-home-sections] > *')].map(s=>({ h:clean((s.querySelector('h2,h3')||{}).textContent), n:s.querySelectorAll('[data-add-product]').length, first:[...s.querySelectorAll('[data-add-product]')].slice(0,6).map(btn=>clean(btn.closest('article,[data-product-id],li,div')?.innerText).slice(0,70)) })),
    banners: [...document.querySelectorAll('[data-home-banners] *')].filter(e=>!e.children.length).map(e=>clean(e.textContent)).filter(Boolean).slice(0,20),
    heroPromo: clean(document.querySelector('[data-home-hero-promo]')?.innerText),
    editorial: railItems('[data-home-editorial-rail]'),
    editorialRaw: clean(document.querySelector('[data-home-editorial-section]')?.innerText).slice(0,600),
    catStrip: [...document.querySelectorAll('[data-home-category-strip] button, [data-home-category-strip] a')].map(e=>clean(e.textContent)),
    bodyTextHead: clean(document.body.innerText).slice(0,3000),
  };
});
console.log(JSON.stringify(r,null,1));
console.log('ERRORS:', JSON.stringify(errs.slice(0,10),null,1));
await b.close();
