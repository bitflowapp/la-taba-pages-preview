import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:3, hasTouch:true, isMobile:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
const reqs=[];
p.on('response', r=>{ if(/assets\/products/.test(r.url())) reqs.push(r.url().split('/').pop()); });
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:120000});
await p.waitForTimeout(2000);
for(let i=0;i<5;i++){const k=await p.evaluate(()=>{const x=[...document.querySelectorAll('button')].find(y=>/ahora no|cerrar/i.test((y.textContent||'').trim())&&y.offsetParent!==null); if(x){x.click();return true;} return false;}); if(!k)break; await p.waitForTimeout(400);}
await p.evaluate(()=>{const x=[...document.querySelectorAll('[data-nav-view="catalog"]')].find(y=>!y.hasAttribute('data-nav-passive')); if(x)x.click();});
await p.waitForSelector('.product-grid .product-card');
await p.evaluate(async()=>{const s=window.innerHeight*0.8;for(let y=0;y<document.body.scrollHeight;y+=s){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,180));}window.scrollTo(0,0);});
await p.waitForTimeout(3000);
const r = await p.evaluate(async ()=>{
  const out=[];
  for(const card of [...document.querySelectorAll('.product-grid .product-card')]){
    const img=card.querySelector('.thumb-img');
    if(!card.querySelector('.thumb.has-photo')) continue;
    await img.decode().catch(()=>{});
    out.push({n:card.querySelector('h3').textContent.trim(), nat:img.naturalWidth+'x'+img.naturalHeight, complete:img.complete, cur:img.currentSrc.split('/').pop().slice(0,50), attrW:img.getAttribute('width'), css:Math.round(img.getBoundingClientRect().width), srcset:img.getAttribute('srcset'), sizes:img.getAttribute('sizes')});
  }
  return out;
});
console.log(JSON.stringify(r,null,1));
console.log('descargados:', [...new Set(reqs)].join('\n '));
await b.close();
