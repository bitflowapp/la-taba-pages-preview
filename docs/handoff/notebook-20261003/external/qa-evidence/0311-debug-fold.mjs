const { chromium } = await import(
  'file:///C:/Users/marco/dev/la-taba-pages-preview/node_modules/playwright/index.mjs'
);
const browser = await chromium.launch();
for (const w of [320, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 320 ? 568 : 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8792/prototype-catalog-mobile.html');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const fixed = [...document.querySelectorAll('body *')]
      .filter((e) => getComputedStyle(e).position === 'fixed')
      .map((e) => ({ cls: e.className, top: Math.round(e.getBoundingClientRect().top) }));
    const bandTop = Math.min(...fixed.map((f) => f.top));
    const prices = [...document.querySelectorAll('.product-price')].map((p) => {
      const b = p.getBoundingClientRect();
      return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height), txt: p.textContent.trim() };
    });
    return { bandTop, fixed, prices: prices.slice(0, 4) };
  });
  console.log(`w=${w} bandTop=${r.bandTop}`, JSON.stringify(r.fixed));
  console.log('  precios:', JSON.stringify(r.prices));
  await ctx.close();
}
await browser.close();
