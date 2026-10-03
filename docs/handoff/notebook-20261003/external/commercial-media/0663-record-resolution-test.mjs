import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire('C:/Users/marco/dev/la-taba-business-panel-automation/package.json');
const { chromium } = require('@playwright/test');
const out = path.resolve('artifacts/taba2-commercial/resolution-test');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  recordVideo: { dir: out, size: { width: 1080, height: 1920 } },
  locale: 'es-AR',
  serviceWorkers: 'block',
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:8123/?demo=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await context.close();
console.log(page.video() ? await page.video().path() : 'no-video');
await browser.close();
