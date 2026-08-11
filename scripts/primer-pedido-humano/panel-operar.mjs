// El NEGOCIO, desde su Panel real: retira un pedido con motivo y lleva otro
// hasta «listo». Un solo login, y cada paso se confirma contra el backend antes
// de dar el siguiente.
//
// Todo control se dispara en el MISMO turno de JS en que se lee la tarjeta,
// porque el Panel re-dibuja la cola cada ~520 ms y entre leer y hacer click la
// fila de botones ya se movio. Eso esta medido en m1-defecto-redibujo.json.
//
//   node panel-operar.mjs --cancelar LT-0135 --avanzar LT-0134 --hasta ready
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { requireDelRepo, REF, URL_BASE, SITIO, SUPABASE_CLI, evidencia, secreto } from './entorno.mjs';

const { chromium } = requireDelRepo('@playwright/test');
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CANCELAR = arg('--cancelar');
const AVANZAR = arg('--avanzar');
const HASTA = arg('--hasta', 'ready');
const MOTIVO = arg('--motivo', 'Prueba interna / pedido accidental');
const EV = evidencia('gate-cliente');

const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();
const estado = async (code) => (await rest(`orders?code=eq.${code}&select=status,revision`))[0];

const cred = fs.readFileSync(secreto('la-taba-staging-business-login.txt'), 'utf8');
const EMAIL = (cred.match(/SUPABASE_STAFF_EMAIL=(.+)/) || [])[1]?.trim();
const PASS = (cred.match(/SUPABASE_STAFF_PASSWORD=(.+)/) || [])[1]?.trim();

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1360, height: 1000 }, locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires', serviceWorkers: 'allow',
});
const page = await context.newPage();
await page.goto(`${SITIO}/#business`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
const forms = await page.locator('form:has(input[name="email"]):visible').all();
if (forms.length) {
  const f = forms[forms.length - 1];
  await f.locator('input[name="email"]').fill(EMAIL);
  await f.locator('input[name="password"]').fill(PASS);
  await f.locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Iniciar")').first().click({ timeout: 15000 });
  await page.waitForTimeout(14000);
}
await page.locator('[data-production-orders-view]').first().click({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(8000);
await page.screenshot({ path: path.join(EV, 'm3-01-panel.png') }).catch(() => {});

const bitacora = [];

// ------------------------------------------------------------- cancelar -----
for (const CODIGO of (CANCELAR ? CANCELAR.split(',').map((c) => c.trim()).filter(Boolean) : [])) {
  const CANCELAR = CODIGO;
  const antes = await estado(CANCELAR);
  console.log(`\n--- retirando ${CANCELAR} (esta en ${antes.status} r${antes.revision}) ---`);
  const r = await page.evaluate(({ code, motivo }) => {
    const card = [...document.querySelectorAll('.production-order-card')]
      .find((c) => c.querySelector('.production-order-code')?.textContent.trim() === code);
    if (!card) return { ok: false, error: 'sin tarjeta' };
    const input = card.querySelector('[data-production-cancel-reason]');
    const boton = card.querySelector('[data-production-business-cancel]');
    if (!input || !boton) return { ok: false, error: 'sin control de cancelar' };
    if (boton.getAttribute('data-production-business-cancel') !== code) return { ok: false, error: 'el control apunta a otro pedido' };
    input.value = motivo;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    boton.click();
    return { ok: true };
  }, { code: CANCELAR, motivo: MOTIVO });
  if (!r.ok) throw new Error(`${CANCELAR}: ${r.error}`);
  let e = antes;
  for (let i = 0; i < 30 && !/cancel/i.test(e.status); i += 1) { await page.waitForTimeout(2000); e = await estado(CANCELAR); }
  console.log(`${CANCELAR}: ${antes.status} -> ${e.status} r${e.revision}`);
  bitacora.push({ pedido: CANCELAR, accion: 'cancelar', motivo: MOTIVO, de: antes.status, a: e.status });
  if (!/cancel/i.test(e.status)) throw new Error(`${CANCELAR} no se cancelo`);
}

// -------------------------------------------------------------- avanzar -----
if (AVANZAR) {
  const CADENA = ['received', 'accepted', 'preparing', 'ready'];
  const meta = CADENA.indexOf(HASTA);
  if (meta < 0) throw new Error(`no se a donde es «${HASTA}»`);
  for (let paso = 0; paso < 6; paso += 1) {
    const e = await estado(AVANZAR);
    const donde = CADENA.indexOf(e.status);
    if (donde >= meta) { console.log(`\n${AVANZAR} ya esta en ${e.status}`); break; }
    const siguiente = CADENA[donde + 1];
    console.log(`\n--- ${AVANZAR}: ${e.status} -> ${siguiente} ---`);
    const r = await page.evaluate(({ code, siguiente }) => {
      const card = [...document.querySelectorAll('.production-order-card')]
        .find((c) => c.querySelector('.production-order-code')?.textContent.trim() === code);
      if (!card) return { ok: false, error: 'sin tarjeta' };
      const boton = card.querySelector('[data-production-business-next]');
      if (!boton) return { ok: false, error: 'sin boton primario' };
      if (boton.getAttribute('data-production-business-next') !== code) return { ok: false, error: 'el boton apunta a otro pedido' };
      const destino = boton.getAttribute('data-next-status');
      if (destino !== siguiente) return { ok: false, error: `el boton lleva a «${destino}», no a «${siguiente}»` };
      const etiqueta = boton.textContent.trim();
      boton.click();
      return { ok: true, etiqueta, destino };
    }, { code: AVANZAR, siguiente });
    if (!r.ok) throw new Error(`${AVANZAR}: ${r.error}`);
    console.log(`  boton «${r.etiqueta}» -> ${r.destino}`);
    let ahora = e;
    for (let i = 0; i < 25 && ahora.status === e.status; i += 1) { await page.waitForTimeout(2000); ahora = await estado(AVANZAR); }
    console.log(`  quedo en ${ahora.status} r${ahora.revision}`);
    bitacora.push({ pedido: AVANZAR, accion: 'avanzar', de: e.status, a: ahora.status, boton: r.etiqueta });
    if (ahora.status === e.status) throw new Error(`${AVANZAR} no se movio de ${e.status}`);
    await page.waitForTimeout(1500);
  }
}

await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(EV, 'm3-02-panel-final.png'), fullPage: true }).catch(() => {});
await context.close();
await browser.close();

console.log('\n=== COMO QUEDO ===');
for (const c of [...(CANCELAR ? CANCELAR.split(',').map((x) => x.trim()) : []), AVANZAR].filter(Boolean)) {
  const e = await estado(c);
  console.log(`${c}: ${e.status} r${e.revision}`);
}
const cola = await rest('orders?origin=eq.production&status=not.in.(delivered,cancelled,rejected)&select=code,status');
console.log('production vivos:', cola.map((c) => `${c.code}:${c.status}`).join(', '));
fs.writeFileSync(path.join(EV, 'm3-panel-bitacora.json'), JSON.stringify({ bitacora, cola }, null, 2), 'utf8');
