import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
await p.goto(`http://127.0.0.1:8231/?reset=1&demo=1&vitrina=neuquen20261024`);
await p.waitForURL(u => !u.searchParams.has('reset'));
await p.waitForSelector('[data-view="home"]'); await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const walk = (el, d, out) => { if (d > 6) return; for (const c of el.children) { if (c.closest('[hidden]')) continue; const r = c.getBoundingClientRect(); if (r.height < 1) continue; out.push(`${'  '.repeat(d)}${c.tagName.toLowerCase()}.${(typeof c.className==='string'?c.className:'').trim().split(/\s+/).slice(0,3).join('.')} [${Math.round(r.top+scrollY)} h${Math.round(r.height)} w${Math.round(r.width)}]`); if (!c.matches('article, button, svg')) walk(c, d + 1, out); } };
  const out = []; walk(document.querySelector('[data-view="home"] .taba-home-content'), 0, out); return out.slice(0, 140).join('\n');
});
console.log(r);
const fl = await p.evaluate(() => ['.mobile-nav','.topbar','.floating-cart','[data-demo-banner]','.demo-ribbon'].map(s => { const e = document.querySelector(s); return s + ' ' + (e ? e.className + ' h' + Math.round(e.getBoundingClientRect().height) : 'none'); }));
console.log(fl.join('\n'));
const demo = await p.evaluate(() => [...document.querySelectorAll('body *')].find(e => e.children.length < 3 && /Modo demostraci/.test(e.textContent))?.parentElement?.outerHTML.slice(0, 600));
console.log(demo);
await b.close();
