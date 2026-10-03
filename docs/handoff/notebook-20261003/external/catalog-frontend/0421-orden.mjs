import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
 userAgent:'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'});
const p = await c.newPage();
await p.goto('https://la-taba.pages.dev', {waitUntil:'networkidle', timeout:90000});
await p.waitForTimeout(6000);
const r = await p.evaluate(()=>{
  const clean=s=>(s||'').replace(/\s+/g,' ').trim();
  const rails=[...document.querySelectorAll('[data-view="home"] .home-merch-section, [data-home-sections] > *')].map(sec=>({
    titulo: clean((sec.querySelector('h2,h3')||{}).textContent),
    items: [...sec.querySelectorAll('[data-add-product]')].map(btn=>clean(btn.closest('article,li,[data-product-id],div.offer-card')?.innerText).replace(' Agregar','')),
  })).filter(s=>s.items.length);
  return { rails };
});
console.log('== RAILES HOME (orden real) ==');
r.rails.forEach(s=>{ console.log('\n#',s.titulo,'('+s.items.length+')'); s.items.forEach((t,i)=>console.log('  ',i+1,t)); });
// ahora catálogo completo
await p.click('[data-nav-view="catalog"], [data-view-target="catalog"], nav [data-nav="catalog"]').catch(()=>{});
await p.waitForTimeout(2500);
const cat = await p.evaluate(()=>{
  const clean=s=>(s||'').replace(/\s+/g,' ').trim();
  const v=document.querySelector('[data-view="catalog"]');
  return { activa: document.body.getAttribute('data-active-view'),
    conteo: clean(document.querySelector('[data-catalog-count]')?.textContent),
    chips: [...document.querySelectorAll('[data-view="catalog"] [data-category-id]')].map(e=>clean(e.textContent)).slice(0,20),
    items: v?[...v.querySelectorAll('[data-add-product]')].map(btn=>clean(btn.closest('article,li,[data-product-id],div')?.innerText).replace(' Agregar','')):[] };
});
console.log('\n== CATALOGO ==', cat.activa, '|', cat.conteo);
console.log('CHIPS:', cat.chips.join(' / '));
cat.items.forEach((t,i)=>console.log('  ',i+1,t));
await b.close();
