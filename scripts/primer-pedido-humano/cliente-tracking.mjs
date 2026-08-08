// CLIENTE — seguimiento del pedido y código de entrega.
//
// El código se cifra con el token de seguimiento y sólo el navegador que compró
// lo tiene. Se usa el camino que el producto ya ofrece para recuperarlo:
// `recover_order_tracking_access`, que revoca el token viejo, emite uno nuevo y
// REGENERA el código cifrado con él. Todo con la sesión del propio cliente,
// desde su propio navegador: ni la service key puede descifrarlo.
import fs from 'node:fs';
import path from 'node:path';

import { requireDelRepo, SITIO, evidencia } from './entorno.mjs';
const { chromium } = requireDelRepo('@playwright/test');

const SITE = `${SITIO}/`;
const CODE = process.env.QA_ORDER;
if (!CODE) throw new Error('falta QA_ORDER=LT-XXXX');
const EV = evidencia('cliente');
const STORAGE = path.join(EV, 'cliente-storage.json');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  storageState: STORAGE,
  viewport: { width: 412, height: 900 },
  deviceScaleFactor: 2,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  serviceWorkers: 'allow',
});
const page = await context.newPage();
const text = async () => (await page.evaluate('(document.body?.innerText||"").replace(/\\s+/g," ")').catch(() => '')) || '';

await page.goto(`${SITE}#tracking`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
await page.screenshot({ path: path.join(EV, 't01-seguimiento.png') }).catch(() => {});
const seguimiento = await text();
console.log('seguimiento:', seguimiento.slice(0, 260));

// El pedido y su código, con la sesión del cliente que vive en esta pestaña.
const resultado = await page.evaluate(async (codigoPedido) => {
  const cfg = globalThis.__LA_TABA_RUNTIME_CONFIG__?.repository;
  if (!cfg) return { error: 'sin runtime config' };
  const clave = `sb-${cfg.supabaseUrl.replace('https://', '').split('.')[0]}-auth-token`;
  let token = null;
  try { token = JSON.parse(localStorage.getItem(clave) || 'null')?.access_token; } catch (_) {}
  if (!token) return { error: 'sin sesión de cliente en esta pestaña' };

  const cabeceras = {
    apikey: cfg.publishableKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const pedidos = await (await fetch(
    `${cfg.supabaseUrl}/rest/v1/orders?code=eq.${codigoPedido}&select=id,status`,
    { headers: cabeceras },
  )).json();
  if (!Array.isArray(pedidos) || pedidos.length !== 1) {
    return { error: `el cliente no ve el pedido: ${JSON.stringify(pedidos).slice(0, 160)}` };
  }
  const pedido = pedidos[0];

  const nuevo = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
  const rec = await (await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/recover_order_tracking_access`, {
    method: 'POST', headers: cabeceras,
    body: JSON.stringify({ p_order_id: pedido.id, p_new_tracking_token: nuevo }),
  })).json();
  const emision = await (await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/issue_order_delivery_code`, {
    method: 'POST', headers: cabeceras,
    body: JSON.stringify({ p_order_id: pedido.id, p_tracking_token: nuevo }),
  })).json();
  return { estado: pedido.status, recuperado: rec?.ok ?? rec, delivery_code: emision?.delivery_code, expira: emision?.expires_at };
}, CODE);

console.log('resultado:', JSON.stringify({ ...resultado, delivery_code: resultado.delivery_code ? '****' : null }));
if (!resultado.delivery_code || !/^[0-9]{4}$/.test(String(resultado.delivery_code))) {
  throw new Error(`el cliente no obtuvo un código de 4 dígitos: ${resultado.error || 'sin código'}`);
}
console.log('CODIGO:', resultado.delivery_code);
fs.writeFileSync(path.join(EV, 'codigo-pedido.json'), JSON.stringify({
  code: CODE, delivery_code: String(resultado.delivery_code), estado: resultado.estado, expira: resultado.expira,
}, null, 2));
await page.screenshot({ path: path.join(EV, 't02-codigo.png') }).catch(() => {});
await context.storageState({ path: STORAGE });
await context.close();
await browser.close();
