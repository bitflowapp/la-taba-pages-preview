import { chromium } from '@playwright/test';
const b=await chromium.launch();
for (const vp of [{w:390,h:844,m:true,tag:'MOBILE'},{w:1280,h:900,m:false,tag:'DESKTOP'}]) {
  const c=await b.newContext({viewport:{width:vp.w,height:vp.h},hasTouch:vp.m,isMobile:vp.m});
  const p=await c.newPage();
  await p.goto('https://la-taba.pages.dev',{waitUntil:'networkidle',timeout:90000});
  await p.waitForTimeout(5500);
  await p.evaluate(()=>{document.querySelector('[data-install-sheet]')?.remove();});
  const r=await p.evaluate(()=>{
    const lab=document.querySelector('.topbar-search');
    const inp=lab?.querySelector('input');
    return { labAria:lab?.getAttribute('aria-label'), labRects:lab?.getClientRects().length,
      inpVisible: inp? (inp.getClientRects().length>0 && getComputedStyle(inp).visibility!=='hidden'):null,
      inpPlaceholder: inp?.placeholder, inpAria: inp?.getAttribute('aria-label') };
  });
  console.log(vp.tag, JSON.stringify(r));
  const inp = await p.$('.topbar-search input');
  if (inp) {
    console.log(vp.tag,'accessibleName =', JSON.stringify(await inp.evaluate(e=>e.getAttribute('aria-label'))));
    // ax skipped
    //
  }
  // Abrir filtros y capturar la opción cruda
  await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>/Categor|Catálogo/i.test(x.textContent||''));el&&el.click();});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(x=>/Filtro/i.test(x.textContent||''));el&&el.click();});
  await p.waitForTimeout(1400);
  const f=await p.evaluate(()=>{
    const sel=document.querySelector('[data-catalog-filter="presentation"]');
    const cap=document.querySelector('[data-catalog-filter="capacity"]');
    return { presVisible: !!sel?.getClientRects().length, pres:[...(sel?.options||[])].map(o=>o.text),
      capVisible: !!cap?.getClientRects().length, cap:[...(cap?.options||[])].map(o=>o.text) };
  });
  console.log(vp.tag,'FILTROS', JSON.stringify(f));
  await p.screenshot({path:`.local/shot-filtros-${vp.tag}.png`, fullPage:false});
  await c.close();
}
await b.close();
