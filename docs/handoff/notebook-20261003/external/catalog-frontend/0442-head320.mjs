import { webkit } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b=await webkit.launch();
for(const w of [320,360,390]){
const ctx=await b.newContext({viewport:{width:w,height:568},userAgent:UA,hasTouch:true});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
await p.evaluate(()=>{const x=[...document.querySelectorAll('[data-nav-view]')].find(y=>y.getAttribute('data-nav-view')==='tracking');if(x)x.click();});
await p.waitForTimeout(3000);
const r=await p.evaluate(()=>{
 const head=document.querySelector('header.topbar');
 const kids=[...head.children].map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {cls:e.className,tag:e.tagName,l:+r.left.toFixed(1),rr:+r.right.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),ov:cs.overflow,disp:cs.display,txt:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,40)};});
 const deep=[...head.querySelectorAll('*')].filter(e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return cs.display!=='none'&&r.width>0;}).map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
  let own='';for(const n of e.childNodes) if(n.nodeType===3) own+=n.nodeValue;
  return {cls:(e.className&&typeof e.className==='string')?e.className:'',tag:e.tagName,l:+r.left.toFixed(1),rr:+r.right.toFixed(1),w:+r.width.toFixed(1),sw:e.scrollWidth,cw:e.clientWidth,ov:cs.overflowX,to:cs.textOverflow,ws:cs.whiteSpace,txt:own.replace(/\s+/g,' ').trim().slice(0,40)};}).filter(x=>x.txt||/menu|hamb|burger|drawer|more/i.test(x.cls));
 return {vw:document.documentElement.clientWidth,kids,deep};
});
console.log('=== width',w,'vw',r.vw);
r.kids.forEach(k=>console.log('  KID',JSON.stringify(k)));
r.deep.forEach(k=>console.log('  DEEP',JSON.stringify(k)));
await ctx.close();
}
await b.close();
