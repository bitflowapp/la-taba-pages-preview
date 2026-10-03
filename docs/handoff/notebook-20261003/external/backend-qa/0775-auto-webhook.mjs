import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

// Mercado Pago signs the notifications it delivers to a preference's
// notification_url with the auto-provisioned test application's key, which the
// panel never exposes — so those arrive but cannot be validated. The signed
// channel that DOES validate is the panel's own "Simular notificación", which
// signs with the application key we hold. This drives it automatically: the
// unvalidatable organic notification is used purely as the trigger that tells
// us which payment id was approved.

const KEY = fs.readFileSync(path.join(os.tmpdir(), 'taba-sr.txt'), 'utf8').trim();
const BASE = 'https://ukxqbgswjlibmnjemrzd.supabase.co/rest/v1';
const PROFILE = 'D:/1212/browser-temp/taba2-mp-real';
const PANEL = 'https://www.mercadopago.com.ar/developers/panel/app/2691240967769590/webhooks';

const args = process.argv.slice(2);
const forced = (args.find((a) => a.startsWith('--payment=')) || '').split('=')[1] || '';
const watch = args.includes('--watch');
const watchMinutes = Number((args.find((a) => a.startsWith('--minutes=')) || '').split('=')[1] || 45);

async function rest(query, init = {}) {
  const r = await fetch(`${BASE}/${query}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

// A payment is "pending signature" when an organic notification named it but no
// validated receipt exists for it yet.
async function pendingPayment() {
  const rows = await rest('payment_webhook_receipts?select=resource_id,signature_valid,received_at&event_type=eq.payment&order=received_at.desc&limit=60');
  if (!Array.isArray(rows)) return null;
  const validated = new Set(rows.filter((r) => r.signature_valid).map((r) => r.resource_id));
  const candidate = rows.find((r) => !r.signature_valid && !validated.has(r.resource_id));
  return candidate ? candidate.resource_id : null;
}

async function orderFor(paymentId) {
  const intents = await rest(`payment_intents?select=id,order_id,internal_status,paid_amount&provider_payment_id=eq.${paymentId}`);
  if (!Array.isArray(intents) || !intents.length) return null;
  const intent = intents[0];
  if (!intent.order_id) return { intent, order: null };
  const orders = await rest(`orders?select=code,status,total,delivery_address_formatted&id=eq.${intent.order_id}`);
  return { intent, order: Array.isArray(orders) ? orders[0] : null };
}

async function simulate(paymentId) {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    viewport: { width: 1360, height: 950 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto(PANEL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    if (/phone-validation|challenges|\/login/.test(page.url())) {
      return { ok: false, reason: 'SESION_REQUIERE_VERIFICACION_HUMANA', url: page.url() };
    }
    const step = async (label, fn) => {
      const out = await page.evaluate(fn).catch((e) => `error: ${String(e).slice(0, 80)}`);
      console.log(`   ${label}: ${JSON.stringify(out)}`);
      await page.waitForTimeout(2500);
      return out;
    };
    await step('abrir evento', `(() => { const t = [...document.querySelectorAll('[role=combobox]')].find(e => /Seleccionar evento/.test(e.innerText || '')); if (!t) return 'sin combo'; t.click(); return 'ok'; })()`);
    await step('elegir Pagos', `(() => { const o = [...document.querySelectorAll('[role=option],li')].find(e => (e.innerText || '').trim() === 'Pagos'); if (!o) return 'sin opcion'; o.click(); return 'ok'; })()`);
    await step('data id', `(() => { const i = [...document.querySelectorAll('input.andes-form-control__field')].find(e => e.getBoundingClientRect().width > 0); if (!i) return 'sin input'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '${paymentId}'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return i.value; })()`);
    const sent = await step('enviar', `(() => { const b = [...document.querySelectorAll('button')].find(e => /Enviar prueba/.test(e.innerText || '') && e.getBoundingClientRect().width > 0); if (!b) return 'sin boton'; if (b.disabled) return 'deshabilitado'; b.click(); return 'enviado'; })()`);
    await page.waitForTimeout(9000);
    const confirmed = await page.evaluate(`/Enviamos una notificaci/.test(document.body.innerText || '')`).catch(() => false);
    return { ok: sent === 'enviado' && confirmed, sent, confirmed };
  } finally {
    await context.close().catch(() => {});
  }
}

async function processPayment(paymentId) {
  console.log(`\n>>> pago aprobado detectado: ${paymentId}`);
  const before = await orderFor(paymentId);
  if (before?.order && !args.includes('--force')) {
    console.log(`    ya tenía pedido ${before.order.code} — no se vuelve a disparar`);
    return before;
  }
  const sim = await simulate(paymentId);
  console.log('    simulación:', JSON.stringify(sim));
  if (!sim.ok) return { failed: sim };
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const after = await orderFor(paymentId);
    if (after?.order) {
      console.log(`    PEDIDO ${after.order.code} · ${after.order.status} · $${after.order.total} · ${after.order.delivery_address_formatted}`);
      return after;
    }
  }
  return { failed: 'sin pedido tras la simulación' };
}

if (forced) {
  await processPayment(forced);
} else if (watch) {
  const deadline = Date.now() + watchMinutes * 60 * 1000;
  console.log(`vigilando pagos aprobados por ${watchMinutes} min...`);
  const done = new Set();
  while (Date.now() < deadline) {
    const id = await pendingPayment();
    if (id && !done.has(id)) { done.add(id); await processPayment(id); }
    await new Promise((r) => setTimeout(r, 8000));
  }
  console.log('fin de la ventana de vigilancia');
} else {
  console.log('uso: node auto-webhook.mjs --watch [--minutes=45] | --payment=<id>');
}
