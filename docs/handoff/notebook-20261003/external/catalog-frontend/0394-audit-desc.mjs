import { chromium } from '@playwright/test';
import fs from 'node:fs';
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,
 userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'});
const p=await c.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>/Categor/i.test(x.textContent||''));el&&el.click();});
await p.waitForTimeout(2500);
await p.evaluate(async()=>{for(let i=0;i<25;i++){window.scrollBy(0,1200);await new Promise(r=>setTimeout(r,100));}});
await p.waitForTimeout(1200);
const ids=await p.evaluate(()=>[...document.querySelectorAll('[data-product-grid] [data-product-detail]')].map(n=>n.getAttribute('data-product-detail')));
const fichas=[];
for(const id of ids){
  await p.evaluate(i=>{document.querySelector(`[data-product-detail="${i}"]`)?.click();},id);
  await p.waitForTimeout(900);
  fichas.push(await p.evaluate(()=>{
    const cl=s=>(s||'').replace(/\s+/g,' ').trim();
    const m=document.querySelector('[data-product-modal]');
    return cl(m?.innerText||'').replace(/^× /,'').slice(0,320);
  }));
  await p.evaluate(()=>{document.querySelector('[data-install-sheet]')?.remove();}); await p.keyboard.press('Escape'); await p.waitForTimeout(450);
}
await p.evaluate(()=>{document.querySelector('[data-install-close],[data-install-decline]')?.click();document.querySelector('[data-install-sheet]')?.close?.();document.querySelector('[data-install-sheet]')?.remove();});
await p.waitForTimeout(600);
const searchDump=async(q)=>{
  await p.evaluate((q)=>{
    const el=[...document.querySelectorAll('[data-search-input]')].find(n=>n.offsetParent!==null)||document.querySelector('[data-search-input]');
    if(!el) return;
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(el,q); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  },q);
  await p.waitForTimeout(1600);
  return await p.evaluate(()=>({c:(document.querySelector('[data-catalog-count]')?.textContent||'').trim(),
    n:[...document.querySelectorAll('[data-product-grid] article h3')].map(x=>x.textContent.trim()).slice(0,6)}));
};
const q={};
for(const t of ['pack','x12','2,25 L','1,5','1,5 L','500 ml','Botella PET','sifón','Sin azúcar','Original','Coca-Cola Original'])
  q[t]=await searchDump(t);
fs.writeFileSync('.local/out-desc.json',JSON.stringify({ids,fichas,q},null,1));
console.log('fichas', fichas.length);
await b.close();
