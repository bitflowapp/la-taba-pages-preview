import { connect, metrics } from './moto.mjs';

const { browser, page } = await connect();
console.log(JSON.stringify(await metrics(page), null, 2));

// Geometría de los elementos clave de la home en el teléfono real.
const geo = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const q = (s) => document.querySelector(s);
  return {
    topbar: rect(q('.topbar')),
    mobileNav: rect(q('.mobile-nav')),
    demoBadge: rect(q('[data-demo-banner], .demo-banner, .demo-chip')),
    search: rect(q('input[type=search]:not([hidden])')),
    firstCard: rect(q('.home-best-card')),
    cartFab: rect(q('.floating-cart, [data-floating-cart]')),
  };
});
console.log(JSON.stringify(geo, null, 2));
await browser.close();
