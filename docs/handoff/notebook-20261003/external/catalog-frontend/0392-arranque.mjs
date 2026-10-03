import { chromium } from '@playwright/test';
const b = await chromium.launch();
// A) sin JS: qué ve el cliente en el primer pintado
const c1 = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, javaScriptEnabled:false,
 userAgent:'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'});
const p1 = await c1.newPage();
await p1.goto('https://la-taba.pages.dev', {waitUntil:'load', timeout:60000});
await p1.waitForTimeout(2500);
await p1.screenshot({path:'./.local/shots/sinjs-390.png'});
console.log('SIN JS h1:', await p1.evaluate(()=>document.querySelector('#home-title')?.innerText));
console.log('SIN JS visible:', await p1.evaluate(()=>(document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,300)));
await c1.close();

// B) red lenta: cuánto tarda el primer precio y qué se ve mientras
const c2 = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
 userAgent:'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'});
const p2 = await c2.newPage();
const cdp = await c2.newCDPSession(p2);
await cdp.send('Network.emulateNetworkConditions',{offline:false, latency:150, downloadThroughput:1.6*1024*1024/8, uploadThroughput:750*1024/8});
await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
const reqs=[];
p2.on('response', r=>reqs.push({u:r.url().split('/').slice(-1)[0].slice(0,60), s:r.status()}));
const t0=Date.now();
await p2.goto('https://la-taba.pages.dev', {waitUntil:'commit', timeout:90000});
await p2.waitForTimeout(1200); await p2.screenshot({path:'./.local/shots/lento-1200ms.png'});
const h1 = await p2.evaluate(()=>document.querySelector('#home-title')?.innerText||'');
console.log('A 1200ms h1 dice:', JSON.stringify(h1));
await p2.waitForTimeout(1300); await p2.screenshot({path:'./.local/shots/lento-2500ms.png'});
console.log('A 2500ms h1 dice:', JSON.stringify(await p2.evaluate(()=>document.querySelector('#home-title')?.innerText||'')));
try{ await p2.waitForFunction(()=>/\$\s?[\d.]/.test(document.body.innerText), {timeout:60000}); }catch{}
console.log('PRIMER PRECIO a los', Date.now()-t0, 'ms (4x CPU, 1.6Mbps)');
await p2.screenshot({path:'./.local/shots/lento-primer-precio.png'});
console.log('404s:', JSON.stringify(reqs.filter(r=>r.s>=400)));
console.log('heineken:', JSON.stringify(reqs.filter(r=>/heineken|promo/i.test(r.u))));
await b.close();
