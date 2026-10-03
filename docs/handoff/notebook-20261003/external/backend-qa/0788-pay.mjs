import { createRequire } from 'node:module';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

// Drives the Checkout Pro sandbox to an approved test payment. Mercado Pago's
// WAF rejects headless Chromium, so this runs headed. The card number, expiry
// and CVV live in PCI iframes, so every frame is inspected, not just the main
// document.
const INIT_POINT = process.argv[2];
const PROFILE = process.argv[3] || 'D:/1212/browser-temp/taba2-mp-pay';
const EMAIL = process.env.MP_PAYER_EMAIL || 'test_user_8681885244409960379@testuser.com';
const CARD = {
  number: process.env.MP_CARD || '5031755734530604',
  expiry: process.env.MP_EXPIRY || '11/30',
  cvv: process.env.MP_CVV || '123',
  name: process.env.MP_HOLDER || 'APRO',
  doc: process.env.MP_DOC || '12345678',
};

const EXTRACT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = [];
  for (const el of document.querySelectorAll('input')) {
    if (!visible(el) || el.type === 'hidden') continue;
    let labelText = '';
    if (el.id) { try { labelText = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText || ''; } catch (e) {} }
    if (!labelText) labelText = el.closest('label')?.innerText || '';
    if (!labelText) labelText = el.parentElement?.innerText || '';
    inputs.push({
      id: el.id || '', name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      label: (el.getAttribute('aria-label') || labelText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      value: el.value || '', type: el.type,
    });
  }
  return { url: location.href, inputs, text: (document.body?.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 900) };
})()`;

// Order matters: "Documento del titular" must not be classified as the holder
// name just because it contains "titular".
function classify(meta) {
  const hay = `${meta.label} ${meta.placeholder} ${meta.name} ${meta.id} ${meta.autocomplete}`.toLowerCase();
  if (/documento|dni|identification|docnumber|doc_number/.test(hay)) return 'doc';
  if (/n[uú]mero de (la )?tarjeta|cardnumber|card_number|cc-number|numero_tarjeta/.test(hay)) return 'number';
  if (/vencimiento|expir|mm\/a|cc-exp/.test(hay)) return 'expiry';
  if (/c[oó]digo de seguridad|cvv|csc|security|cod_seg/.test(hay)) return 'cvv';
  // Before the holder-name rule: Mercado Pago names the payer e-mail input
  // `cardholderEmail`, which the `cardholder` pattern would otherwise capture.
  if (/e-?mail|correo/.test(hay)) return 'email';
  if (/titular|nombre.*apellido|cardholder|cc-name|nombre/.test(hay)) return 'name';
  return null;
}

const VALUE = {
  number: CARD.number, expiry: CARD.expiry, cvv: CARD.cvv,
  name: CARD.name, doc: CARD.doc, email: EMAIL,
};

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1280, height: 950 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();
await page.goto(INIT_POINT, { waitUntil: 'domcontentloaded', timeout: 60000 });

let lastUrl = '';
let stagnant = 0;

for (let step = 1; step <= 16; step += 1) {
  await page.waitForTimeout(2600);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const frames = page.frames();
  const states = [];
  for (const frame of frames) {
    const state = await frame.evaluate(EXTRACT).catch(() => null);
    if (state && state.inputs.length) states.push({ frame, state });
  }
  const main = await page.evaluate(EXTRACT).catch(() => ({ text: '', url: page.url() }));

  console.log(`\n===== PASO ${step} =====`);
  console.log('URL:', page.url());
  console.log('TEXTO:', (main.text || '').replace(/\n/g, ' | ').slice(0, 420));
  for (const { frame, state } of states) {
    console.log(`  FRAME ${frame.url().slice(0, 90)}`);
    console.log('    inputs:', JSON.stringify(state.inputs.map((i) => ({
      l: i.label || i.placeholder || i.name || i.id, v: i.value ? '***' : '', k: classify(i),
    }))));
  }
  await page.screenshot({ path: `paso-${String(step).padStart(2, '0')}.png` }).catch(() => {});

  if (/congrats|resultado|pago\/|approved|rejected|pending/i.test(page.url()) && step > 1) {
    console.log('\n>>> PANTALLA DE RESULTADO');
    break;
  }

  // Fill every recognised, still-empty field in every frame.
  let filled = 0;
  for (const { frame, state } of states) {
    const handles = await frame.locator('input:visible').all().catch(() => []);
    for (let i = 0; i < handles.length && i < state.inputs.length; i += 1) {
      const meta = state.inputs[i];
      const kind = classify(meta);
      if (!kind || !VALUE[kind]) continue;
      // Plain fields are re-typed when they hold the wrong value; PCI iframe
      // fields report a masked value and are only ever filled once.
      const plain = kind === 'email' || kind === 'name' || kind === 'doc';
      if (meta.value && !(plain && meta.value !== VALUE[kind])) continue;
      await handles[i].click({ timeout: 4000 }).catch(() => {});
      await handles[i].fill('').catch(() => {});
      await handles[i].type(VALUE[kind], { delay: 70 }).catch(() => {});
      filled += 1;
      console.log(`  -> [${kind}] "${meta.label || meta.placeholder || meta.id}"`);
    }
  }
  if (filled) await page.waitForTimeout(1500);

  const text = main.text || '';

  // The installments screen has no submit button: the row itself is the action.
  if (/cuotas que quieras|elegí las cuotas|en cuántas cuotas/i.test(text)) {
    const row = page.locator('li:has-text("Una cuota"), [role=button]:has-text("Una cuota"), button:has-text("Una cuota"), div[tabindex]:has-text("Una cuota")').first();
    if (await row.count()) {
      console.log('  -> cuota 1x');
      await row.click({ timeout: 8000 }).catch(() => {});
      continue;
    }
    const clickables = await page.evaluate(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('li, button, [role=button], [tabindex], a')) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) continue;
        const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
        if (t) out.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', t: t.slice(0, 50) });
      }
      return out.slice(0, 25);
    })()`).catch(() => []);
    console.log('  CLICKABLES:', JSON.stringify(clickables));
  }

  if (/qu[eé]r[eé]s pagar/i.test(text)) {
    const option = page.locator('button:has-text("Tarjeta"), [role=button]:has-text("Tarjeta")').first();
    if (await option.count()) {
      console.log('  -> "Tarjeta"');
      await option.click({ timeout: 8000 }).catch(() => {});
      continue;
    }
  }

  for (const label of ['Pagar', 'Continuar', 'Confirmar', 'Siguiente', 'Aceptar']) {
    const button = page.locator(`button:has-text("${label}")`).first();
    if (await button.count() && !(await button.isDisabled().catch(() => true))) {
      console.log(`  -> click "${label}"`);
      await button.click({ timeout: 8000 }).catch(() => {});
      break;
    }
  }

  stagnant = page.url() === lastUrl && !filled ? stagnant + 1 : 0;
  lastUrl = page.url();
  if (stagnant >= 3) { console.log('  !! sin progreso, corto'); break; }
}

await page.waitForTimeout(5000);
const final = await page.evaluate(EXTRACT).catch(() => ({ text: '' }));
console.log('\n===== ESTADO FINAL =====');
console.log('URL:', page.url());
console.log('TEXTO:', (final.text || '').slice(0, 900));
await page.screenshot({ path: 'final.png', fullPage: true }).catch(() => {});
await context.close();
