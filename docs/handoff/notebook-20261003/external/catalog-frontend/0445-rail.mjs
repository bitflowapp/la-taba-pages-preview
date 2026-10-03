import { webkit } from '@playwright/test';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const b=await webkit.launch();
for(const w of [320,390]){
const h=w===320?568:844;
const ctx=await b.newContext({viewport:{width:w,height:h},userAgent:UA,hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
await p.waitForTimeout(500);
const info=await p.evaluate(()=>{
 const els=[...document.querySelectorAll('.home-best-copy strong')];
 const cut=els.map(e=>({full:e.textContent.trim(),sh:e.scrollHeight,ch:e.clientHeight,lc:getComputedStyle(e).webkitLineClamp,fs:getComputedStyle(e).fontSize,w:+e.getBoundingClientRect().width.toFixed(1)})).filter(x=>x.sh>x.ch+1);
 const sec=document.querySelector('[data-home-best-sellers]');
 if(sec) sec.scrollIntoView({block:'center'});
 return {total:els.length,cutCount:cut.length,cut:cut.slice(0,8)};
});
await p.waitForTimeout(1200);
await p.screenshot({path:`.local/mobile-audit/shots5/rail-${w}.png`});
console.log('### w='+w, JSON.stringify(info,null,1));
await ctx.close();
}
await b.close();
