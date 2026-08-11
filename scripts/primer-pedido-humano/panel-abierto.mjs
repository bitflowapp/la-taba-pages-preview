// Deja el Panel del negocio ABIERTO y con la sesion puesta, para que lo maneje
// una persona. No rota ninguna contrasena: usa la cuenta de staff que ya existe.
// No cierra el navegador: se queda vivo hasta que se lo mate.
import fs from 'node:fs';
import path from 'node:path';
import { requireDelRepo, SITIO, evidencia, secreto } from './entorno.mjs';

const { chromium } = requireDelRepo('@playwright/test');
const EV = evidencia('gate-cliente');

const cred = fs.readFileSync(secreto('la-taba-staging-business-login.txt'), 'utf8');
const EMAIL = (cred.match(/SUPABASE_STAFF_EMAIL=(.+)/) || [])[1]?.trim();
const PASS = (cred.match(/SUPABASE_STAFF_PASSWORD=(.+)/) || [])[1]?.trim();
if (!EMAIL || !PASS) throw new Error('no pude leer el login de staff');

const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
const context = await browser.newContext({
  viewport: null, locale: 'es-AR',
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
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(EV, 'm3-panel-abierto.png') }).catch(() => {});

console.log(`Panel abierto y con sesion (${EMAIL}).`);
console.log('Queda vivo hasta que se cierre la ventana o se mate el proceso.');

// Si la persona cierra la ventana, el proceso termina solo y no queda colgado.
await new Promise((resolve) => {
  page.on('close', resolve);
  context.on('close', resolve);
  browser.on('disconnected', resolve);
});
console.log('la ventana se cerro; suelto el proceso');
