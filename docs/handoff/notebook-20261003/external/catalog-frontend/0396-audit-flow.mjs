import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const IDS = { pack:'e3a974c3-9e4e-42a2-a1c4-a047cd93bf6a', cola225:'44210832-ec41-463b-b07a-4622dddf4fd9',
  lata354:'75e1e29f-62f4-4215-9c3a-80afd2c69704', cola15:'db17b799-385e-4603-912e-45ef8bc229a1',
  villa:'efc214b3-e4d0-446f-b77d-e8ed9befc4f4' };
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(String(e).slice(0,200)));
await p.goto(BASE, { waitUntil:'networkidle', timeout:90000 });
await p.waitForTimeout(5000);
const out={};
const clean = t=>(t||'').replace(/\s+/g,' ').trim();
const dumpModal = async(label)=>{
  await p.waitForTimeout(1400);
  return await p.evaluate(()=>{
    const cl=s=>(s||'').replace(/\s+/g,' ').trim();
    const m = document.querySelector('[data-product-modal]:not([hidden]), [data-modal-content]:not([hidden]), [data-bottom-sheet]:not([hidden])')
      || document.querySelector('[data-product-detail-panel]') || document.querySelector('[data-product-modal]');
    if(!m) return null;
    return { visible: !m.hidden, innerText: cl(m.innerText).slice(0,2500),
      name: cl(m.querySelector('[data-product-name], h2, h3')?.textContent),
      tagline: cl(m.querySelector('[data-product-tagline]')?.textContent),
      paras: [...m.querySelectorAll('p,li,span,dd,dt')].map(n=>cl(n.textContent)).filter(t=>t&&t.length<120).slice(0,60),
      aria: [...m.querySelectorAll('[aria-label]')].map(n=>n.getAttribute('aria-label')).slice(0,30),
      alt: [...m.querySelectorAll('img')].map(n=>n.getAttribute('alt')),
      html: m.innerHTML.slice(0,4000) };
  });
};
// --- FICHA de producto (pack x12 y unidad) ---
for (const [k,id] of Object.entries(IDS)) {
  await p.evaluate((id)=>{ const el=document.querySelector(`[data-product-detail="${id}"]`); if(el) el.click(); }, id);
  out['ficha_'+k] = await dumpModal(k);
  await p.keyboard.press('Escape'); await p.waitForTimeout(700);
}
// --- CARRITO ---
for (const id of [IDS.pack, IDS.cola225, IDS.lata354, IDS.villa]) {
  await p.evaluate((id)=>{ const el=document.querySelector(`[data-add-product="${id}"]`); if(el) el.click(); }, id);
  await p.waitForTimeout(900);
}
await p.evaluate(()=>{ const el=document.querySelector('[data-open-cart], [data-nav-view="cart"], [data-floating-cart]'); if(el) el.click(); });
await p.waitForTimeout(2500);
out.cart = await p.evaluate(()=>{
  const cl=s=>(s||'').replace(/\s+/g,' ').trim();
  const list=document.querySelector('[data-cart-list]');
  return { raw: cl(document.querySelector('[data-view="cart"]')?.innerText||'').slice(0,3000),
    items: list?[...list.children].map(li=>({t:cl(li.innerText), aria:[...li.querySelectorAll('[aria-label]')].map(n=>n.getAttribute('aria-label')), alt:[...li.querySelectorAll('img')].map(n=>n.getAttribute('alt'))})):null,
    recos: cl(document.querySelector('[data-cart-recommendations]')?.innerText||'').slice(0,800),
    floating: cl(document.querySelector('[data-floating-cart]')?.innerText||''),
    listHtml: list?list.innerHTML.slice(0,3000):null };
});
// --- CHECKOUT ---
await p.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/finaliz|continuar|checkout|pagar|Ir a pagar/i.test(x.textContent||'')&&!x.disabled); if(b)b.click(); });
await p.waitForTimeout(2500);
out.checkout = await p.evaluate(()=>{
  const cl=s=>(s||'').replace(/\s+/g,' ').trim();
  return { phase: document.querySelector('[data-checkout-phase]')?.getAttribute('data-checkout-phase'),
    raw: cl(document.querySelector('[data-checkout-form]')?.innerText||document.body.innerText).slice(0,3000),
    summary: cl(document.querySelector('[data-order-summary]')?.innerText||'').slice(0,2000),
    summaryHtml: (document.querySelector('[data-order-summary]')?.innerHTML||'').slice(0,3000) };
});
// --- BUSQUEDA ---
await p.evaluate(()=>{ const el=document.querySelector('[data-nav-view="catalog"]')||[...document.querySelectorAll('button')].find(x=>/Categor|Catálogo/i.test(x.textContent||'')); if(el)el.click(); });
await p.waitForTimeout(1500);
await p.fill('[data-search-input]','coca').catch(()=>{});
await p.waitForTimeout(2000);
out.search_coca = await p.evaluate(()=>{
  const cl=s=>(s||'').replace(/\s+/g,' ').trim();
  return { count: cl(document.querySelector('[data-catalog-count]')?.textContent),
    title: cl(document.querySelector('[data-catalog-title]')?.textContent),
    cards: [...document.querySelectorAll('[data-product-grid] article')].map(a=>({n:cl(a.querySelector('h3')?.textContent), p:cl(a.querySelector('.product-body p')?.textContent), aria:[...a.querySelectorAll('[aria-label]')].map(x=>x.getAttribute('aria-label'))})) };
});
for (const q of ['pet','2250','pack','botella']) {
  await p.fill('[data-search-input]', q).catch(()=>{});
  await p.waitForTimeout(1500);
  out['search_'+q] = await p.evaluate(()=>{
    const cl=s=>(s||'').replace(/\s+/g,' ').trim();
    return { count: cl(document.querySelector('[data-catalog-count]')?.textContent),
      names: [...document.querySelectorAll('[data-product-grid] article h3')].map(n=>cl(n.textContent)).slice(0,10) };
  });
}
// --- FILTROS panel (texto real) ---
await p.evaluate(()=>{ const el=[...document.querySelectorAll('button')].find(x=>/Filtro/i.test(x.textContent||'')); if(el)el.click(); });
await p.waitForTimeout(1200);
out.filters = await p.evaluate(()=>{
  const cl=s=>(s||'').replace(/\s+/g,' ').trim();
  const panel=document.querySelector('[data-catalog-filters]');
  return { raw: cl(panel?.innerText||'').slice(0,1500),
    selects: [...(panel?.querySelectorAll('select')||[])].map(s=>({label:cl(s.closest('label')?.querySelector('span')?.textContent), aria:s.getAttribute('aria-label'), opts:[...s.options].map(o=>o.text)})) };
});
// --- SEGUIMIENTO ---
await p.evaluate(()=>{ const el=[...document.querySelectorAll('button')].find(x=>/^Seguir$/i.test((x.textContent||'').trim())); if(el)el.click(); });
await p.waitForTimeout(2500);
out.tracking = await p.evaluate(()=>{
  const cl=s=>(s||'').replace(/\s+/g,' ').trim();
  return { raw: cl(document.querySelector('[data-view="tracking"]')?.innerText||'').slice(0,2500),
    aria: [...document.querySelectorAll('[data-view="tracking"] [aria-label]')].map(n=>n.getAttribute('aria-label')).slice(0,40) };
});
out.errs=errs;
fs.writeFileSync('.local/out-flow.json', JSON.stringify(out,null,1));
console.log('done. cartItems=', out.cart.items?.length, 'checkoutPhase=', out.checkout.phase);
await b.close();
