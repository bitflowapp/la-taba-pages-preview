import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const p = await c.newPage();
await p.goto('https://la-taba.pages.dev', { waitUntil:'networkidle', timeout:90000 });
await p.waitForSelector('[data-add-product]'); await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  const ids = [...document.querySelectorAll('[data-product-grid] [data-add-product], [data-home-best-sellers] [data-add-product]')].map(b=>b.getAttribute('data-add-product'));
  return ids.slice(0,6);
});
console.log(JSON.stringify(r,null,1));
await b.close();
