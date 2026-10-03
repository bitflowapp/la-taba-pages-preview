import { createRequire } from 'node:module';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

const target = process.argv[2];
const shot = process.argv[3] || 'recon.png';

// Mercado Pago's WAF rejects headless Chromium outright (403 on every asset),
// so recon runs headed against a persistent profile.
const context = await chromium.launchPersistentContext('D:/1212/browser-temp/taba2-mp-e2e', {
  headless: false,
  channel: process.env.MP_CHANNEL || undefined,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const browser = context.browser() || { close: () => context.close() };
const page = context.pages()[0] || await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });

await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

console.log('URL FINAL:', page.url());
console.log('TITLE:', await page.title());
await page.screenshot({ path: shot, fullPage: true });

const text = (await page.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, '\n').slice(0, 2500);
console.log('--- TEXTO VISIBLE ---');
console.log(text);

const fields = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input, button, select, [role=button], a[href]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      id: el.id || '',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      label: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 60),
      testid: el.getAttribute('data-testid') || '',
    });
  }
  return out.slice(0, 60);
});
console.log('--- CONTROLES ---');
console.log(JSON.stringify(fields, null, 1));

await browser.close();
