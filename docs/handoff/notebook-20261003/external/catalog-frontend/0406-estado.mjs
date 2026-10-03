import { chromium } from '@playwright/test';
const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
const errs=[]; p.on('console', m=>{ if(m.type()==='error') errs.push(m.text().slice(0,200)); });
p.on('pageerror', e=>errs.push('PAGEERROR '+String(e).slice(0,200)));
await p.goto(BASE, { waitUntil:'networkidle', timeout:90000 });
await p.waitForTimeout(4000);
const r = await p.evaluate(() => {
  const txt = (sel) => [...document.querySelectorAll(sel)].map(e=>(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,180));
  const home = document.querySelector('[data-view="home"]');
  return {
    cards: document.querySelectorAll('[data-add-product]').length,
    gridCards: document.querySelectorAll('[data-product-grid] [data-add-product]').length,
    catalogCount: document.querySelector('[data-catalog-count]')?.textContent?.trim(),
    notices: txt('[data-cart-notice], [data-checkout-warning], [data-catalog-empty], .notice, [data-store-closed]'),
    homeText: home ? home.innerText.replace(/\s+/g,' ').slice(0,1400) : null,
    bestSellers: document.querySelectorAll('[data-home-best-sellers] [data-add-product]').length,
    sections: [...document.querySelectorAll('[data-home-sections] > *')].map(s=>(s.querySelector('h2,h3')||{}).textContent?.trim()||s.getAttribute('data-section')||s.className),
    hours: document.querySelector('[data-home-business-hours]')?.textContent?.replace(/\s+/g,' ').trim(),
  };
});
console.log(JSON.stringify(r,null,1));
console.log('ERRORS:',JSON.stringify(errs.slice(0,15),null,1));
await b.close();
