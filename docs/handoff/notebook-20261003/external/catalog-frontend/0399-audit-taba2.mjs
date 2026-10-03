import { chromium } from '@playwright/test';
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,
 userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'});
const p=await c.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(6000);
const dump=async(tag)=>{
  const r=await p.evaluate(()=>{
    const hits=[];
    const rx=/taba2|botella-pet|packaging_type|variant_code|sold_as_pack|package_type|pet-\d/i;
    const walk=(node)=>{
      if(node.nodeType===3){ if(rx.test(node.nodeValue||'')) hits.push({k:'text',v:node.nodeValue.trim().slice(0,120),
        vis: !!(node.parentElement&&node.parentElement.getClientRects().length), path:(node.parentElement?.tagName||'')+'.'+(node.parentElement?.className||'').slice(0,40)}); return; }
      if(node.nodeType!==1) return;
      for(const a of node.attributes||[]){ if((a.name==='aria-label'||a.name==='alt'||a.name==='title'||a.name==='placeholder'||a.name==='content')&&rx.test(a.value)) hits.push({k:'attr:'+a.name,v:a.value.slice(0,140),vis:node.getClientRects().length>0,path:node.tagName+'.'+String(node.className).slice(0,40)}); }
      for(const ch of node.childNodes) walk(ch);
    };
    walk(document.documentElement);
    return {title:document.title, hits};
  });
  console.log('\n### '+tag+' | title='+r.title);
  r.hits.forEach(h=>console.log('  ['+(h.vis?'VISIBLE':'oculto')+'] '+h.k+' :: '+h.v+'   <'+h.path+'>'));
};
await dump('HOME');
await p.evaluate(()=>{document.querySelector('[data-install-sheet]')?.remove();});
await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>/Categor/i.test(x.textContent||''));el&&el.click();});
await p.waitForTimeout(2500); await dump('CATALOGO');
await p.evaluate(()=>{document.querySelector('[data-add-product]')?.click();});
await p.waitForTimeout(1200);
await p.evaluate(()=>{(document.querySelector('[data-open-cart]')||document.querySelector('[data-floating-cart]'))?.click();});
await p.waitForTimeout(2500); await dump('CARRITO/CHECKOUT');
// trust copy real
const trust=await p.evaluate(()=>{const cl=s=>(s||'').replace(/\s+/g,' ').trim();
  return {title:cl(document.querySelector('[data-checkout-trust-title]')?.textContent),
    copy:cl(document.querySelector('[data-checkout-trust-copy]')?.textContent),
    visible: !!document.querySelector('[data-checkout-trust-copy]')?.getClientRects().length,
    promo:cl(document.querySelector('[data-promo-banner-title]')?.textContent),
    promoVis: !!document.querySelector('[data-promo-banner-title]')?.getClientRects().length,
    search:document.querySelector('.topbar-search')?.getAttribute('aria-label'),
    pname:cl(document.querySelector('[data-product-name]')?.textContent)};});
console.log('\nTRUST/PROMO/SEARCH:', JSON.stringify(trust,null,1));
await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>/^Seguir$/i.test((x.textContent||'').trim()));el&&el.click();});
await p.waitForTimeout(2500); await dump('SEGUIMIENTO');
await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>/Cuenta|Perfil/i.test((x.textContent||'').trim()));el&&el.click();});
await p.waitForTimeout(2000); await dump('PERFIL');
await b.close();
