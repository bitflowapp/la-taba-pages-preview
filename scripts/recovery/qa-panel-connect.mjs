// The REAL panel, in a real browser, against the hosted QA preview: the QA owner signs in through the app's own
// login form (test identity from Windows Credential Manager, typed by the browser automation into La Taba's
// page — never into Mercado Pago), opens Configuración → Mercado Pago, presses «Conectar Mercado Pago» and the
// navigation to Mercado Pago is intercepted. The single-use authorization URL (10 minutes) is printed for the
// person, who completes the consent in their own browser. Output never includes passwords or tokens.
//   node scripts/recovery/qa-panel-connect.mjs [--origin https://…] [--width 390] [--status-only] [--evidence file.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { passPreviewGate } from './preview-gate-login.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const origin = new URL(arg('--origin', 'https://recovery-20261020.taba2-staging.pages.dev')).origin;
assert.match(origin, /^https:\/\/[a-z0-9-]+\.taba2-staging\.pages\.dev$/, 'QA previews only');
const width = Number(arg('--width', '390'));
const statusOnly = process.argv.includes('--status-only');
const owner = leerSecreto('RECOVERY QA OWNER A');
assert.ok(owner?.usuario && owner?.secreto, 'QA owner credential unavailable');
const gate = leerSecreto('RECOVERY PREVIEW ACCESS');

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({
  viewport: { width, height: 844 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
  ...(gate?.usuario && gate?.secreto ? { httpCredentials: { username: gate.usuario, password: gate.secreto, origin } } : {}),
});
// The gate answers a navigation without access with its own login form: open the session first, in another tab.
await passPreviewGate(context, origin, gate);
const page = await context.newPage();
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160)); });
const dialogs = [];
page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
let authorizationUrl = '';
await page.route('https://auth.mercadopago.com.ar/**', route => { authorizationUrl = route.request().url(); return route.abort(); });
await page.route('https://auth.mercadopago.com/**', route => { authorizationUrl = route.request().url(); return route.abort(); });
const steps = [];
const step = (name, ok, detail = '') => { steps.push({ name, ok: Boolean(ok), detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
try {
  await page.goto(`${origin}/#business`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const form = page.locator('[data-production-auth-form="business"]');
  await form.waitFor({ state: 'visible', timeout: 45000 });
  await form.locator('input[name="email"]').fill(owner.usuario);
  await form.locator('input[name="password"]').fill(owner.secreto);
  await form.locator('button[type="submit"]').click();
  const workspace = page.locator('[data-production-workspace="business"]');
  await workspace.waitFor({ state: 'visible', timeout: 60000 });
  step('panel login with the QA owner', true);
  // The return parameter only selects the screen; the state is read from the server.
  await page.goto(`${origin}/?mp_connection=status#business`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const card = page.locator('[data-business-ops-center="payments-setup"] [data-mp-seller-state]');
  await card.waitFor({ state: 'visible', timeout: 60000 });
  const state = await card.getAttribute('data-mp-seller-state');
  const environment = await page.locator('[data-mp-environment]').getAttribute('data-mp-environment').catch(() => null);
  const text = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 600);
  step('Configuración → Mercado Pago visible', true, `state=${state} environment=${environment}`);
  const horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  step('no horizontal scroll', !horizontalScroll, `width=${width}`);
  if (!statusOnly) {
    const connect = page.locator('[data-mp-connection-action="connect"]');
    await connect.click({ timeout: 15000 });
    for (let i = 0; i < 40 && !authorizationUrl; i += 1) await page.waitForTimeout(500);
    const parsed = authorizationUrl ? new URL(authorizationUrl) : null;
    step('the panel button produced the official authorization URL',
      parsed?.pathname === '/authorization' && parsed.searchParams.get('code_challenge_method') === 'S256'
        && parsed.searchParams.get('client_id') === RECOVERY_TEST_APPLICATION_ID, parsed?.origin || 'none');
  }
  step('no browser dialogs', dialogs.length === 0, dialogs.join(',') || '');
  const result = { at: new Date().toISOString(), origin, width, state, environment, cardText: text, steps,
    consoleErrors: consoleErrors.slice(0, 10), authorization_url: authorizationUrl || null,
    note: authorizationUrl ? 'single-use, expires in 10 minutes; open it in a private window and log in as the TEST seller' : null };
  if (arg('--evidence')) fs.writeFileSync(arg('--evidence'), JSON.stringify({ ...result, authorization_url: authorizationUrl ? '[issued]' : null }, null, 2));
  console.log(JSON.stringify(result, null, 1));
  if (steps.some(s => !s.ok)) process.exitCode = 1;
} finally {
  await browser.close();
}
