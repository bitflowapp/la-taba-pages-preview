import { chromium } from '@playwright/test';
const BASE = process.env.BASE || 'https://la-taba.pages.dev';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const p = await c.newPage();
const errs=[]; p.on('console', m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); });
await p.goto(BASE, { waitUntil:'networkidle', timeout:90000 });
await p.waitForTimeout(3500);
const info = await p.evaluate(() => {
  const attrs = new Set();
  document.querySelectorAll('*').forEach(el => { for (const a of el.attributes) if (a.name.startsWith('data-')) attrs.add(a.name); });
  const nav = [...document.querySelectorAll('nav a, nav button, [role=tab], header button, [data-view], [data-nav]')].map(e=>({t:(e.textContent||'').trim().slice(0,40), d:e.getAttribute('data-view')||e.getAttribute('data-nav')||'', tag:e.tagName}));
  const secs = [...document.querySelectorAll('section, [data-section]')].map(s=>({id:s.id||'', ds:s.getAttribute('data-section')||'', h:(s.querySelector('h1,h2,h3')||{}).textContent?.trim().slice(0,50)||''}));
  const cards = document.querySelectorAll('[data-product-card], .product-card, [data-product-id]').length;
  return { attrs:[...attrs].sort(), nav, secs, cards, title:document.title, viewport:document.querySelector('meta[name=viewport]')?.content };
});
console.log(JSON.stringify(info,null,1));
console.log('CONSOLE ERRORS:', JSON.stringify(errs,null,1));
await b.close();
