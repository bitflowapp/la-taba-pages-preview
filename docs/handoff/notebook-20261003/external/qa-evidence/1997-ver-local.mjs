/* Captura los cambios contra el servidor local en modo demo (catálogo con packs). */
import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:4599'; const OUT='artifacts/weekend-launch';
const nav=await chromium.launch();
const ctx=await nav.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2,locale:'es-AR'});
const page=await ctx.newPage();
const errores=[]; page.on('pageerror',e=>errores.push(e.message)); page.on('console',m=>{if(m.type()==='error')errores.push(m.text().slice(0,160));});
await page.goto(`${BASE}/?demo=1#catalog`,{waitUntil:'domcontentloaded'});
await page.locator('html[data-taba-startup="ready"]').waitFor({state:'attached',timeout:60_000});
await page.waitForTimeout(2500);
const condiciones = await page.evaluate(()=>[...document.querySelectorAll('.price-condition')].map(e=>{
  const card=e.closest('article'); return {txt:e.textContent.trim(), producto:(card?.querySelector('h3')?.textContent||'').trim(), pres:(card?.querySelector('p')?.textContent||'').trim()};}));
console.log('CONDICIONES BAJO EL PRECIO (demo):');
for (const c of condiciones) console.log(`  ${c.producto} · ${c.pres} → «${c.txt}»`);
await page.screenshot({ path:`${OUT}/local-catalogo-demo.png`, fullPage:false });

// carrito: la píldora de modo de entrega
await page.locator('[data-add-product]:not([disabled]) >> visible=true').first().click();
await page.waitForTimeout(900);
await page.evaluate(()=>{location.hash='#cart';}); await page.waitForTimeout(2000);
const modo = await page.evaluate(()=>{
  const c=document.querySelector('.delivery-mode');
  const labels=[...c.querySelectorAll('label')].map(l=>({v:l.dataset.fulfillmentOption,oculto:l.hidden,w:Math.round(l.getBoundingClientRect().width)}));
  return { contenedorW: Math.round(c.getBoundingClientRect().width), columnas: getComputedStyle(c).gridTemplateColumns, labels };
});
console.log('\nMODO DE ENTREGA (demo, dos opciones):', JSON.stringify(modo));
// forzar el caso de producción: una sola opción visible
await page.evaluate(()=>{ document.querySelector('[data-fulfillment-option="pickup"]').hidden = true; });
await page.waitForTimeout(400);
const modo1 = await page.evaluate(()=>{
  const c=document.querySelector('.delivery-mode');
  const l=c.querySelector('[data-fulfillment-option="delivery"]');
  return { contenedorW: Math.round(c.getBoundingClientRect().width), columnas: getComputedStyle(c).gridTemplateColumns, deliveryW: Math.round(l.getBoundingClientRect().width) };
});
console.log('MODO DE ENTREGA (una sola opción):', JSON.stringify(modo1));
await page.screenshot({ path:`${OUT}/local-carrito-una-opcion.png`, fullPage:false });
console.log('\nERRORES: '+JSON.stringify([...new Set(errores)].slice(0,6)));
await nav.close();
