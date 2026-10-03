import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:412,height:915} });
const errs=[];
p.on('pageerror', e=>errs.push(String(e).slice(0,160)));
await p.goto('https://la-taba.pages.dev/', { waitUntil:'networkidle', timeout:60000 });
await p.waitForTimeout(6000);
const r = await p.evaluate(() => {
  const vis = el => !!el && !el.hidden && el.offsetParent !== null;
  const sec = s => { const e=document.querySelector(s); return e? {existe:true, visible:vis(e), hijos:e.children.length} : {existe:false}; };
  return {
    combosSection: sec('[data-home-combos-section]'),
    combosRail:    sec('[data-combos-rail]'),
    ofertasSection: sec('.home-offers-section'),
    promosRail:    sec('[data-home-promotions]'),
    promoBanner:   sec('[data-promo-banner]'),
    heroPromo:     sec('[data-home-hero-promo]'),
    banners:       sec('[data-home-banners]'),
    destacados:    sec('[data-home-best-sellers]'),
    editorial:     sec('[data-home-editorial-section]'),
    tituloDestacados: document.getElementById('home-best-title')?.textContent,
    badges: [...document.querySelectorAll('.offer-badge')].map(n=>n.textContent.trim()),
    tachados: [...document.querySelectorAll('s')].map(n=>n.textContent.trim()).slice(0,10),
    comboCards: document.querySelectorAll('.combo-card').length,
    promoCards: document.querySelectorAll('.home-promo-card').length,
    productCards: document.querySelectorAll('.home-catalog-card, .product-card').length,
    ahorroFlotante: sec('[data-floating-cart-saving]'),
  };
});
console.log(JSON.stringify(r,null,2));
console.log('pageerrors:', errs.length? errs : 'ninguno');
await b.close();
