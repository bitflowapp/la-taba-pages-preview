import { chromium } from '@playwright/test';
const nav=await chromium.launch();
const ctx=await nav.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'allow',locale:'es-AR'});
const page=await ctx.newPage();
await page.goto('https://la-taba.pages.dev/',{waitUntil:'domcontentloaded'});
await page.locator('html[data-taba-startup="ready"]').waitFor({state:'attached',timeout:90_000});
await page.waitForTimeout(3000);
await page.locator('[data-add-product] >> visible=true').first().click(); await page.waitForTimeout(1000);
await page.locator('[data-open-cart] >> visible=true').first().click(); await page.waitForTimeout(2500);
const m = await page.evaluate(()=>{
  const vis=(el)=>{const s=getComputedStyle(el);const b=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&b.height>0;};
  const y=(el)=>({t:Math.round(el.getBoundingClientRect().top+scrollY),b:Math.round(el.getBoundingClientRect().bottom+scrollY)});
  const sel=(q)=>{const e=[...document.querySelectorAll(q)].find(vis);return e?{q,...y(e),cls:e.className}:{q,ausente:true};};
  // buscar el ancestro del modo de entrega
  const modo=[...document.querySelectorAll('[name="deliveryMode"]')].map(i=>{const w=i.closest('label')||i.parentElement;const r=w.getBoundingClientRect();const p=w.parentElement.getBoundingClientRect();
    return {valor:i.value, w:Math.round(r.width), h:Math.round(r.height), contenedorW:Math.round(p.width), contenedorCls:w.parentElement.className, wCls:w.className, oculto:!vis(w)};});
  // hueco entre el bloque de acciones y la tarjeta de productos
  const acciones=[...document.querySelectorAll('[data-clear-cart]')].find(vis);
  const productos=[...document.querySelectorAll('h3')].find(h=>vis(h)&&/Productos/.test(h.textContent));
  const tarjeta=productos?productos.closest('section,div[class*=card],article'):null;
  return {
    h1: sel('h1'), acciones: acciones?y(acciones):null, tituloProductos: productos?y(productos):null,
    tarjetaProductos: tarjeta?{...y(tarjeta),cls:tarjeta.className}:null,
    huecoPx: acciones&&tarjeta ? Math.round(tarjeta.getBoundingClientRect().top - acciones.getBoundingClientRect().bottom) : null,
    modo,
    contenedorModo: (()=>{const i=document.querySelector('[name="deliveryMode"]'); const c=i?.closest('[class*=delivery],[class*=mode],fieldset,div'); const r=c?.getBoundingClientRect(); return c?{cls:c.className,w:Math.round(r.width),h:Math.round(r.height)}:null;})(),
  };
});
console.log(JSON.stringify(m,null,1));
await nav.close();
