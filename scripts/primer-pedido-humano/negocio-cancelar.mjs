// NEGOCIO — cancela un pedido desde la UI real del Panel, con motivo.
//
// Se usa para retirar de la cola el pedido residual que quedó de la corrida que
// descubrió el corte de coordenadas. No se borra por SQL: mover pedidos reales
// por fuera de la UI del negocio es justo lo que este trabajo evita.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire('file:///D:/1212/la-taba2-first-physical-e2e/');
const { chromium } = require('@playwright/test');

const SITE = 'https://taba2-staging.pages.dev/';
const REF = 'ukxqbgswjlibmnjemrzd';
const CODE = process.env.QA_ORDER || 'LT-0097';
const MOTIVO = process.env.QA_MOTIVO || 'Pedido de prueba tecnica: se retira de la cola antes del piloto humano';
const EV = 'D:/1212/artifacts/taba2-first-physical-e2e/negocio';
fs.mkdirSync(EV, { recursive: true });

const keys = JSON.parse(execFileSync('C:\\1212\\scripts\\supabase.exe',
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const URL_BASE = `https://${REF}.supabase.co`;
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: admin })).json();

const [owner] = await rest("business_members?select=user_id&business_id=eq.00000000-0000-4000-8000-000000000001&role=eq.owner&is_active=eq.true");
const user = await (await fetch(`${URL_BASE}/auth/v1/admin/users/${owner.user_id}`, { headers: admin })).json();
const PASSWORD = crypto.randomBytes(24).toString('base64url');
await fetch(`${URL_BASE}/auth/v1/admin/users/${owner.user_id}`, {
  method: 'PUT', headers: admin, body: JSON.stringify({ password: PASSWORD }),
});

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', serviceWorkers: 'allow' });
const page = await context.newPage();
const text = async () => (await page.evaluate('(document.body?.innerText||"").replace(/\\s+/g," ")').catch(() => '')) || '';

await page.goto(`${SITE}#business`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
const forms = await page.locator('form:has(input[name="email"]):visible').all();
const form = forms[forms.length - 1];
await form.locator('input[name="email"]').fill(user.email);
await form.locator('input[name="password"]').fill(PASSWORD);
await form.locator('button[type="submit"], button:has-text("Ingresar"), button:has-text("Iniciar")').first().click({ timeout: 15000 });
await page.waitForTimeout(11000);
await page.locator('[data-production-orders-view]').first().click({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(9000);

const antes = (await rest(`orders?code=eq.${CODE}&select=status,revision`))[0];
console.log('antes:', JSON.stringify(antes));

// El control lleva el id del pedido en su atributo, así que se elige el del
// pedido correcto y no «el primero que aparezca».
// El control identifica el pedido por su CODIGO PUBLICO, no por el uuid: el
// view-model del Panel expone `order.id` como el codigo que ve el negocio.
const boton = page.locator(`[data-production-business-cancel="${CODE}"]`).first();
if (!(await boton.count())) throw new Error(`no encontre el control de cancelar de ${CODE}`);

// El motivo es obligatorio y vive en un campo de la MISMA tarjeta. Sin
// llenarlo, el Panel rechaza la cancelación -y hace bien: cancelar un pedido
// sin decir por qué no deja rastro de quién decidió qué-.
const tarjeta = page.locator('.production-order-card').filter({ hasText: CODE }).first();
const campoMotivo = tarjeta.locator('[data-production-cancel-reason]').first();
if (!(await campoMotivo.count())) throw new Error('no encontré el campo de motivo en la tarjeta');
await campoMotivo.fill(MOTIVO);
await page.waitForTimeout(500);
await boton.click({ timeout: 20000 });
await page.waitForTimeout(4000);

let despues = antes;
for (let i = 0; i < 20 && !/cancel/i.test(despues.status); i += 1) {
  await page.waitForTimeout(2000);
  despues = (await rest(`orders?code=eq.${CODE}&select=status,revision`))[0];
}
await page.screenshot({ path: path.join(EV, `n07-cancelado-${CODE}.png`) }).catch(() => {});
console.log('despues:', JSON.stringify(despues));
console.log(/cancel/i.test(despues.status) ? `${CODE} CANCELADO desde el Panel` : `${CODE} NO se canceló`);
await context.close();
await browser.close();
process.exitCode = /cancel/i.test(despues.status) ? 0 : 1;
