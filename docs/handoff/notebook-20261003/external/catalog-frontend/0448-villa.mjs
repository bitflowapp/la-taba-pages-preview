import { webkit } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b=await webkit.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},userAgent:UA,hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
const r=await p.evaluate(()=>{
 const out=[];
 for(const c of document.querySelectorAll('.home-best-card')){
  const s=c.querySelector('.home-best-copy strong'); if(!s) continue;
  const t=s.textContent.trim();
  if(!/Villavicencio|Paso de los Toros|Aquarius/.test(t)) continue;
  const sm=c.querySelector('.home-best-copy small');
  const pr=c.querySelector('.home-best-copy span');
  out.push({name:t,cut:s.scrollHeight>s.clientHeight+1,w:+s.getBoundingClientRect().width.toFixed(1),sub:sm?sm.textContent.trim():null,price:pr?pr.textContent.trim():null});
 }
 return out;
});
console.log(JSON.stringify(r,null,1));
// zoom capture of the rail
const el=await p.$('[data-home-best-sellers]');
if(el){ await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(900); await el.screenshot({path:'.local/mobile-audit/shots5/best-rail-390.png'}); }
await ctx.close(); await b.close();
