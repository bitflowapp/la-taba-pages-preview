import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, locale:'es-AR',
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
await p.goto('https://la-taba.pages.dev', { waitUntil:'networkidle', timeout:90000 });
await p.waitForSelector('[data-add-product]'); await p.waitForTimeout(3000);
const r = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('[data-nav-view="catalog"]').forEach((el,i)=>{
    const rc = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = rc.width&&rc.height ? document.elementFromPoint(rc.left+rc.width/2, rc.top+rc.height/2) : null;
    out.push({ i, text:(el.textContent||'').trim().slice(0,30), rect:[Math.round(rc.x),Math.round(rc.y),Math.round(rc.width),Math.round(rc.height)],
      display:cs.display, visibility:cs.visibility, opacity:cs.opacity, pe:cs.pointerEvents,
      parentHidden: !!el.closest('[hidden]'), offsetParent: el.offsetParent!==null,
      topEl: top ? top.tagName+'.'+(top.className||'').toString().slice(0,50) : null });
  });
  const overlays = [...document.querySelectorAll('body *')].filter(e=>{
    const cs=getComputedStyle(e); const rc=e.getBoundingClientRect();
    return (cs.position==='fixed'||cs.position==='sticky') && rc.width>200 && rc.height>200 && cs.visibility!=='hidden' && cs.display!=='none' && Number(cs.opacity)>0.05;
  }).map(e=>({tag:e.tagName, cls:(e.className||'').toString().slice(0,60), z:getComputedStyle(e).zIndex, rect:[Math.round(e.getBoundingClientRect().y),Math.round(e.getBoundingClientRect().height)], attrs:[...e.attributes].map(a=>a.name).filter(n=>n.startsWith('data-')).slice(0,4)}));
  return { navs: out, overlays: overlays.slice(0,10) };
});
console.log(JSON.stringify(r,null,1));
await b.close();
