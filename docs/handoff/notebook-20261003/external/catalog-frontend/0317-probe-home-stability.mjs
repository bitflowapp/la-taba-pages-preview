// Distingue un bug permanente de una inestabilidad de carga.
// Captura el mismo rail a 400ms, 900ms y 2500ms.
const { chromium } = await import(
  'file:///C:/Users/marco/dev/la-taba-pages-preview/node_modules/playwright/index.mjs'
);
const OUT = 'C:/1212/artifacts/taba-opus-design-review/screenshots/current';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();

const shots = [];
await page.goto('http://127.0.0.1:8791/?reset=1&demo=1#home', { waitUntil: 'commit' });
for (const ms of [400, 900, 2500]) {
  await page.waitForTimeout(ms - (shots.at(-1)?.at || 0));
  const state = await page.evaluate(() => {
    const rail = document.querySelector('[data-home-best-sellers]');
    const card = rail?.children?.[0];
    const r = card?.getBoundingClientRect();
    return {
      cards: rail?.children?.length ?? 0,
      cardH: r ? Math.round(r.height) : null,
      cardW: r ? Math.round(r.width) : null,
      text: (card?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      docH: document.documentElement.scrollHeight,
    };
  });
  await page.screenshot({ path: `${OUT}/stability-home-${ms}ms.png` });
  shots.push({ at: ms, ...state });
  console.log(`${ms}ms  cards=${state.cards} card=${state.cardW}x${state.cardH} docH=${state.docH} text="${state.text}"`);
}

await page.screenshot({ path: `${OUT}/home-390x844-settled.png`, fullPage: false });
await browser.close();
