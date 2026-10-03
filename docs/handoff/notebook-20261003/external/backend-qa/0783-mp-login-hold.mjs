import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

// Opens the real-account developer panel and waits for a human to complete the
// Mercado Pago login (password / MFA / captcha). Exits as soon as the panel is
// reachable, releasing the profile so the automation can drive it.
const PROFILE = 'D:/1212/browser-temp/taba2-mp-real';
const TARGET = 'https://www.mercadopago.com.ar/developers/panel/app/2691240967769590/credentials/sandbox';
const DEADLINE = Date.now() + 30 * 60 * 1000;

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1360, height: 950 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

fs.writeFileSync('login-status.txt', 'ESPERANDO_LOGIN');
console.log('Ventana abierta. Esperando login humano...');

while (Date.now() < DEADLINE) {
  await page.waitForTimeout(6000);
  const state = await page.evaluate(`(() => ({
    url: location.href,
    hasPassword: Boolean(document.querySelector('input[type=password]')),
    text: (document.body?.innerText || '').slice(0, 300),
  }))`).catch(() => null);
  if (!state) continue;
  const onPanel = /developers\/panel/.test(state.url) && !/login|challenges|password|registration/.test(state.url);
  if (onPanel && !state.hasPassword) {
    fs.writeFileSync('login-status.txt', `LOGIN_OK ${state.url}`);
    console.log('LOGIN OK ->', state.url);
    await context.close();
    process.exit(0);
  }
}

fs.writeFileSync('login-status.txt', 'TIMEOUT');
console.log('TIMEOUT esperando login');
await context.close();
process.exit(1);
