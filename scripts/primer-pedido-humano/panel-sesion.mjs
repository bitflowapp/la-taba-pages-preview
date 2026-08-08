// Abre el Panel del negocio y DEJA la sesion guardada, para no volver a rotar la
// contraseña del dueño cada vez que haga falta mirarlo. La rotacion es una
// mutacion sobre una cuenta real: se hace una vez y se reutiliza.
//
// Uso: node panel-sesion.mjs [--reusar]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { requireDelRepo, REF, URL_BASE, SITIO, SUPABASE_CLI, BUSINESS_ID, evidencia } from './entorno.mjs';
const { chromium } = requireDelRepo('@playwright/test');

const SITE = SITIO;
const EV = evidencia('panel');
const STORAGE = path.join(EV, 'negocio-storage.json');

const reusar = process.argv.includes('--reusar') && fs.existsSync(STORAGE);

const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: admin })).json();

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  ...(reusar ? { storageState: STORAGE } : {}),
  viewport: { width: 1360, height: 1000 },
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  serviceWorkers: 'allow',
});
const page = await context.newPage();
const texto = async () => (await page.evaluate('(document.body?.innerText||"").replace(/\\s+/g," ")').catch(() => '')) || '';

await page.goto(`${SITE}/#business`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(reusar ? 9000 : 9000);

let t = await texto();
const necesitaLogin = /Ingresar|Iniciar sesión|Correo|Contraseña/i.test(t) && !/Panel|pedidos|operación/i.test(t);

if (!reusar || necesitaLogin) {
  const [owner] = await rest(`business_members?select=user_id&business_id=eq.${BUSINESS_ID}&role=eq.owner&is_active=eq.true`);
  const user = await (await fetch(`${URL_BASE}/auth/v1/admin/users/${owner.user_id}`, { headers: admin })).json();
  const PASSWORD = crypto.randomBytes(24).toString('base64url');
  await fetch(`${URL_BASE}/auth/v1/admin/users/${owner.user_id}`, {
    method: 'PUT', headers: admin, body: JSON.stringify({ password: PASSWORD }),
  });
  console.log(`rotada la clave del dueño (${user.email}) para esta sesion`);

  const forms = await page.locator('form:has(input[name="email"]):visible').all();
  const f = forms[forms.length - 1];
  await f.locator('input[name="email"]').fill(user.email);
  await f.locator('input[name="password"]').fill(PASSWORD);
  await f.locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Iniciar")').first().click({ timeout: 15000 });
  await page.waitForTimeout(15000);
  t = await texto();
}

await context.storageState({ path: STORAGE });
await page.screenshot({ path: path.join(EV, 'panel.png'), fullPage: false }).catch(() => {});

const sano = /Panel|operación|pedidos/i.test(t);
console.log(`\npanel operativo: ${sano}`);
console.log(`sesion guardada en: ${STORAGE}`);
console.log(`\n--- lo que muestra ---\n${t.slice(0, 900)}`);

if (process.env.MANTENER === '1') {
  console.log('\nel Panel queda ABIERTO. Cerrá esta ventana cuando termines.');
  await new Promise(() => {});
}
await context.close();
await browser.close();
