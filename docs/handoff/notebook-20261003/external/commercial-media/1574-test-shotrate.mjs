import { createRequire } from 'node:module';
const require = createRequire('C:/Users/marco/dev/la-taba-business-panel-automation/package.json');
const { chromium } = require('@playwright/test');
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto('http://127.0.0.1:8093/?demo=1');
await page.waitForTimeout(1800);

// scroll continuo para forzar repintado durante la medición
await page.evaluate(() => {
  let dir = 1; let y = 0;
  setInterval(() => { y += dir * 24; if (y > 900 || y < 0) dir = -dir; window.scrollTo(0, y); }, 32);
});

const N = 40;
const times = [];
let bytes = 0;
let dims = '';
const t0 = Date.now();
for (let i = 0; i < N; i += 1) {
  const a = Date.now();
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg', quality: 85, fromSurface: true, optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: 432, height: 768, scale: 2.5 },
  });
  times.push(Date.now() - a);
  bytes += r.data.length;
  if (i === 0) {
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync('D:/1212/taba-promo-v2/frames/shotrate-sample.jpg', buf);
  }
}
const total = (Date.now() - t0) / 1000;
times.sort((x, y) => x - y);
console.log(JSON.stringify({
  fps: (N / total).toFixed(1),
  msMedian: times[Math.floor(N / 2)],
  msP90: times[Math.floor(N * 0.9)],
  avgKB: Math.round(bytes / N / 1024 * 0.75),
}));
await browser.close();
