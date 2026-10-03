import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:2,
 userAgent:'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'});
const p = await c.newPage();
await p.goto('https://la-taba.pages.dev', {waitUntil:'networkidle', timeout:90000});
await p.waitForTimeout(5000);
const H = await p.evaluate(()=>document.documentElement.scrollHeight);
for (let i=0,y=0; y<H && i<5; i++, y+=760){ await p.evaluate(v=>window.scrollTo(0,v), y); await p.waitForTimeout(900); await p.screenshot({path:`./.local/shots/scroll-${i}-y${y}.png`}); }
const info = await p.evaluate(()=>{
  const clean=s=>(s||'').replace(/\s+/g,' ').trim();
  const home=document.querySelector('[data-view="home"]');
  const blocks=[...home.querySelectorAll(':scope > .taba-home-content > *')].map(el=>({
    cls:(el.className||'').toString().slice(0,60), tag:el.tagName, hidden:el.hasAttribute('hidden'),
    h:Math.round(el.getBoundingClientRect().height), y:Math.round(el.getBoundingClientRect().top+scrollY),
    txt: clean(el.innerText).slice(0,140), cards: el.querySelectorAll('[data-add-product]').length }));
  const editorial=document.querySelector('[data-home-editorial-section]');
  return { docH:document.documentElement.scrollHeight, blocks,
    editorialHidden: editorial?.hasAttribute('hidden'), editorialH: Math.round(editorial?.getBoundingClientRect().height||0),
    footer: clean(document.querySelector('footer')?.innerText).slice(0,600),
    tail: clean(document.querySelector('[data-view="home"]')?.innerText).slice(-900) };
});
console.log(JSON.stringify(info,null,1));
await b.close();
