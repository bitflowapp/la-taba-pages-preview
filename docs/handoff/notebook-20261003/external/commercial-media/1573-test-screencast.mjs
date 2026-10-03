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
const frames = [];
cdp.on('Page.screencastFrame', async (ev) => {
  frames.push({ ts: ev.metadata.timestamp, size: ev.data.length, data: frames.length < 3 ? ev.data : null });
  await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
});
await page.goto('http://127.0.0.1:8093/?demo=1');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
await page.waitForTimeout(1200);
await cdp.send('Page.stopScreencast');

const first = frames.find((f) => f.data);
fs.writeFileSync('D:/1212/taba-promo-v2/frames/screencast-sample.jpg', Buffer.from(first.data, 'base64'));
const wall = Date.now() / 1000;
console.log(JSON.stringify({
  frames: frames.length,
  tsFirst: frames[0]?.ts, tsLast: frames[frames.length - 1]?.ts,
  spanSec: (frames[frames.length - 1]?.ts - frames[0]?.ts).toFixed(2),
  tsVsWallDelta: (wall - frames[frames.length - 1]?.ts).toFixed(2),
  avgKB: Math.round(frames.reduce((a, f) => a + f.size, 0) / frames.length / 1024),
}));
await browser.close();
