import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
await p.goto(`http://127.0.0.1:8231/?reset=1&demo=1&vitrina=neuquen20261024`);
await p.waitForURL(u => !u.searchParams.has('reset'));
await p.waitForSelector('[data-view="home"]'); await p.waitForTimeout(1200);
await p.evaluate(() => { location.hash = '#catalog'; }); await p.waitForTimeout(1000);
console.log((await p.evaluate(() => document.querySelector('.catalog-masthead')?.outerHTML || document.querySelector('.catalog-controls')?.parentElement.outerHTML)).replace(/<svg[\s\S]*?<\/svg>/g,'<svg/>').replace(/<!--[\s\S]*?-->/g,'').replace(/\s+/g,' ').slice(0,3000));
await b.close();
