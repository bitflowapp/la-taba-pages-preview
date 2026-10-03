import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const p = await c.newPage();
await p.goto('http://127.0.0.1:18194', { waitUntil:'networkidle', timeout:90000 });
await p.waitForSelector('[data-add-product]'); await p.waitForTimeout(2500);
const r = await p.evaluate(async () => {
  const m = await import('./js/state.js');
  const prods = m.getState().products.filter(x=>/villa|benedictino/i.test(x.name||''));
  return prods.map(x=>({sku:x.sku,id:x.id,name:x.name,variant:x.variant,presentation:x.presentation,unitLabel:x.unitLabel}));
});
console.log(JSON.stringify(r,null,1));
await b.close();
