import { chromium } from '@playwright/test';
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:360,height:800}, isMobile:true, hasTouch:true });
const p = await c.newPage();
await p.addInitScript(()=>{ localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({v:1,decision:'declined',at:'2026-01-01T00:00:00.000Z',platform:'e2e'})); });
await p.goto('http://127.0.0.1:8099/?reset=1&demo=1', { waitUntil:'networkidle', timeout:60000 });
await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  const y = (sel) => { const e=document.querySelector(sel); if(!e) return null; const b=e.getBoundingClientRect(); return {top:Math.round(b.top+scrollY), bottom:Math.round(b.bottom+scrollY), alto:Math.round(b.height)}; };
  const nav=document.querySelector('.mobile-nav');
  const cta=document.querySelector('[data-add-product]');
  return {
    util: Math.round(innerHeight - (nav?nav.getBoundingClientRect().height:0)),
    hero: y('.taba-home-hero'), id: y('.brand-hero-id'), estado: y('.brand-hero-state'),
    strip: y('.brand-stories-strip'), promo: y('.home-hero-promo-slot'), search: y('.taba-home-search'),
    chips: y('.home-category-strip'), best: y('.home-best-section'),
    cta: cta?Math.round(cta.getBoundingClientRect().bottom+scrollY):null,
  };
});
console.log(JSON.stringify(r,null,1));
await b.close();
