import { webkit } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b=await webkit.launch();
for(const w of [320,390,430]){
const h=w===320?568:(w===390?844:932);
const ctx=await b.newContext({viewport:{width:w,height:h},userAgent:UA,hasTouch:true});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
await p.evaluate(()=>{const x=[...document.querySelectorAll('[data-nav-view]')].find(y=>y.getAttribute('data-nav-view')==='catalog');if(x)x.click();});
await p.waitForTimeout(2200);
await p.evaluate(()=>{[...document.querySelectorAll('[data-add-product]')].filter(x=>!x.disabled).slice(0,3).forEach(x=>x.click());});
await p.waitForTimeout(1800);
await p.evaluate(()=>{const x=[...document.querySelectorAll('[data-nav-view]')].find(y=>y.getAttribute('data-nav-view')==='cart');if(x)x.click();});
await p.waitForTimeout(2800);
const r=await p.evaluate(()=>{
 const small=[]; const all=[];
 const vis=e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0;};
 for(const e of document.querySelectorAll('button, a[href], input, select, summary, [role=button]')){
  if(!vis(e))continue; const r=e.getBoundingClientRect();
  const rec={cls:(typeof e.className==='string'?e.className:'').slice(0,44),tag:e.tagName,w:+r.width.toFixed(1),h:+r.height.toFixed(1),t:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,24),aria:(e.getAttribute('aria-label')||'').slice(0,28)};
  all.push(rec); if(r.width<44||r.height<44) small.push(rec);
 }
 const qty=[...document.querySelectorAll('.qty-stepper button, .quantity-control button, [data-qty], [data-cart-qty]')].filter(vis).map(e=>{const r=e.getBoundingClientRect();return {t:(e.textContent||'').trim().slice(0,10),aria:(e.getAttribute('aria-label')||'').slice(0,26),w:+r.width.toFixed(1),h:+r.height.toFixed(1)};});
 return {totalControls:all.length,small,qty};
});
console.log('### w='+w,'controles',r.totalControls,'menores44:',r.small.length);
r.small.forEach(s=>console.log('   SMALL',JSON.stringify(s)));
r.qty.forEach(s=>console.log('   QTY',JSON.stringify(s)));
await ctx.close();
}
await b.close();
