import { createRequire } from 'node:module';
const require = createRequire('C:/Users/marco/dev/la-taba-business-panel-automation/package.json');
const { chromium } = require('@playwright/test');
import fs from 'node:fs';

const SCALE = 2.5;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
  isMobile: true, hasTouch: true,
  recordVideo: { dir: 'D:/1212/taba-promo-v2/takes-test', size: { width: 1080, height: 1920 } },
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const applyScale = (s) => cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 432, height: 768, deviceScaleFactor: 2.5, mobile: true, scale: s,
});

await page.goto('http://127.0.0.1:8093/?demo=1');
await page.waitForTimeout(2000);
await applyScale(SCALE);
await page.waitForTimeout(400);

async function tap(locator) {
  const box = await locator.boundingBox();
  await page.mouse.click((box.x + box.width / 2) * SCALE, (box.y + box.height / 2) * SCALE);
}

await tap(page.locator('.mobile-nav [data-nav-view="catalog"]'));
await page.waitForTimeout(1500);
console.log('activeView tras tap escalado:', await page.evaluate(() => document.body.dataset.activeView));

await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = '__slate';
  d.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;background:#f0f;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(d);
});
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('__slate')?.remove());
await page.waitForTimeout(1500);
const vid = page.video();
await page.close();
const p = await vid.path();
await ctx.close();
await browser.close();
fs.copyFileSync(p, 'D:/1212/taba-promo-v2/takes-test/scale-test.webm');
console.log('ok video');
