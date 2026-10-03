import { webkit } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b=await webkit.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},userAgent:UA,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
const h=await p.evaluate(()=>{
 const cards=[...document.querySelectorAll('.home-best-card')];
 const idx=cards.findIndex(c=>/Villavicencio/.test(c.textContent||''));
 if(idx<0) return null;
 const c=cards[idx];
 const rail=c.parentElement;
 rail.scrollLeft=Math.max(0,c.getBoundingClientRect().left-rail.getBoundingClientRect().left+rail.scrollLeft-8);
 c.scrollIntoView({block:'center'});
 const sec=c.closest('section');
 return {sec:(sec&&sec.querySelector('h2,h3')||{}).textContent?.trim()||'', railCards:rail.children.length};
});
await p.waitForTimeout(1500);
const rail=await p.$('.home-best-card');
const sec=await p.evaluateHandle(()=>document.querySelector('.home-best-card')?.parentElement);
if(sec){ await sec.asElement().screenshot({path:'.local/mobile-audit/shots5/villa-rail.png'}); }
console.log(JSON.stringify(h));
await ctx.close(); await b.close();
