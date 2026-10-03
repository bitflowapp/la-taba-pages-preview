import { createRequire } from 'node:module';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { webkit, devices } = require('playwright');

// Full purchase from an iPhone-shaped WebKit context, in ONE browser session:
// the redirect to Mercado Pago and the return to /pago/resultado must share the
// same origin storage, which is exactly what the shopper's Safari will do.
const PRODUCT = process.env.QA_PRODUCT_ID || '882c6108-468e-44a2-bfed-d74e8009300f';
const SITE = 'https://taba2-staging.pages.dev/';
const PROFILE_NAME = process.env.QA_NAME || 'QA MP iPhone';
const PROFILE_PHONE = process.env.QA_PHONE || '299 400 0002';
const EMAIL = process.env.MP_PAYER_EMAIL || 'test_user_8681885244409960379@testuser.com';
const CARD = { number: '5031755734530604', expiry: '11/30', cvv: '123', name: 'APRO', doc: '12345678' };

const device = devices['iPhone 14'] || devices['iPhone 13'] || devices['iPhone 12'];
const browser = await webkit.launch({ headless: false });
const context = await browser.newContext({ ...device, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
const page = await context.newPage();

const log = (...a) => console.log(...a);
const text = async () => (await page.evaluate('(document.body?.innerText||"").replace(/\\s+/g," ")').catch(() => '')) || '';
const shot = async (n) => { await page.screenshot({ path: `iphone-${n}.png` }).catch(() => {}); };

function classify(meta) {
  const hay = `${meta.label} ${meta.placeholder} ${meta.name} ${meta.id} ${meta.autocomplete}`.toLowerCase();
  if (/documento|dni|identification|docnumber/.test(hay)) return 'doc';
  if (/n[uú]mero de (la )?tarjeta|cardnumber|card_number|cc-number/.test(hay)) return 'number';
  if (/vencimiento|expir|mm\/a|cc-exp/.test(hay)) return 'expiry';
  if (/c[oó]digo de seguridad|cvv|csc|security/.test(hay)) return 'cvv';
  if (/e-?mail|correo/.test(hay)) return 'email';
  if (/titular|nombre.*apellido|cardholder|cc-name|nombre/.test(hay)) return 'name';
  return null;
}
const VALUE = { number: CARD.number, expiry: CARD.expiry, cvv: CARD.cvv, name: CARD.name, doc: CARD.doc, email: EMAIL };
const EXTRACT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = [];
  for (const el of document.querySelectorAll('input')) {
    if (!vis(el) || el.type === 'hidden') continue;
    let lab = '';
    if (el.id) { try { lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.innerText || ''; } catch (e) {} }
    if (!lab) lab = el.closest('label')?.innerText || el.parentElement?.innerText || '';
    inputs.push({ id: el.id || '', name: el.getAttribute('name') || '', placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '', label: (el.getAttribute('aria-label') || lab || '').replace(/\\s+/g,' ').trim().slice(0,70),
      value: el.value || '' });
  }
  return inputs;
})()`;

// ---- 1. perfil y direccion -------------------------------------------------
log('\n[1] perfil y direccion');
await page.goto(`${SITE}#profile`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
if (/Todavía no cargaste tus datos|Completar datos/.test(await text())) {
  await page.locator(':is(button,a):has-text("Completar datos")').first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.locator('input[name=profileFullName]').fill(PROFILE_NAME).catch(() => {});
  await page.locator('input[name=profilePhone]').fill(PROFILE_PHONE).catch(() => {});
  await page.locator('button:has-text("Guardar")').first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(5000);
  log('   perfil guardado');
}
if (/Todavía no tenés direcciones/.test(await text())) {
  await page.locator(':is(button,a):has-text("Agregar nueva dirección")').first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.locator('input[name=profileAddressStreet]').fill('Calle QA iPhone').catch(() => {});
  await page.locator('input[name=profileAddressNumber]').fill('742').catch(() => {});
  await page.locator('input[name=profileAddressCity]').fill('Neuquen').catch(() => {});
  await page.locator('input[name=profileAddressProvince]').fill('Neuquen').catch(() => {});
  await page.locator('button:has-text("Guardar dirección")').first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(5500);
  log('   direccion guardada');
}
await shot('01-perfil');

