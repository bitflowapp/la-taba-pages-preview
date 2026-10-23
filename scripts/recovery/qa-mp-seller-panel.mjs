// Local, isolated Chrome controller for the QA test SELLER (3594962708) in Mercado Pago Developers. That test user
// owns TestApp-ae01fd1d (4861627125869370), the automatic test mirror of the TABA2 Staging application: the only
// integrator application whose owner is a test user, as Checkout Pro OAuth tests require.
// Commands on stdin carry action names only. Credentials stay in OS storage and memory: page text is redacted
// before it is recorded, and a secret shown by the panel goes straight to Windows Credential Manager.
import { chromium } from 'playwright';
import { guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { createInterface } from 'node:readline';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const seller = JSON.parse(leerSecreto('RECOVERY MP TEST SELLER')?.secreto || '{}');
if (seller.id !== '3594962708' || seller.profile !== 'seller' || !seller.password || !seller.nickname) throw Error('QA_SELLER_REQUIRED');
const token = leerSecreto('RECOVERY MP TEST ACCESS TOKEN')?.secreto;
const official = await (await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` } })).json();
if (String(official.id) !== seller.id || official.site_id !== 'MLA' || !official.tags?.includes('test_user')) throw Error('OFFICIAL_SELLER_MISMATCH');
const runName = process.env.QA_MP_EVIDENCE_DIR || 'la-taba-mp-integrator-20261023';
if (!/^[a-z0-9-]+$/.test(runName)) throw Error('EVIDENCE_DIR_NAME_ONLY');
const dir = path.join(os.tmpdir(), runName);
mkdirSync(dir, { recursive: true });
const evidence = path.join(dir, 'seller-panel.jsonl');
// Client secrets (32 alphanumerics), webhook secrets (64 hex) and tokens never reach the log. Client IDs (16 digits) do.
const redact = (s) => String(s).split(seller.password).join('[REDACTADO]').split(seller.nickname).join('[VENDEDOR_QA]')
  .replace(/TESTUSER\w+/gi, '[USUARIO_QA]').replace(/(?:APP_USR|TEST)-[\w-]+/g, '[CREDENCIAL]')
  .replace(/\b[A-Za-z0-9]{20,}\b/g, '[SECRETO]').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]');
const record = (obj) => {
  const row = { at: new Date().toISOString(), ...obj };
  appendFileSync(evidence, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
};
// Only these two secrets may be stored, under these names, bound to the test application.
const STORABLE = {
  client_secret: { name: 'RECOVERY MP TESTAPP CLIENT SECRET', shape: /^[A-Za-z0-9]{20,64}$/ },
  webhook_secret: { name: 'RECOVERY MP TESTAPP WEBHOOK SECRET', shape: /^[A-Za-z0-9]{32,128}$/ },
};
// The QA webhook and callback, also without the scheme: the panel shows a fixed «https://» before its URL fields.
const ALLOWED_VALUES = new Set([
  'https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-webhook',
  'https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback',
  'ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-webhook',
  'ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback',
]);

const browser = await chromium.launch({ executablePath: process.env.QA_CHROME_PATH || path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), headless: false });
const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const target = (c) => (c.frame === undefined ? page : page.frames()[c.frame]);
async function state() {
  return { kind: 'state', url: page.url().split('?')[0], text: redact(await page.locator('body').innerText()).slice(0, 6000),
    buttons: (await page.getByRole('button').allTextContents()).map(redact).slice(0, 60),
    inputs: await page.locator('input:not([type="hidden"])').evaluateAll((es) => es.map((e) => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, readOnly: e.readOnly, length: String(e.value || '').length }))),
    aria: redact(await page.locator('body').ariaSnapshot()).slice(0, 9000) };
}
async function command(c) {
  if (c.action === 'state') return state();
  if (c.action === 'goto') {
    const u = new URL(c.url);
    if (u.protocol !== 'https:' || u.host !== 'www.mercadopago.com.ar') throw Error('OFFICIAL_MP_AR_ONLY');
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (c.action === 'consent') {
    // Only the single-use authorization URL of the QA integrator, returning to the QA callback.
    const u = new URL(c.url);
    if (!['https://auth.mercadopago.com.ar', 'https://auth.mercadopago.com'].includes(u.origin) || u.pathname !== '/authorization' ||
      u.searchParams.get('client_id') !== '4861627125869370' || u.searchParams.get('code_challenge_method') !== 'S256' ||
      u.searchParams.get('redirect_uri') !== 'https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback') {
      throw Error('QA_AUTHORIZATION_URL_ONLY');
    }
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (c.action === 'login') {
    await page.getByRole('textbox', { name: /DNI, e-mail o teléfono/i }).fill(seller.nickname);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  } else if (c.action === 'password') {
    await page.locator('#password').fill(seller.password);
  } else if (c.action === 'click') {
    await target(c).getByRole(c.role || 'button', { name: c.name, exact: c.exact !== false }).first().click();
  } else if (c.action === 'click-css') {
    // For unlabelled controls (the «show» toggle next to a masked secret).
    await target(c).locator(c.selector).first().click();
  } else if (c.action === 'text-click') {
    await target(c).getByText(c.text, { exact: c.exact !== false }).first().click();
  } else if (c.action === 'fill') {
    if (!ALLOWED_VALUES.has(c.value)) throw Error('ALLOWED_VALUE_ONLY');
    await target(c).locator(c.selector).fill(c.value);
  } else if (c.action === 'check') {
    await target(c).getByRole(c.role || 'checkbox', { name: c.name, exact: c.exact !== false }).first().check();
  } else if (c.action === 'store-secret') {
    // Reads the value or text of one element and stores it; nothing about it is printed except its length.
    const spec = STORABLE[c.kind];
    if (!spec) throw Error('UNKNOWN_SECRET_KIND');
    const element = target(c).locator(c.selector).first();
    const value = String(await element.evaluate((e) => ('value' in e && e.value) ? e.value : e.textContent || '')).trim();
    if (!spec.shape.test(value)) throw Error(`SECRET_SHAPE_MISMATCH:${value.length}`);
    guardarSecreto(spec.name, '4861627125869370', value);
    return { kind: 'secret_stored', name: spec.name, length: value.length };
  } else if (c.action === 'probe') {
    // Structure only: tag, attribute names, value length and character class, nearby buttons. Never a value.
    const found = await target(c).locator(c.selector).evaluateAll((elements) => elements.slice(0, 5).map((e) => {
      const value = String(('value' in e ? e.value : '') || e.textContent || '');
      const kind = /^[0-9a-f]+$/i.test(value) ? 'hex' : /^[A-Za-z0-9]+$/.test(value) ? 'alnum' : /^[•*·]+$/.test(value) ? 'mask' : 'other';
      const box = e.closest('div')?.parentElement;
      const safe = Object.fromEntries(['aria-label', 'aria-pressed', 'class', 'data-andes-textfield-input-type', 'title', 'role']
        .filter((name) => e.hasAttribute(name)).map((name) => [name, e.getAttribute(name).slice(0, 160)]));
      return { tag: e.tagName, type: e.getAttribute('type'), attributes: e.getAttributeNames(), safe, disabled: e.disabled === true,
        valueLength: value.length, valueKind: kind,
        buttons: box ? [...box.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent?.trim() || '(sin nombre)').slice(0, 10) : [] };
    }));
    return { kind: 'probe', selector: c.selector, found: found.map((f) => ({ ...f, buttons: f.buttons.map(redact) })) };
  } else if (c.action === 'read-text') {
    // Redacted visible text of one region (the panel's snapshot is cut at 9 kB, which hides side drawers).
    const text = await target(c).locator(c.selector).first().innerText();
    return { kind: 'text', selector: c.selector, text: redact(text).slice(0, 3500) };
  } else if (c.action === 'close') {
    await browser.close(); process.exit(0);
  } else throw Error('UNKNOWN_ACTION');
  return state();
}
record({ kind: 'ready', browser: browser.version(), sellerId: seller.id, evidence });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try { record(await command(JSON.parse(line))); } catch (e) { record({ kind: 'error', message: redact(e.message).slice(0, 1500) }); }
}
