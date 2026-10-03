import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.addInitScript(()=>{ localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({v:1,decision:'declined',at:'2026-01-01T00:00:00.000Z',platform:'e2e'})); });
await p.goto('http://127.0.0.1:8096/?reset=1&demo=1#catalog', { waitUntil:'networkidle', timeout:60000 });
await p.waitForTimeout(2500);
const t = await p.evaluate(() => [...document.querySelectorAll('[data-product-grid] .product-card')]
  .map(c=>c.innerText.replace(/\s+/g,' ').trim()).filter(x=>/speed/i.test(x)));
console.log(JSON.stringify(t,null,1));
await b.close();
