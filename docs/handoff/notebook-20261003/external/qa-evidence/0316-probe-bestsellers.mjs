// ¿Las tarjetas de "Los más vendidos" están vacías por bug o por diseño?
const { chromium } = await import(
  'file:///C:/Users/marco/dev/la-taba-pages-preview/node_modules/playwright/index.mjs'
);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.goto('http://127.0.0.1:8791/?reset=1&demo=1#home');
await page.waitForLoadState('load');
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const rail = document.querySelector('[data-home-best-sellers]');
  if (!rail) return { error: 'rail ausente' };
  const cards = [...rail.children];
  return {
    railClass: rail.className,
    cardCount: cards.length,
    railScroll: { client: rail.clientWidth, scroll: rail.scrollWidth },
    cards: cards.slice(0, 3).map((c) => {
      const r = c.getBoundingClientRect();
      return {
        cls: c.className,
        w: Math.round(r.width),
        h: Math.round(r.height),
        html: c.outerHTML.slice(0, 700),
        textContent: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        children: [...c.children].map((k) => {
          const kr = k.getBoundingClientRect();
          const ks = getComputedStyle(k);
          return {
            cls: k.className, w: Math.round(kr.width), h: Math.round(kr.height),
            display: ks.display, overflow: ks.overflow,
            text: (k.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          };
        }),
      };
    }),
  };
});
console.log(JSON.stringify(info, null, 2));

await page.locator('[data-home-best-sellers]').screenshot({
  path: 'C:/1212/artifacts/taba-opus-design-review/screenshots/current/detail-bestsellers-390.png',
}).catch((e) => console.log('screenshot:', e.message));

await browser.close();
