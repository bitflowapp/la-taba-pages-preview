import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true, locale:'es-AR',
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
await p.goto('https://la-taba.pages.dev', { waitUntil:'networkidle', timeout:90000 });
await p.waitForSelector('[data-add-product]'); await p.waitForTimeout(2500);
for (const sel of ['[data-install-close]','[data-install-decline]']) { const l=p.locator(sel+':visible').first(); if(await l.count()){ await l.click().catch(()=>{}); break; } }
await p.keyboard.press('Escape').catch(()=>{});
await p.waitForTimeout(600);
await p.locator('.mobile-nav [data-nav-view="catalog"]').first().click();
await p.waitForTimeout(1200);
for (const q of ['coca','zero','sprite','agua','energetica','energética','pepsi','1,5','pack','sin azucar']) {
  const input = p.locator('[data-search-input]:visible').first();
  await input.fill(q);
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const g = document.querySelector('[data-product-grid]');
    return { n: g? g.querySelectorAll('[data-add-product]').length:0,
      nombres: g? [...g.querySelectorAll('[data-add-product]')].map(b=>(b.closest('article,li,.product-card')||b.parentElement)?.querySelector('h3,h4,[class*=name],[class*=title]')?.textContent?.trim()).slice(0,12):[],
      vacio: (document.querySelector('[data-product-grid]')?.textContent||'').replace(/\s+/g,' ').trim().slice(0,120),
      buscarEnTodo: !!document.querySelector('[data-search-everywhere]') };
  });
  console.log(JSON.stringify({q, n:r.n, buscarEnTodo:r.buscarEnTodo, nombres:r.nombres, vacio:r.n?undefined:r.vacio}));
  await input.fill(''); await p.waitForTimeout(400);
}
await b.close();
