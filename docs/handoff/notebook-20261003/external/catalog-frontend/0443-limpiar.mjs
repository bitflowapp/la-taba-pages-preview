import { webkit } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b=await webkit.launch();
for(const w of [320,390]){
const ctx=await b.newContext({viewport:{width:w,height:w===320?568:844},userAgent:UA,hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
await p.evaluate(()=>{const x=[...document.querySelectorAll('[data-nav-view]')].find(y=>y.getAttribute('data-nav-view')==='catalog');if(x)x.click();});
await p.waitForTimeout(2500);
await p.evaluate(()=>{const s=document.querySelector('[data-catalog-filters] summary'); if(s)s.click();});
await p.waitForTimeout(2500);
const r=await p.evaluate(()=>{
 const a=document.querySelector('.catalog-filters-actions'); if(!a)return null;
 const cs=getComputedStyle(a); const ar=a.getBoundingClientRect();
 return {open:document.querySelector('[data-catalog-filters]').hasAttribute('open'),
  actions:{w:+ar.width.toFixed(1),cols:cs.gridTemplateColumns,gap:cs.gap,pad:cs.padding},
  btns:[...a.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return {t:e.textContent.trim(),w:+r.width.toFixed(1),h:+r.height.toFixed(1),sw:e.scrollWidth,cw:e.clientWidth,cut:e.scrollWidth>e.clientWidth+1};})};
});
console.log('### w='+w, JSON.stringify(r,null,1));
await p.screenshot({path:`.local/mobile-audit/shots5/filters-${w}.png`});
await ctx.close();
}
await b.close();
