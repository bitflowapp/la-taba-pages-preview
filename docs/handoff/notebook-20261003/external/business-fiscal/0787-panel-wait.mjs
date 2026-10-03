import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

// Keeps the developer panel open while a human clears Mercado Pago's phone
// verification, re-navigating on each poll so the check cannot get stuck on a
// stale page.
const PROFILE = 'D:/1212/browser-temp/taba2-mp-real';
const TARGET = 'https://www.mercadopago.com.ar/developers/panel/app/2691240967769590/webhooks';
const DEADLINE = Date.now() + 40 * 60 * 1000;

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1360, height: 950 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();
fs.writeFileSync('panel-status.txt', 'ESPERANDO_VERIFICACION');
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
console.log('Ventana abierta en la verificacion. Esperando...');

while (Date.now() < DEADLINE) {
  await page.waitForTimeout(20000);
  const url = page.url();
  if (/developers\/panel/.test(url) && !/phone-validation|challenges|login/.test(url)) {
    fs.writeFileSync('panel-status.txt', `PANEL_OK ${url}`);
    console.log('PANEL OK');
    await context.close();
    process.exit(0);
  }
  // Only re-navigate when the human is not mid-form, to avoid wiping input.
  if (/developers\/panel/.test(url) === false && /mercadopago|mercadolibre/.test(url)) {
    const busy = await page.evaluate('Boolean(document.querySelector("input:not([type=hidden])"))').catch(() => true);
    if (!busy) await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
}

fs.writeFileSync('panel-status.txt', 'TIMEOUT');
await context.close();
process.exit(1);
