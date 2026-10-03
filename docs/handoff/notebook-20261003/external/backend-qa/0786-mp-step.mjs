import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

// Small stateful driver over the already-authenticated panel profile.
//   node mp-step.mjs <url> '[{"click":"Crear aplicación"},{"fill":["#name","TABA2"]}]'
const URL_ARG = process.argv[2];
const ACTIONS = JSON.parse(process.argv[3] || '[]');
const PROFILE = process.env.MP_PROFILE || 'D:/1212/browser-temp/taba2-mp-panel';

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1360, height: 950 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();

const EXTRACT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!vis(el) || el.type === 'hidden') continue;
    inputs.push({ id: el.id || '', name: el.getAttribute('name') || '', type: el.type || el.tagName.toLowerCase(),
      value: (el.value || '').slice(0, 120),
      label: (el.getAttribute('aria-label') || el.closest('label')?.innerText || el.parentElement?.innerText || '').replace(/\\s+/g,' ').trim().slice(0,70) });
  }
  const clickables = [];
  for (const el of document.querySelectorAll('button, a, [role=button], [role=radio], [role=tab], li[tabindex], label')) {
    if (!vis(el)) continue;
    const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim();
    if (t) clickables.push(t.slice(0, 60));
  }
  return { url: location.href, text: (document.body?.innerText || '').replace(/\\n{2,}/g,'\\n').slice(0, 2200),
    inputs, clickables: [...new Set(clickables)].slice(0, 40) };
})()`;

if (URL_ARG && URL_ARG !== 'current') {
  await page.goto(URL_ARG, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', String(e).slice(0, 120)));
}
await page.waitForTimeout(3500);

for (const action of ACTIONS) {
  if (action.click) {
    const loc = page.locator(`:is(button,a,[role=button],[role=radio],[role=tab],li,label,div[tabindex]):has-text("${action.click}")`).last();
    console.log(`ACCION click "${action.click}" (n=${await loc.count()})`);
    await loc.click({ timeout: 10000 }).catch((e) => console.log('  fallo:', String(e).slice(0, 100)));
  }
  // Writes a value straight to disk; only its length and digest are printed.
  if (action.capture) {
    const [expression, file] = action.capture;
    const value = await page.evaluate(expression).catch((e) => `FALLO ${String(e).slice(0, 120)}`);
    const text = String(value ?? '');
    fs.writeFileSync(file, text);
    const { createHash } = await import('node:crypto');
    console.log(`ACCION capture -> ${file} (len=${text.length}, sha256=${createHash('sha256').update(text).digest('hex').slice(0, 12)})`);
  }
  if (action.js) {
    console.log('ACCION js');
    const out = await page.evaluate(action.js).catch((e) => `fallo: ${String(e).slice(0, 120)}`);
    console.log('  ->', JSON.stringify(out));
  }
  if (action.check) {
    const box = page.locator(action.check === true ? 'input[type=checkbox]' : action.check).first();
    console.log(`ACCION check (n=${await box.count()})`);
    await box.check({ timeout: 10000, force: true }).catch((e) => console.log('  fallo:', String(e).slice(0, 100)));
    console.log('  checked =', await box.isChecked().catch(() => 'n/a'));
  }
  if (action.fill) {
    const [selector, value] = action.fill;
    console.log(`ACCION fill ${selector}`);
    await page.locator(selector).first().fill(value, { timeout: 10000 }).catch((e) => console.log('  fallo:', String(e).slice(0, 100)));
  }
  await page.waitForTimeout(action.wait || 3000);
}

await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
const s = await page.evaluate(EXTRACT).catch(() => ({ url: page.url(), text: '', inputs: [], clickables: [] }));

// Credentials pages render tokens in clear once revealed. Nothing secret is
// allowed to reach stdout or the artifact directory.
const redact = (value) => String(value)
  .replace(/(TEST|APP_USR)-[A-Za-z0-9_-]{8,}/g, '$1-<REDACTADO>')
  .replace(/\b[a-f0-9]{32,}\b/gi, '<REDACTADO-HEX>');

console.log('\nURL:', s.url);
console.log('TEXTO:\n' + redact(s.text));
console.log('\nINPUTS:', redact(JSON.stringify(s.inputs, null, 1)));
console.log('\nCLICKABLES:', redact(JSON.stringify(s.clickables)));
fs.writeFileSync('step-last.json', redact(JSON.stringify(s, null, 2)));
await page.screenshot({ path: 'step-last.png', fullPage: true }).catch(() => {});
await context.close();
