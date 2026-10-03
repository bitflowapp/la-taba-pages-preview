import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
 userAgent:'Mozilla/5.0 (Linux; Android 14; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'});
const p = await c.newPage();
await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000}); await p.waitForTimeout(5500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const R=s=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {y:Math.round(b.top+scrollY),h:Math.round(b.height),disp:getComputedStyle(e).display};};
  const ts=document.querySelector('.topbar-search');
  return {
    viewportH: innerHeight,
    topbar: R('.topbar'), topbarSearch: {...R('.topbar-search'), aria: ts?.getAttribute('aria-label'), visible: ts? ts.offsetParent!==null : null},
    hero: R('.taba-home-hero'), heroH1: R('#home-title'), storiesStrip: R('.brand-stories-strip'),
    homeSearch: R('.taba-home-search'), chips: R('.home-category-strip'),
    railHead: R('.home-best-section .home-section-head'), primeraTarjeta: R('.home-best-section [data-add-product]')
      , barraInferior: R('nav.bottom-nav, .bottom-nav, [data-bottom-nav], footer nav'),
    primerPrecioY: (()=>{const e=[...document.querySelectorAll('*')].find(x=>!x.children.length&&/^\$\s?[\d.]/.test((x.textContent||'').trim())); return e?Math.round(e.getBoundingClientRect().top+scrollY):null;})(),
    ultimoPixelUtil: innerHeight - (document.querySelector('.bottom-nav,nav.bottom-nav,[data-bottom-nav]')?.getBoundingClientRect().height||0),
    tarjetaAlto: Math.round(document.querySelector('.home-best-section [data-add-product]')?.closest('article,li,div')?.getBoundingClientRect().height||0),
  };
}),null,1));
await b.close();
