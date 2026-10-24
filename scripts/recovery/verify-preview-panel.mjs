// Do the financial states the QA panel SHOWS match what the server says? READ ONLY.
//
//   node scripts/recovery/verify-preview-panel.mjs [--origin https://recovery-20261020.taba2-staging.pages.dev] \
//        [--expect-runtime la-taba-runtime-v158-financial-integrity] [--evidence file.json]
//
// The QA owner (test identity from Windows Credential Manager, typed by the browser automation into La Taba's own
// login form — never into Mercado Pago) opens Pagos in a real headless Chromium. The script captures the answer of
// the panel's own `list_business_payments` call and the console's pipeline health, compares every row's state with
// what the page renders (label for the state the console derives from the same fields), checks the service worker
// the page registered and the caches it holds, and reports. It clicks nothing that writes, refunds or cancels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { classifyBusinessPayment } from '../../js/business/business-payments-console.js';
import { passPreviewGate } from './preview-gate-login.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const origin = new URL(arg('--origin', 'https://recovery-20261020.taba2-staging.pages.dev')).origin;
assert.match(origin, /^https:\/\/[a-z0-9-]+\.taba2-staging\.pages\.dev$/, 'QA previews only');
const expectRuntime = arg('--expect-runtime');
const owner = leerSecreto('RECOVERY QA OWNER A');
assert.ok(owner?.usuario && owner?.secreto, 'QA owner credential unavailable');
const gate = leerSecreto('RECOVERY PREVIEW ACCESS');

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({
  viewport: { width: 1100, height: 900 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
  ...(gate?.usuario && gate?.secreto ? { httpCredentials: { username: gate.usuario, password: gate.secreto, origin } } : {}),
});
// The gate answers a navigation without access with its own login form: open the session first, in another tab.
await passPreviewGate(context, origin, gate);
const page = await context.newPage();
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160)); });
page.on('pageerror', error => consoleErrors.push('pageerror: ' + String(error.message).slice(0, 160)));
const dialogs = [];
page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
const paymentCalls = [];
page.on('response', async response => {
  if (/\/rest\/v1\/rpc\/list_business_payments/.test(response.url()) && response.ok()) {
    try { paymentCalls.push(await response.json()); } catch (_) { /* not JSON */ }
  }
});
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const evidence = { origin, at: new Date().toISOString() };

try {
  await page.goto(`${origin}/#business`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const form = page.locator('[data-production-auth-form="business"]');
  await form.waitFor({ state: 'visible', timeout: 45000 });
  await form.locator('input[name="email"]').fill(owner.usuario);
  await form.locator('input[name="password"]').fill(owner.secreto);
  await form.locator('button[type="submit"]').click();
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 60000 });
  check('panel login with the QA owner', true);

  // The page the user is running: its version and the service worker it registered.
  const served = await page.evaluate(async () => {
    const version = await fetch('/version.json', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
    const registration = await navigator.serviceWorker?.getRegistration();
    const worker = registration?.active || registration?.waiting || registration?.installing || null;
    const caches_ = await caches.keys();
    return { version, workerState: worker?.state ?? null, workerScript: worker?.scriptURL ?? null, caches: caches_ };
  });
  evidence.served = served;
  check('version.json is served', Boolean(served.version?.commit), `${served.version?.commit} ${served.version?.runtime}`);
  if (expectRuntime) check('the runtime is the expected one', served.version?.runtime === expectRuntime, served.version?.runtime);

  await page.locator('[data-business-ops-view="payments"]').first().click({ timeout: 30000 });
  // Pagos has two lists: «Cobros manuales» (cash/transfer) and the Mercado Pago one, the only live region.
  const onlineList = page.locator('.production-payment-list[aria-live="polite"]');
  await onlineList.waitFor({ state: 'visible', timeout: 60000 });
  check('cash and transfer collections are on the same screen', await page.locator('section[aria-label="Cobros manuales"]').isVisible());
  for (let i = 0; i < 20 && !paymentCalls.length; i += 1) await page.waitForTimeout(500);
  check('the panel asked the server for the payments', paymentCalls.length > 0);
  const rows = Array.isArray(paymentCalls.at(-1)) ? paymentCalls.at(-1) : (paymentCalls.at(-1)?.payments ?? []);
  // The answer arrives before the repaint: judge the list once it stopped saying it is searching (or 15 s passed).
  await page.waitForFunction(() => !/Buscando los pagos/.test(document.querySelector('.production-payment-list[aria-live="polite"]')?.innerText || ''),
    null, { timeout: 15000 }).catch(() => {});
  const text = await onlineList.innerText();
  const counter = (await page.locator('.operation-center-toolbar .form-hint').first().innerText().catch(() => '')).trim();
  evidence.server = { rows: rows.length, states: rows.map(row => ({ internal_status: row.internal_status, financial_hold: row.financial_hold ?? null, needs_attention: row.needs_attention ?? null, open_discrepancies: row.open_discrepancies ?? 0 })) };
  check('the listed count equals the server rows', counter.includes(`${rows.length} pago(s)`), `${counter} / server ${rows.length}`);
  if (!rows.length) {
    check('an empty list says so instead of inventing payments', /Todavía no hay pagos/.test(text), text.slice(0, 120));
  } else {
    for (const row of rows) {
      const shown = classifyBusinessPayment(row);
      check(`payment ${row.order_public_code || row.internal_status}: the card shows "${shown.label}"`, text.includes(shown.label), `status=${row.internal_status} hold=${row.financial_hold ?? '-'}`);
    }
    // Misma regla que el Panel (classifyBusinessPayment): una devolución YA registrada (`refund_registered`,
    // `money_returned`) es un hecho cerrado, no dinero sin resolver. Contar cualquier retención como «sin resolver»
    // hacía fallar esta verificación con el reembolso conciliado de LT-0087 (24/10).
    const unresolved = rows.filter(row => classifyBusinessPayment(row).state === 'money-unresolved');
    if (unresolved.length) check('unresolved money is shown as such', text.includes('Dinero sin resolver'));
    else check('no unresolved-money banner without an unresolved fact', !text.includes('Dinero sin resolver'));
  }
  await page.screenshot({ path: arg('--screenshot', 'preview-panel-payments.png'), fullPage: false });
  check('no browser dialogs were opened', dialogs.length === 0);
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('verification ran to the end', false, String(error.message).slice(0, 200));
} finally {
  await browser.close();
}
evidence.checks = checks;
evidence.passed = checks.every(item => item.ok);
if (arg('--evidence')) fs.writeFileSync(arg('--evidence'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ passed: evidence.passed, checks: checks.length, failed: checks.filter(item => !item.ok).map(item => item.name) }));
if (!evidence.passed) process.exitCode = 1;
