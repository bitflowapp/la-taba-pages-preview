import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
 userAgent:'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'});
const p = await c.newPage();
await p.goto('https://la-taba.pages.dev', {waitUntil:'networkidle', timeout:90000});
await p.waitForTimeout(6000);
const r = await p.evaluate(()=>{
  const clean=s=>(s||'').replace(/[ \t]+/g,' ').trim();
  const home=document.querySelector('[data-view="home"]');
  const all=clean(document.body.innerText);
  const jerga=/TABA2|demo|prueba|test|staging|placeholder|lorem|sandbox|QA|mock|seed|preview|beta|piloto|interno|sin publicar|borrador/gi;
  const hits=[...new Set(all.match(jerga)||[])];
  // envío / delivery
  const envio=/env[ií]o|deliver|reparto|reparti|llega|minutos|domicilio|gratis|retiro|cadete/gi;
  const envioHits=[...new Set(all.match(envio)||[])];
  const ctx=[]; all.split('\n').forEach(l=>{ if(envio.test(l)) ctx.push(clean(l)); envio.lastIndex=0; });
  return { homeText: clean(home.innerText), bodyTail: all.slice(-800), jerga:hits, envioHits, envioCtx:ctx.slice(0,15),
    metaDesc: document.querySelector('meta[name=description]')?.content,
    title: document.title,
    ariaLabels: [...document.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label')).filter(a=>/TABA2|demo|test|prueba/i.test(a)),
    manifest: null };
});
console.log('TITLE:', r.title);
console.log('META:', r.metaDesc);
console.log('ARIA con jerga:', r.ariaLabels);
console.log('JERGA VISIBLE EN TEXTO:', r.jerga);
console.log('SEÑALES DE ENVIO:', r.envioHits, '| ctx:', r.envioCtx);
console.log('\n=== TEXTO HOME COMPLETO ===\n'+r.homeText);
console.log('\n=== COLA BODY ===\n'+r.bodyTail);
await b.close();
