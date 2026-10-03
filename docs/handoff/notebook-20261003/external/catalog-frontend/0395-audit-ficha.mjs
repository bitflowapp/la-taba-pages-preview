import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE='https://la-taba.pages.dev';
const IDS={ pack:'e3a974c3-9e4e-42a2-a1c4-a047cd93bf6a', cola225:'44210832-ec41-463b-b07a-4622dddf4fd9',
 lata354:'75e1e29f-62f4-4215-9c3a-80afd2c69704', cola15:'db17b799-385e-4603-912e-45ef8bc229a1',
 villa:'efc214b3-e4d0-446f-b77d-e8ed9befc4f4', benedictino:'b64ad1d2-475f-4612-92be-1be1e37dcf23',
 packZero:'5cd082fa-35db-413e-983e-10b12255fdb9' };
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,
 userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'});
const p=await c.newPage();
await p.goto(BASE,{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>/Categor/i.test(x.textContent||''));el&&el.click();});
await p.waitForTimeout(2500);
const out={};
for(const [k,id] of Object.entries(IDS)){
  await p.evaluate(id=>{document.querySelector(`[data-product-detail="${id}"]`)?.click();},id);
  await p.waitForTimeout(1600);
  out['ficha_'+k]=await p.evaluate(()=>{
    const cl=s=>(s||'').replace(/\s+/g,' ').trim();
    const m=document.querySelector('[data-product-modal]');
    if(!m) return {err:'no modal node'};
    return { hidden:m.hidden, cls:m.className, text:cl(m.innerText).slice(0,2200),
      name:cl(m.querySelector('[data-product-name]')?.textContent),
      tagline:cl(m.querySelector('[data-product-tagline]')?.textContent),
      aria:[...m.querySelectorAll('[aria-label]')].map(n=>n.getAttribute('aria-label')).slice(0,25),
      alt:[...m.querySelectorAll('img')].map(n=>n.getAttribute('alt')),
      html:m.innerHTML.replace(/\s+/g,' ').slice(0,3500) };
  });
  await p.evaluate(()=>{document.querySelector('[data-product-modal] [data-close-modal],[data-product-modal] button')?.click();});
  await p.keyboard.press('Escape'); await p.waitForTimeout(800);
}
// BUSQUEDA real: escribir con teclado en el input visible del catalogo
const searchDump=async(q)=>{
  const inputs=await p.$$('[data-search-input]');
  for(const i of inputs){ if(await i.isVisible()){ await i.click(); await i.fill(''); await i.type(q,{delay:60}); break; } }
  await p.waitForTimeout(1800);
  return await p.evaluate(()=>{
    const cl=s=>(s||'').replace(/\s+/g,' ').trim();
    return { count:cl(document.querySelector('[data-catalog-count]')?.textContent),
      title:cl(document.querySelector('[data-catalog-title]')?.textContent),
      empty:cl(document.querySelector('[data-catalog-empty],.catalog-empty')?.innerText||''),
      cards:[...document.querySelectorAll('[data-product-grid] article')].map(a=>cl(a.querySelector('h3')?.textContent)+' :: '+cl(a.querySelector('.product-body p')?.textContent)).slice(0,20) };
  });
};
for(const q of ['coca','pet','2250','2,25','pack x12','botella','sifon','zero','lata']) out['q_'+q]=await searchDump(q);
fs.writeFileSync('.local/out-ficha.json',JSON.stringify(out,null,1));
console.log('ok');
await b.close();
