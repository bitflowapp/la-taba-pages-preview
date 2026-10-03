import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto('http://127.0.0.1:8099/?reset=1&demo=1#catalog', { waitUntil:'networkidle', timeout:60000 });
await p.waitForTimeout(2500);
const html = await p.evaluate(() => {
  const el = document.querySelector('[data-add-product="coca-cola-original-pet-1500ml"]')?.closest('article');
  return el ? el.outerHTML.replace(/\s+/g,' ') : 'NO CARD';
});
console.log(html.slice(0,1600));
await b.close();
