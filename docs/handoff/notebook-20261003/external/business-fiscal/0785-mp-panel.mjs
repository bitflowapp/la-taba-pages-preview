import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

// Drives the Mercado Pago developer panel with a *test user* account, so no
// real account is ever touched. Headed, because the WAF rejects headless.
const PROFILE = process.env.MP_PROFILE || 'D:/1212/browser-temp/taba2-mp-panel';
const EMAIL = process.env.MP_LOGIN_EMAIL;
const PASSWORD = process.env.MP_LOGIN_PASSWORD;
const START = process.argv[2] || 'https://www.mercadopago.com.ar/developers/panel/app';
const STEPS = Number(process.argv[3] || 12);

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1360, height: 950 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();

const EXTRACT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = [];
  for (const el of document.querySelectorAll('input')) {
    if (!visible(el) || el.type === 'hidden') continue;
    inputs.push({ id: el.id || '', name: el.getAttribute('name') || '', type: el.type,
      placeholder: el.getAttribute('placeholder') || '',
      label: (el.getAttribute('aria-label') || el.closest('label')?.innerText || el.parentElement?.innerText || '').replace(/\\s+/g,' ').trim().slice(0,60),
      filled: Boolean(el.value) });
  }
  const buttons = [];
  for (const el of document.querySelectorAll('button, [role=button], a.andes-button, input[type=submit]')) {
    if (!visible(el)) continue;
    const t = (el.innerText || el.getAttribute('aria-label') || el.value || '').replace(/\\s+/g,' ').trim();
    if (t) buttons.push(t.slice(0, 50));
  }
  return { url: location.href, title: document.title,
    text: (document.body?.innerText || '').replace(/\\n{2,}/g,'\\n').slice(0, 1400),
    inputs, buttons: [...new Set(buttons)].slice(0, 25) };
})()`;

await page.goto(START, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

for (let step = 1; step <= STEPS; step += 1) {
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const s = await page.evaluate(EXTRACT).catch(() => ({ url: page.url(), text: '', inputs: [], buttons: [] }));
  console.log(`\n===== PASO ${step} =====`);
  console.log('URL:', s.url);
  console.log('TEXTO:', (s.text || '').replace(/\n/g, ' | ').slice(0, 500));
  console.log('INPUTS:', JSON.stringify(s.inputs));
  console.log('BOTONES:', JSON.stringify(s.buttons));
  await page.screenshot({ path: `panel-${String(step).padStart(2, '0')}.png` }).catch(() => {});
  fs.writeFileSync('panel-last.json', JSON.stringify(s, null, 2));

  if (/developers\/panel/.test(s.url) && !/login|hub\/registration/.test(s.url) && !s.inputs.some((i) => i.type === 'password')) {
    console.log('>>> PANEL ACCESIBLE (sesión iniciada)');
    break;
  }

  // The verification chooser renders its options as list rows, not buttons.
  if (/m[ée]todo de verificaci[óo]n/i.test(s.text || '')) {
    const option = page.locator(':is(li,a,button,[role=button],div[tabindex]):has-text("Contraseña")').last();
    if (await option.count()) {
      console.log('  -> método "Contraseña"');
      await option.click({ timeout: 8000 }).catch(() => {});
      continue;
    }
  }

  let acted = false;
  for (const input of s.inputs) {
    const hay = `${input.label} ${input.placeholder} ${input.name} ${input.id}`.toLowerCase();
    const isEmail = input.type === 'email' || /e-?mail|usuario|user_id/.test(hay);
    const isPass = input.type === 'password' || /contrase/.test(hay);
    if (input.filled) continue;
    if (isEmail && EMAIL) {
      const target = input.id ? page.locator(`#${input.id}`) : page.locator(`input[name="${input.name}"]`);
      await target.first().click({ timeout: 5000 }).catch(() => {});
      await target.first().type(EMAIL, { delay: 55 }).catch(() => {});
      console.log('  -> email');
      acted = true;
    } else if (isPass && PASSWORD) {
      const target = input.id ? page.locator(`#${input.id}`) : page.locator('input[type=password]');
      await target.first().click({ timeout: 5000 }).catch(() => {});
      await target.first().type(PASSWORD, { delay: 55 }).catch(() => {});
      console.log('  -> password');
      acted = true;
    }
  }
  if (acted) await page.waitForTimeout(900);

  const cookies = page.locator('button:has-text("Aceptar cookies")').first();
  if (await cookies.count()) await cookies.click({ timeout: 4000 }).catch(() => {});

  for (const label of ['Confirmar', 'Continuar', 'Ingresar', 'Iniciar sesión', 'Siguiente']) {
    const b = page.locator(`button:has-text("${label}"), [role=button]:has-text("${label}")`).first();
    if (await b.count() && !(await b.isDisabled().catch(() => true))) {
      console.log(`  -> click "${label}"`);
      await b.click({ timeout: 8000 }).catch(() => {});
      break;
    }
  }
}

console.log('\n>>> dejo el navegador abierto 0s; perfil persistido en', PROFILE);
await context.close();
