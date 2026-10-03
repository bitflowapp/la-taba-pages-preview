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
// ir a Pagos
const tab=p.locator('button:has-text("Pagos"), [role="tab"]:has-text("Pagos"), a:has-text("Pagos")').first();
await tab.click().catch(()=>{});
await p.waitForTimeout(8000);
const r=await p.evaluate(()=>{
  const vis=el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  const at=new Map();
  document.querySelectorAll('*').forEach(el=>{if(!vis(el))return;for(const a of el.attributes){if(a.name.startsWith('data-'))at.set(a.name,(at.get(a.name)||0)+1)}});
  const acciones=[...document.querySelectorAll('[data-payment-action]')].map(e=>({accion:e.dataset.paymentAction,intent:e.dataset.paymentIntent,texto:(e.innerText||'').trim().slice(0,40),visible:vis(e)}));
  return {
    atributosPago:[...at.entries()].filter(([k])=>/payment|pago|recover|review/i.test(k)),
    acciones,
    recuperables:acciones.filter(a=>a.accion==='recover-order'),
    texto:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,700),
  };
});
console.log(JSON.stringify(r,null,2));
console.log('errores:',errs.length?errs.slice(0,4):'ninguno');
console.log('4xx:',malas.length?[...new Set(malas)].slice(0,4):'ninguna');
await b.close();
