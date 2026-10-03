import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, locale:'es-AR' });
const p = await c.newPage();
await p.goto('http://127.0.0.1:18194', { waitUntil:'networkidle', timeout:90000 });
await p.waitForSelector('[data-add-product]'); await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  const rail = document.querySelector('[data-home-best-sellers]');
  const cards = [...rail.querySelectorAll('article')].slice(0,8);
  return cards.map(c => c.querySelector('.home-best-copy')?.innerHTML?.replace(/\s+/g,' ').slice(0,220));
});
console.log(r.join('\n\n'));
await b.close();
