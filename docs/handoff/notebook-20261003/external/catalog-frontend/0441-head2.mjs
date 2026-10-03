import { webkit } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b=await webkit.launch();
for(const w of [320,390,430]){
const ctx=await b.newContext({viewport:{width:w,height:w===320?568:(w===390?844:932)},userAgent:UA,hasTouch:true});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5500);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
await p.waitForTimeout(600);
const r=await p.evaluate(()=>{
 const head=document.querySelector('header.topbar');
 const vis=e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0;};
 const c=[...head.querySelectorAll('button,a[href]')].filter(vis).map(e=>{const r=e.getBoundingClientRect();return {cls:(typeof e.className==='string'?e.className:''),l:+r.left.toFixed(1),r:+r.right.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),t:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,22),aria:(e.getAttribute('aria-label')||'').slice(0,26)};}).sort((a,b)=>a.l-b.l);
 const gaps=[]; for(let i=0;i<c.length-1;i++) gaps.push({a:c[i].cls,b:c[i+1].cls,gap:+(c[i+1].l-c[i].r).toFixed(1)});
 return {view:document.body.getAttribute('data-active-view'),c,gaps};
});
console.log('### home w='+w,'view',r.view);
r.c.forEach(x=>console.log('   CTRL',JSON.stringify(x)));
r.gaps.forEach(x=>console.log('   GAP ',JSON.stringify(x)));
await ctx.close();
}
await b.close();
