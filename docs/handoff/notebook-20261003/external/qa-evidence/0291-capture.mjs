import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/1212/la-taba-catalog-checkout-premium/node_modules/playwright/index.js');
const BASE = 'C:/1212/artifacts/taba-opus-design-review/2026-07-31-v2/closure';
const cases = [
  ['catalog-mobile-320x568.png', 'prototype-catalog-mobile.html', { state: 'cart' }, 320, 568, true],
  ['catalog-empty-390x844.png', 'prototype-catalog-mobile.html', { state: 'empty' }, 390, 844, true],
  ['business-mobile-320x700.png', 'prototype-business-desktop.html', { state: 'queue', sheet: '1' }, 320, 700, true],
  ['business-mobile-360x800.png', 'prototype-business-desktop.html', { state: 'queue', sheet: '1' }, 360, 800, true],
  ['business-desktop-1024x768.png', 'prototype-business-desktop.html', { state: 'queue' }, 1024, 768, false],
  ['business-desktop-1280x900.png', 'prototype-business-desktop.html', { state: 'queue' }, 1280, 900, false],
  ['business-desktop-1440x1000.png', 'prototype-business-desktop.html', { state: 'queue' }, 1440, 1000, false],
  ['business-desktop-1920x1080.png', 'prototype-business-desktop.html', { state: 'queue' }, 1920, 1080, false],
  ['rider-login-390x844.png', 'prototype-rider-android.html', { screen: 'login' }, 390, 844, true],
  ['rider-code-390x844.png', 'prototype-rider-android.html', { screen: 'code' }, 390, 844, true],
  ['rider-incident-390x844.png', 'prototype-rider-android.html', { screen: 'incident' }, 390, 844, true],
];
const browser = await chromium.launch();
const out = [];
for (const [name, file, params, width, height, mobile] of cases) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  const supabase = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('request', request => { if (/supabase/i.test(request.url())) supabase.push(request.url()); });
  const url = pathToFileURL(path.join(BASE, file));
  url.search = new URLSearchParams({ chrome: '0', ...params }).toString();
  await page.goto(url.href, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(BASE, name), fullPage: false });
  out.push({ name, viewport: `${width}x${height}`, errors, supabase });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(BASE, 'capture-results.json'), JSON.stringify(out, null, 2));
if (out.some(x => x.errors.length || x.supabase.length)) process.exit(1);
console.log(`capturas=${out.length} errores=0 supabase=0`);
