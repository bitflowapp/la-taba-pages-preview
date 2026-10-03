import { chromium } from 'playwright';
const U='https://taba2-staging.pages.dev';
const b=await chromium.launch({headless:true});
const p=await (await b.newContext({viewport:{width:1360,height:1000},locale:'es-AR'})).newPage();
const errs=[],malas=[];
p.on('pageerror',e=>errs.push(String(e).slice(0,150)));
p.on('console',m=>{if(m.type()==='error'&&!/favicon/i.test(m.text()))errs.push(m.text().slice(0,150))});
p.on('response',r=>{if(r.status()>=400)malas.push(r.status()+' '+r.url().replace(/\?.*/,''))});
await p.goto(`${U}/#business`,{waitUntil:'load',timeout:60000});
await p.waitForTimeout(6000);
const f=p.locator('form:has(input[name="email"]):visible').last();
await f.locator('input[name="email"]').fill(process.env.TABA_OWNER_EMAIL);
await f.locator('input[name="password"]').fill(process.env.TABA_OWNER_PASSWORD);
await f.locator('button[type="submit"]').first().click();
await p.waitForTimeout(14000);
const botones=await p.evaluate(()=>[...document.querySelectorAll('button,a')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&/^Pedidos$/i.test((e.innerText||'').trim())}).map(e=>({tag:e.tagName,cls:String(e.className).slice(0,50),attrs:[...e.attributes].map(a=>a.name).join(',')})));
console.log('botones «Pedidos» visibles:',JSON.stringify(botones,null,1));
await p.locator('[data-production-orders-view]').click({force:true}).catch(e=>console.log('click fallo:',e.message.slice(0,80)));
await p.waitForTimeout(9000);
const r=await p.evaluate(()=>{
  const t=(document.body.innerText||'').replace(/\s+/g,' ');
  return {codigos:[...new Set(t.match(/LT-\d+/g)||[])].slice(0,8), vista:document.querySelector('[data-production-orders-view]')?'existe':'no',
    tarjetas:document.querySelectorAll('[data-order-id],[data-production-order]').length, extracto:t.slice(0,400)};
});
console.log(JSON.stringify(r,null,2));
console.log('errores:',errs.length?errs.slice(0,3):'ninguno','| 4xx:',malas.length?[...new Set(malas)].slice(0,3):'ninguna');
await b.close();
