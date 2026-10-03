import { webkit, chromium } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const AUA='Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
for(const [eng,name,ua] of [[webkit,'webkit',UA],[chromium,'chromium',AUA]]){
const b=await eng.launch();
const ctx=await b.newContext({viewport:{width:320,height:568},userAgent:ua,hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
await p.evaluate(()=>window.scrollTo(0,400));
await p.waitForTimeout(1200);
const r=await p.evaluate(()=>{
 const t=document.querySelector('header.topbar'); const cs=getComputedStyle(t);
 return {bg:cs.backgroundColor,bgImage:cs.backgroundImage.slice(0,60),bd:cs.backdropFilter,wbd:cs.webkitBackdropFilter,op:cs.opacity,scrolled:document.body.getAttribute('data-motion-scrolled'),z:cs.zIndex,pos:cs.position,
  supportsBD: CSS.supports('backdrop-filter: blur(1px)')||CSS.supports('-webkit-backdrop-filter: blur(1px)')};
});
console.log('###',name,JSON.stringify(r));
await p.screenshot({path:`.local/mobile-audit/shots5/bg-${name}-320.png`,clip:{x:0,y:0,width:320,height:120}});
await ctx.close(); await b.close();
}
