import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(String(e).slice(0,160)));
await p.goto(BASE, { waitUntil:'networkidle', timeout:90000 });
await p.waitForTimeout(5000);

const out = {};
out.version = await p.evaluate(()=>({
  sw: document.querySelector('meta[name="taba-release"]')?.content || null,
  build: window.TABA_BUILD || window.__TABA_VERSION__ || null,
  title: document.title,
}));

// ---- HOME ----
out.home = await p.evaluate(() => {
  const clean = s => (s||'').replace(/\s+/g,' ').trim();
  const cardDump = (el) => {
    const art = el.closest('article, li, .product-card, .home-card, .rail-card') || el;
    return {
      brand: clean(art.querySelector('.product-brand, .card-brand, [data-brand]')?.textContent),
      name: clean(art.querySelector('h3,h4,.product-name,.card-title')?.textContent),
      lines: [...art.querySelectorAll('p, .product-unit, .card-unit, span')].map(n=>clean(n.textContent)).filter(t=>t && t.length<70),
      text: clean(art.innerText),
      ariaLabels: [...art.querySelectorAll('[aria-label]')].map(n=>n.getAttribute('aria-label')),
      imgAlt: [...art.querySelectorAll('img')].map(n=>n.getAttribute('alt')),
    };
  };
  const rails = {};
  const railSel = {
    bestSellers:'[data-home-best-sellers]', combos:'[data-combos-rail]', offers:'[data-offers-rail]',
    editorial:'[data-home-editorial-rail]', sections:'[data-home-sections]', promos:'[data-home-promotions]',
    banners:'[data-home-banners]', hero:'[data-home-hero-promo]', glow:'[data-glow-shelf]',
    categoryStrip:'[data-home-category-strip]', stories:'[data-stories-strip]',
  };
  for (const [k,sel] of Object.entries(railSel)) {
    const root = document.querySelector(sel);
    if (!root) { rails[k]=null; continue; }
    rails[k] = { heading: clean(root.querySelector('h2,h3')?.textContent),
      raw: clean(root.innerText).slice(0,3000),
      cards: [...root.querySelectorAll('[data-add-product],[data-product-detail]')].slice(0,60).map(cardDump) };
  }
  return { rails, allAria: [...document.querySelectorAll('[data-view="home"] [aria-label]')].map(n=>n.getAttribute('aria-label')).slice(0,120) };
});

// ---- CATALOG GRID ----
await p.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/Categor/i.test(x.textContent||'')); b&&b.click(); });
await p.waitForTimeout(2500);
await p.evaluate(async()=>{ for(let i=0;i<25;i++){ window.scrollBy(0,1200); await new Promise(r=>setTimeout(r,120)); } });
await p.waitForTimeout(1500);
out.catalog = await p.evaluate(() => {
  const clean = s => (s||'').replace(/\s+/g,' ').trim();
  const cards = [...document.querySelectorAll('[data-product-grid] article, [data-product-grid] .product-card')];
  return {
    count: clean(document.querySelector('[data-catalog-count]')?.textContent),
    title: clean(document.querySelector('[data-catalog-title]')?.textContent),
    filters: [...document.querySelectorAll('[data-catalog-filter], [data-category-strip] button')].map(n=>clean(n.textContent)).slice(0,40),
    sortOptions: [...document.querySelectorAll('[data-sort-select] option, [data-sort-value]')].map(n=>clean(n.textContent)).slice(0,20),
    products: cards.map(a=>({
      brand: clean(a.querySelector('.product-brand,[class*=brand]')?.textContent),
      name: clean(a.querySelector('h3')?.textContent),
      presentation: clean(a.querySelector('.product-body p')?.textContent),
      price: clean(a.querySelector('.product-foot')?.textContent),
      aria: [...a.querySelectorAll('[aria-label]')].map(n=>n.getAttribute('aria-label')),
      alt: [...a.querySelectorAll('img')].map(n=>n.getAttribute('alt')),
      id: a.querySelector('[data-product-detail]')?.getAttribute('data-product-detail') || a.querySelector('[data-add-product]')?.getAttribute('data-add-product'),
    })),
  };
});
out.errs = errs;
fs.writeFileSync(process.env.OUT||'.local/out-home-grid.json', JSON.stringify(out,null,1));
console.log('cards:', out.catalog.products.length, 'count:', out.catalog.count);
await b.close();
