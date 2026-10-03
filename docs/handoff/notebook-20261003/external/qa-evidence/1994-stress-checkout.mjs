/* Casos de error del checkout, en producción, SIN crear ningún pedido:
 *  A) confirmar con perfil incompleto (visitante nuevo)
 *  B) pedir más unidades que el stock
 *  C) doble toque en Confirmar (con perfil incompleto: no puede crear pedido)
 *  D) refrescar con el carrito lleno
 *  E) volver atrás desde el carrito
 */
import { chromium } from '@playwright/test';
const BASE='https://la-taba.pages.dev'; const OUT='artifacts/weekend-launch';
const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:2, serviceWorkers:'allow', locale:'es-AR',
  userAgent:'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
const errores=[]; page.on('pageerror',e=>errores.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')errores.push('console: '+m.text().slice(0,160));});
const r=[];
const anota=(caso,dato)=>{ r.push({caso,...dato}); };

const abrirCarrito = async () => { await page.locator('[data-open-cart] >> visible=true').first().click(); await page.waitForTimeout(2200); };
const leer = () => page.evaluate(()=>{
  const vis=(el)=>{const s=getComputedStyle(el);const b=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&b.height>0;};
  const av=document.querySelector('[data-checkout-warning]');
  const toasts=[...document.querySelectorAll('[data-toast], .toast, [role=status], [role=alert]')].filter(vis).map(e=>e.textContent.trim().slice(0,160));
  const sub=document.querySelector('[data-checkout-submit]');
  return { aviso: av&&vis(av)?av.textContent.trim():null, toasts,
    submit: sub?{txt:sub.textContent.trim(),disabled:sub.disabled}:null,
    resumen:(document.querySelector('[data-order-summary]')?.textContent||'').replace(/\s+/g,' ').trim(),
    cantidad:(document.querySelector('[data-open-cart]')?.textContent||'').trim() };
});

await page.goto(BASE,{waitUntil:'domcontentloaded'});
await page.locator('html[data-taba-startup="ready"]').waitFor({state:'attached',timeout:90_000});
await page.waitForTimeout(3000);

// --- A: confirmar con perfil incompleto
await page.locator('[data-add-product] >> visible=true').first().click();
await page.waitForTimeout(1000);
await abrirCarrito();
const sub = page.locator('[data-checkout-submit]');
await sub.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
await sub.click({ force: true });
await page.waitForTimeout(2500);
anota('A · confirmar sin perfil', await leer());
await page.screenshot({ path:`${OUT}/stress-A-sin-perfil.png` });

// --- C: doble toque
await sub.click({force:true}); await sub.click({force:true});
await page.waitForTimeout(2500);
anota('C · doble toque', await leer());

// --- B: superar el stock. El producto de menor stock publicado es el PET 1,5 L (5).
await page.evaluate(()=>{location.hash='#catalog';}); await page.waitForTimeout(2500);
const objetivo = await page.evaluate(()=>{
  const nodos=[...document.querySelectorAll('[data-add-product]')];
  const el=nodos.find(n=>/coca-cola-original-pet-1500ml/i.test(n.getAttribute('data-add-product')||''));
  return el?el.getAttribute('data-add-product'):(nodos[0]?.getAttribute('data-add-product')||'');
});
if (objetivo) {
  for (let i=0;i<9;i+=1){ const b=page.locator(`[data-add-product="${objetivo}"] >> visible=true`).first();
    if (await b.count()===0) break; await b.click({force:true}); await page.waitForTimeout(450); }
}
await abrirCarrito(); await page.waitForTimeout(1500);
anota('B · más unidades que el stock', { objetivo, ...(await leer()) });
await page.screenshot({ path:`${OUT}/stress-B-sin-stock.png`, fullPage:true });

// --- D: refrescar con el carrito lleno
await page.reload({waitUntil:'domcontentloaded'});
await page.locator('html[data-taba-startup="ready"]').waitFor({state:'attached',timeout:90_000});
await page.waitForTimeout(3500);
anota('D · refresco', await leer());

// --- E: volver atrás
await abrirCarrito(); await page.goBack(); await page.waitForTimeout(2500);
anota('E · volver atrás', { hash: await page.evaluate(()=>location.hash), ...(await leer()) });

console.log(JSON.stringify(r,null,1));
console.error('ERRORES: '+JSON.stringify([...new Set(errores)].slice(0,8)));
await nav.close();
