import { chromium } from '@playwright/test';
const [w, h] = (process.env.VP || '390x844').split('x').map(Number);
const route = process.env.ROUTE || 'catalog';
const sels = JSON.parse(process.env.SELS);
const props = (process.env.PROPS || 'display,padding,margin,gap,gridTemplateRows,gridTemplateColumns,fontSize,fontWeight,lineHeight,minHeight,height,borderRadius,position,top').split(',');
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' })).newPage();
await p.goto(`http://127.0.0.1:8231/?reset=1&demo=1${process.env.VITRINA === '0' ? '' : '&vitrina=neuquen20261024'}`);
await p.waitForURL(u => !u.searchParams.has('reset'));
await p.waitForSelector('[data-view="home"]'); await p.waitForTimeout(1200);
if (route !== 'home') { await p.evaluate((r) => { location.hash = '#' + r; }, route); await p.waitForTimeout(1200); }
const out = await p.evaluate(({ sels, props }) => sels.map(s => { const e = document.querySelector(s); if (!e) return s + ': none'; const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return s + ` [${Math.round(r.width)}x${Math.round(r.height)}]\n   ` + props.map(k => `${k}=${c[k]}`).join(' | '); }), { sels, props });
console.log(out.join('\n'));
await b.close();
