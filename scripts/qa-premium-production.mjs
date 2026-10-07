import { chromium } from '@playwright/test';
import fs from 'node:fs';
const out = 'artifacts/frontend-premium-20261007/before/production';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of [{width:390,height:844},{width:1920,height:1080}]) {
    const context = await browser.newContext({viewport, serviceWorkers:'block'});
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({v:1,decision:'declined',at:'2026-01-01T00:00:00.000Z',platform:'qa'})));
    await page.goto('https://la-taba.pages.dev/', {waitUntil:'domcontentloaded'});
    await page.waitForSelector('html[data-taba-startup="ready"]', {timeout:30000});
    await page.waitForTimeout(2000);
    await page.screenshot({path:`${out}/${viewport.width}-home.png`,type:'png'});
    await page.locator('[data-nav-view="catalog"]:visible').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({path:`${out}/${viewport.width}-catalog.png`,type:'png'});
    const info = await page.evaluate(async () => ({
      url: location.href, version: await fetch('/version.json').then(r=>r.json()).catch(()=>null),
      cards: document.querySelectorAll('[data-view="catalog"] .product-card').length,
      width: document.querySelector('[data-view="catalog"] [data-product-grid]')?.getBoundingClientRect().width,
    }));
    fs.writeFileSync(`${out}/${viewport.width}-inspection.json`,JSON.stringify(info,null,2));
    console.log(JSON.stringify(info));
    await context.close();
  }
} finally { await browser.close(); }