// ---- 2. carrito ------------------------------------------------------------
log('[2] agregar producto QA');
await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
const added = await page.evaluate(`(() => { const b = document.querySelector('[data-add-product="${PRODUCT}"]'); if (!b) return 'no esta el producto'; b.click(); return 'ok'; })()`);
log('   agregar:', added);
await page.waitForTimeout(2500);
await page.evaluate(`document.querySelector('[data-open-cart]').click()`).catch(() => {});
await page.waitForTimeout(4500);
await shot('02-carrito');
const cartText = await text();
log('   total en carrito:', (/Total \$ ?[\d.]+/.exec(cartText) || ['(no visible)'])[0]);

// ---- 3. medio de pago y confirmacion --------------------------------------
log('[3] Mercado Pago y confirmar');
await page.evaluate(`(() => { const s = document.querySelector('select[name=paymentMethod]'); s.value = 'mercadopago'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`).catch(() => {});
await page.waitForTimeout(2500);
await page.locator('button:has-text("Confirmar pedido")').first().click({ timeout: 20000 }).catch((e) => log('   confirmar fallo:', String(e).slice(0, 80)));
await page.waitForTimeout(20000);
log('   url tras confirmar:', page.url().slice(0, 110));
await shot('03-redirect');

// ---- 4. Checkout Pro -------------------------------------------------------
log('[4] Checkout Pro');
for (let step = 1; step <= 14; step += 1) {
  await page.waitForTimeout(2800);
  const t = await text();
  const url = page.url();
  if (/taba2-staging\.pages\.dev/.test(url) && step > 1) { log('   volvio a TABA2'); break; }
  log(`   paso ${step}: ${t.slice(0, 130)}`);

  let filled = 0;
  for (const frame of page.frames()) {
    const metas = await frame.evaluate(EXTRACT).catch(() => null);
    if (!metas || !metas.length) continue;
    const handles = await frame.locator('input:visible').all().catch(() => []);
    for (let i = 0; i < handles.length && i < metas.length; i += 1) {
      const meta = metas[i];
      const kind = classify(meta);
      if (!kind || !VALUE[kind]) continue;
      // Never retype a field that already holds something: Mercado Pago
      // reformats the document and card inputs, so comparing against the
      // intended value would retype forever and corrupt them.
      if (meta.value) continue;
      await handles[i].click({ timeout: 4000 }).catch(() => {});
      await handles[i].fill('').catch(() => {});
      await handles[i].type(VALUE[kind], { delay: 60 }).catch(() => {});
      filled += 1;
      log(`      -> ${kind}`);
    }
  }
  // The holder name and document live in the main document, where matching by
  // index against a separately-built metadata list is fragile in WebKit. Fill
  // them by their visible label instead.
  for (const [pattern, value] of [[/Nombre del titular/i, CARD.name], [/Documento del titular/i, CARD.doc]]) {
    const field = page.getByLabel(pattern).first();
    if (!(await field.count().catch(() => 0))) continue;
    const current = await field.inputValue().catch(() => 'x');
    if (current) continue;
    await field.fill(value).catch(() => {});
    filled += 1;
    log(`      -> ${pattern.source.split(' ')[0].replace(/\W/g, '')} (por etiqueta)`);
  }
  if (filled) { await page.waitForTimeout(1500); }

  if (/qu[eé]r[eé]s pagar/i.test(t)) {
    await page.locator(':is(button,[role=button]):has-text("Tarjeta")').first().click({ timeout: 10000 }).catch(() => {});
    continue;
  }
  if (/cuotas que quieras|en cu[áa]ntas cuotas/i.test(t)) {
    await page.locator(':is(li,button,[role=button],div[tabindex]):has-text("Una cuota")').first().click({ timeout: 10000 }).catch(() => {});
    continue;
  }
  for (const label of ['Pagar', 'Continuar', 'Confirmar']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count() && !(await b.isDisabled().catch(() => true))) {
      log(`      click "${label}"`);
      await b.click({ timeout: 10000 }).catch(() => {});
      break;
    }
  }
}
await shot('04-checkout');

// ---- 5. retorno y confirmacion --------------------------------------------
log('[5] retorno a TABA2');
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(4000);
  const t = await text();
  const url = page.url();
  if (/pago\/resultado/.test(url)) log(`   [${i}] ${t.slice(0, 160)}`);
  if (/Pedido confirmado/.test(t)) { log('\n>>> PEDIDO CONFIRMADO EN PANTALLA'); break; }
  if (/Pago rechazado|revisar este pago/.test(t)) { log('\n>>> ESTADO NO FELIZ'); break; }
}
await shot('05-resultado');
log('URL final:', page.url());
log('TEXTO final:', (await text()).slice(0, 400));
await context.close();
await browser.close();
