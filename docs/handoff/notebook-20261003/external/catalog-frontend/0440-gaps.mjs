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
const home=await p.evaluate(()=>{
 const out={};
 const names=[...document.querySelectorAll('.home-best-copy strong, .home-best-card strong')].map(e=>({full:e.textContent.trim(),sw:e.scrollWidth,cw:e.clientWidth,cut:e.scrollWidth>e.clientWidth+1,clamp:getComputedStyle(e).webkitLineClamp,fs:getComputedStyle(e).fontSize}));
 out.railNames=names.filter(n=>n.cut).slice(0,6);
 out.railNamesTotal=names.length; out.railCut=names.filter(n=>n.cut).length;
 const grid=[...document.querySelectorAll('.product-body h3')].map(e=>({full:e.textContent.trim(),sh:e.scrollHeight,ch:e.clientHeight,cut:e.scrollHeight>e.clientHeight+1}));
 out.gridCut=grid.filter(g=>g.cut).slice(0,5); out.gridCutTotal=grid.filter(g=>g.cut).length;
 return out;
});
const track=await p.evaluate(()=>{
 const x=[...document.querySelectorAll('[data-nav-view]')].find(y=>y.getAttribute('data-nav-view')==='tracking'); if(x)x.click(); return true;
});
await p.waitForTimeout(3000);
const head=await p.evaluate(()=>{
 const head=document.querySelector('header.topbar');
 const ctrls=[...head.querySelectorAll('button,a[href]')].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return cs.display!=='none'&&r.width>0&&r.height>0;})
  .map(e=>{const r=e.getBoundingClientRect();return {cls:e.className,l:+r.left.toFixed(1),r:+r.right.toFixed(1),w:+r.width.toFixed(1),hh:+r.height.toFixed(1),t:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,26),aria:(e.getAttribute('aria-label')||'').slice(0,30)};})
  .sort((a,b)=>a.l-b.l);
 const gaps=[]; for(let i=0;i<ctrls.length-1;i++){ gaps.push({from:ctrls[i].t||ctrls[i].aria||ctrls[i].cls, to:ctrls[i+1].t||ctrls[i+1].aria||ctrls[i+1].cls, gap:+(ctrls[i+1].l-ctrls[i].r).toFixed(1)}); }
 return {ctrls,gaps};
});
console.log('### w='+w, JSON.stringify(home));
console.log('  head ctrls', JSON.stringify(head.ctrls));
console.log('  head gaps', JSON.stringify(head.gaps));
await ctx.close();
}
await b.close();
