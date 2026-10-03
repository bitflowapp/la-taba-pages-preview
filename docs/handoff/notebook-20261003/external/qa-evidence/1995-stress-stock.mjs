/* Qué pasa cuando el cliente pide MÁS de lo que hay. Producto de menor stock
 * publicado: Coca-Cola Original PET 1,5 L (stock 5). Sin crear pedidos. */
import { chromium } from '@playwright/test';
const BASE='https://la-taba.pages.dev'; const OUT='artifacts/weekend-launch';
const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:2, serviceWorkers:'allow', locale:'es-AR' });
const page = await ctx.newPage();
const errores=[]; page.on('console',m=>{if(m.type()==='error')errores.push(m.text().slice(0,140));});
await page.goto(BASE,{waitUntil:'domcontentloaded'});
await page.locator('html[data-taba-startup="ready"]').waitFor({state:'attached',timeout:90_000});
await page.waitForTimeout(3000);

// buscar el PET 1,5 L por su nombre en el buscador
await page.evaluate(()=>{location.hash='#catalog';}); await page.waitForTimeout(2000);
await page.waitForTimeout(1500);
const candidatos = await page.evaluate(()=>{
  const vis=(el)=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0;};
  return [...document.querySelectorAll('[data-add-product]')].filter(vis).map(b=>{
    const card=b.closest('article,li,div[class*=card]');
    return { id:b.getAttribute('data-add-product'), txt:(card?.textContent||'').replace(/\s+/g,' ').trim().slice(0,70) };
  });
});
const pet = candidatos.find(c=>/1,5\s*L/i.test(c.txt)) || candidatos[0];
await page.locator(`[data-add-product="${pet.id}"] >> visible=true`).first().click();
await page.waitForTimeout(1200);
await page.locator('[data-open-cart] >> visible=true').first().click();
await page.waitForTimeout(2500);

const pasos=[];
for (let i=1;i<=8;i+=1){
  const mas = page.locator('[data-cart-inc] >> visible=true').first();
  const n = await mas.count();
  if (!n) { pasos.push({ intento:i, resultado:'ya no hay botón +' }); break; }
  const deshabilitado = await mas.isDisabled().catch(()=>false);
  if (deshabilitado) { pasos.push({ intento:i, resultado:'el + quedó deshabilitado' }); break; }
  await mas.click({force:true});
  await page.waitForTimeout(900);
  const estado = await page.evaluate(()=>{
    const vis=(el)=>{const s=getComputedStyle(el);const b=el.getBoundingClientRect();return s.display!=='none'&&b.width>0&&b.height>0;};
    const av=document.querySelector('[data-checkout-warning]');
    const cant=[...document.querySelectorAll('[data-cart-qty], .cart-qty')].filter(vis).map(e=>e.textContent.trim())[0]
      || (document.querySelector('[data-cart-inc]')?.parentElement?.textContent||'').replace(/\s+/g,' ').trim();
    return { cant, aviso: av&&vis(av)?av.textContent.trim():null,
      resumen:(document.querySelector('[data-order-summary]')?.textContent||'').replace(/\s+/g,' ').trim(),
      toast:[...document.querySelectorAll('[role=status],[role=alert],.toast')].filter(vis).map(e=>e.textContent.trim().slice(0,120)).filter(t=>t&&!/Completá tu perfil|Agregá una dirección/.test(t)) };
  });
  pasos.push({ intento:i, ...estado });
}
console.log(JSON.stringify({ producto: pet, pasos }, null, 1));
await page.screenshot({ path:`${OUT}/stress-stock.png`, fullPage:true });
console.error('ERRORES: '+JSON.stringify([...new Set(errores)].slice(0,5)));
await nav.close();
