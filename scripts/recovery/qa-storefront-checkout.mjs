// A real buyer journey in a real browser against the hosted QA preview: catalog → add → cart → pickup → buyer
// details → payment method → confirm. With --method mercadopago the redirect to Mercado Pago's Checkout Pro is
// intercepted and the init_point is printed for the person who will pay with OFFICIAL TEST cards in their own
// browser; this script never opens or fills Mercado Pago pages. With --method cash the order is created and the
// tracking code is printed. Each run is a fresh anonymous buyer (new browser context).
//   node scripts/recovery/qa-storefront-checkout.mjs --method mercadopago|cash [--origin …] [--width 390] [--qty 1]
//        [--product "QA Producto de prueba 1"] [--evidence file.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { passPreviewGate } from './preview-gate-login.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const origin = new URL(arg('--origin', 'https://recovery-20261020.taba2-staging.pages.dev')).origin;
assert.match(origin, /^https:\/\/[a-z0-9-]+\.taba2-staging\.pages\.dev$/, 'QA previews only');
const method = arg('--method', 'mercadopago');
assert.ok(['mercadopago', 'cash'].includes(method));
const width = Number(arg('--width', '390'));
const productName = arg('--product', 'QA Producto de prueba 1');
const quantity = Math.max(1, Number(arg('--qty', '1')));
const gate = leerSecreto('RECOVERY PREVIEW ACCESS');

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const context = await browser.newContext({
  viewport: { width, height: 844 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', isMobile: width < 700,
  ...(gate?.usuario && gate?.secreto ? { httpCredentials: { username: gate.usuario, password: gate.secreto, origin } } : {}),
});
// The gate answers a navigation without access with its own login form: open the session first, in another tab.
await passPreviewGate(context, origin, gate);
const page = await context.newPage();
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)); });
// Which request a console 401/4xx belongs to: host kind and path only (no query, no token).
const failedRequests = [];
page.on('response', response => {
  if (response.status() < 400) return;
  const url = new URL(response.url());
  failedRequests.push(`${response.status()} ${response.request().method()} ${url.host.endsWith('supabase.co') ? 'supabase' : url.host === new URL(origin).host ? 'preview' : url.host}${url.pathname}`);
});
const dialogs = [];
page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
let initPoint = '';
let orderCode = null;
await page.route(/^https:\/\/(?:www\.)?mercadopago\.com(?:\.ar)?\/checkout\//, route => { initPoint = route.request().url(); return route.abort(); });
const steps = [];
const step = (name, ok, detail = '') => { steps.push({ name, ok: Boolean(ok), detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const started = Date.now();
try {
  await page.goto(`${origin}/#catalog`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const card = page.locator('[data-view="catalog"] article, [data-view="catalog"] [data-product-card]').filter({ hasText: productName }).first();
  await card.waitFor({ state: 'visible', timeout: 45000 });
  step('catalog shows the QA product', true, `${Date.now() - started} ms`);
  for (let i = 0; i < quantity; i += 1) {
    const add = card.locator('[data-add-product]:not([disabled]), [data-cart-increase]:not([disabled])').first();
    await add.click({ timeout: 15000 });
    await page.waitForTimeout(300);
  }
  await page.locator('[data-open-cart]:visible').first().click();
  await page.locator('[data-checkout-form]').waitFor({ state: 'visible', timeout: 20000 });
  step('cart and checkout form open', true);
  const pickup = page.getByLabel('Retiro en local');
  if (await pickup.count()) await pickup.check();
  const identity = page.locator('[data-profile-identity-form]');
  if (await identity.isVisible().catch(() => false)) {
    await identity.locator('[name="checkoutIdentityName"]').fill('QA Comprador');
    await identity.locator('[name="checkoutIdentityPhone"]').fill('299 555 0811');
    await identity.locator('[data-profile-checkout-action="save-identity"]').click();
    await page.locator('[data-profile-summary] [data-profile-name]').waitFor({ state: 'visible', timeout: 20000 });
  }
  step('buyer details saved (anonymous session created on demand)', true);
  const select = page.locator('[name="paymentMethod"]');
  if (method === 'mercadopago') {
    await page.waitForFunction(() => document.querySelector('[name="paymentMethod"]')?.getAttribute('data-mercadopago-available') === 'true',
      null, { timeout: 30000 }).catch(() => {});
    const available = await select.getAttribute('data-mercadopago-available');
    step('Mercado Pago offered by the server', available === 'true', `data-mercadopago-available=${available}`);
    if (available !== 'true') throw new Error('Mercado Pago not available for this business');
    await select.selectOption('mercadopago');
  } else {
    const options = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    const cash = options.find(value => /cash|efectivo/.test(value)) || options[0];
    await select.selectOption(cash);
  }
  const help = await page.locator('[data-payment-help]').innerText().catch(() => '');
  const submit = page.locator('[data-checkout-submit]');
  const submitLabel = (await submit.innerText()).replace(/\s+/g, ' ').trim();
  step('submit label matches the method', method === 'mercadopago' ? /Mercado Pago/i.test(submitLabel) : !/Mercado Pago/i.test(submitLabel), submitLabel);
  await submit.click();
  // A second tap while the first is in flight must not create a second purchase.
  await submit.click({ timeout: 1500 }).catch(() => {});
  if (method === 'mercadopago') {
    for (let i = 0; i < 60 && !initPoint; i += 1) await page.waitForTimeout(500);
    step('redirect to the official Checkout Pro', /mercadopago\.com(\.ar)?\/checkout\//.test(initPoint), initPoint ? new URL(initPoint).host : 'none');
  } else {
    await page.getByText(/Tu pedido fue confirmado|Pedido creado/i).first().waitFor({ state: 'visible', timeout: 30000 });
    const code = (await page.getByText(/Pedido LT-\d+/).first().innerText().catch(() => '')).match(/LT-\d+/)?.[0] || null;
    step('cash order confirmed by the server', true, code || '');
    orderCode = code;
  }
  const record = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (/mercadopago-checkout|order|tracking/i.test(key)) out[key] = localStorage.getItem(key)?.slice(0, 400);
    }
    return out;
  });
  const checkoutSessionId = Object.values(record).map(value => { try { return JSON.parse(value)?.checkoutSessionId; } catch { return null; } }).find(Boolean) || null;
  const horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  step('no horizontal scroll', !horizontalScroll, `width=${width}`);
  step('no browser dialogs', dialogs.length === 0, dialogs.join(','));
  const result = { at: new Date().toISOString(), origin, width, method, quantity, paymentHelp: help, submitLabel,
    checkout_session_id: checkoutSessionId, order_code: orderCode, init_point: initPoint || null, steps, consoleErrors: consoleErrors.slice(0, 10),
    failedRequests: failedRequests.slice(0, 10),
    durationMs: Date.now() - started };
  if (arg('--evidence')) fs.writeFileSync(arg('--evidence'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
  if (steps.some(s => !s.ok)) process.exitCode = 1;
} catch (error) {
  const screenshot = arg('--screenshot');
  if (screenshot) await page.screenshot({ path: screenshot }).catch(() => {});
  console.log(JSON.stringify({ failed: String(error.message || error).slice(0, 300), steps, consoleErrors: consoleErrors.slice(0, 10),
    failedRequests: failedRequests.slice(0, 10) }, null, 1));
  process.exitCode = 1;
} finally {
  await browser.close();
}
