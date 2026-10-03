// Sonda rápida de implementación. No pertenece al repositorio de producto.
import { chromium } from '@playwright/test';

const BASE = process.env.TABA_BASE || 'http://127.0.0.1:8099';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/?demo=1#catalog`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-product-grid] .product-card', { timeout: 20000 });

const report = await page.evaluate(() => {
  const body = getComputedStyle(document.body);
  const main = document.querySelector('main[data-app-main]');
  const card = document.querySelector('[data-product-grid] .product-card');
  const media = card?.querySelector('.product-media');
  const img = card?.querySelector('.thumb-img');
  const mr = media?.getBoundingClientRect();
  const ir = img?.getBoundingClientRect();
  return {
    fontFamily: body.fontFamily.slice(0, 60),
    bottomReserve: body.getPropertyValue('--bottom-reserve'),
    mainPad: getComputedStyle(main).paddingBottom,
    dataCart: document.body.dataset.cart,
    mediaBox: mr && { w: Math.round(mr.width), h: Math.round(mr.height) },
    packRatio: mr && ir ? Number((ir.height / mr.height).toFixed(3)) : null,
    cardsPerRow: (() => {
      const cards = [...document.querySelectorAll('[data-product-grid] .product-card')];
      if (!cards.length) return 0;
      const top = cards[0].getBoundingClientRect().top;
      return cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) <= 1).length;
    })(),
    firstCardTop: Math.round(card.getBoundingClientRect().top),
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    pricesAboveFold: [...document.querySelectorAll('[data-product-grid] .price strong')]
      .filter((n) => n.getBoundingClientRect().bottom <= window.innerHeight).length,
  };
});
console.log(JSON.stringify(report, null, 2));
console.log('errores:', errors);
await page.screenshot({ path: new URL('../screenshots/probe-catalog-390.png', import.meta.url).pathname.slice(1) });
await browser.close();
