/**
 * Sonda exploratoria del Panel publicado: entra con la cuenta del duenio y
 * describe lo que realmente hay en pantalla, para escribir la certificacion
 * contra el DOM que existe y no contra el que uno supone.
 *
 * Las credenciales llegan por variables de entorno y NO se imprimen nunca.
 */
import { chromium } from 'playwright';

const U = 'https://taba2-staging.pages.dev';
const EMAIL = process.env.TABA_OWNER_EMAIL;
const PASS = process.env.TABA_OWNER_PASSWORD;
if (!EMAIL || !PASS) { console.error('faltan credenciales en el entorno'); process.exit(1); }

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 }, locale: 'es-AR' });
const p = await ctx.newPage();
const errs = []; const malas = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) malas.push(`${r.status()} ${r.url().replace(/\?.*/, '')}`); });

await p.goto(`${U}/#business`, { waitUntil: 'load', timeout: 90_000 });
await p.waitForTimeout(6000);

const formulario = p.locator('form:has(input[name="email"]):visible').last();
const hayForm = await formulario.count();
console.log('formulario de acceso visible:', hayForm > 0);

if (hayForm) {
  await formulario.locator('input[name="email"]').fill(EMAIL);
  await formulario.locator('input[name="password"]').fill(PASS);
  await formulario.locator('button[type="submit"]').first().click();
  await p.waitForTimeout(14000);
}

const info = await p.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const attrs = new Map();
  document.querySelectorAll('*').forEach((el) => {
    for (const a of el.attributes) {
      if (!a.name.startsWith('data-')) continue;
      if (!vis(el)) continue;
      attrs.set(a.name, (attrs.get(a.name) || 0) + 1);
    }
  });
  return {
    vistaActiva: document.querySelector('.app-view.is-active')?.dataset.view,
    workspaceVisible: vis(document.querySelector('[data-production-workspace="business"]') || document.createElement('i')),
    atributos: [...attrs.entries()].filter(([k]) => /payment|order|pedido|nav|tab|view|action|alert|recover/i.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 30),
    textoPanel: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
  };
});
console.log(JSON.stringify(info, null, 2));
console.log('\nerrores:', errs.length ? errs.slice(0, 6) : 'ninguno');
console.log('respuestas >=400:', malas.length ? [...new Set(malas)].slice(0, 6) : 'ninguna');
await b.close();
