/**
 * Certificacion del Panel de la RC1 en la URL PUBLICA, contra la base viva.
 *
 * Lo que se demuestra: que el boton que la RC cablea de forma distinta a lo que
 * staging servia hasta hoy despacha DE VERDAD `recover_paid_checkout_order`, que
 * arma el pedido cuando puede, y que cuando el stock no alcanza conserva el
 * detalle accionable en vez de un error generico.
 *
 * Credenciales por entorno, nunca impresas.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const U = 'https://taba2-staging.pages.dev';
const SB = 'https://ukxqbgswjlibmnjemrzd.supabase.co';
const SR = process.env.TABA_SERVICE_ROLE;
const SALIDA = 'D:/1212/artifacts/taba2-pilot-rc1/certificacion-panel.json';
const EV = 'D:/1212/artifacts/taba2-pilot-rc1';

const H = { apikey: SR, Authorization: `Bearer ${SR}` };
const cuenta = async (t) => {
  const r = await fetch(`${SB}/rest/v1/${t}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  return Number((r.headers.get('content-range') || '/0').split('/')[1]);
};
const traer = async (p) => (await fetch(`${SB}/rest/v1/${p}`, { headers: H })).json();

const pasos = [];
const anotar = (nombre, ok, detalle) => {
  pasos.push({ nombre, ok, detalle });
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 }, locale: 'es-AR' });
const p = await ctx.newPage();
const errores = []; const malas = [];
p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errores.push(m.text().slice(0, 200)); });
p.on('response', (r) => { if (r.status() >= 400) malas.push(`${r.status()} ${r.url().replace(/\?.*/, '')}`); });

const pedidosAntes = await cuenta('orders?select=id');
const stockAntes = (await traer('products?select=sku,stock&sku=eq.imperial-apa-lata-473ml'))[0].stock;
console.log(`estado inicial: ${pedidosAntes} pedidos · stock imperial ${stockAntes}\n`);

// 1 · acceso
await p.goto(`${U}/#business`, { waitUntil: 'load', timeout: 90_000 });
await p.waitForTimeout(6000);
const form = p.locator('form:has(input[name="email"]):visible').last();
await form.locator('input[name="email"]').fill(process.env.TABA_OWNER_EMAIL);
await form.locator('input[name="password"]').fill(process.env.TABA_OWNER_PASSWORD);
await form.locator('button[type="submit"]').first().click();
await p.waitForTimeout(14_000);
const texto = async () => (await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')));
let t = await texto();
anotar('el Panel abre con la cuenta duenio', /PANEL DEL NEGOCIO/.test(t) && /Dueño/.test(t), 'sesión verificada');

// 2 · pedidos visibles
await p.locator('button:has-text("Pedidos"), a:has-text("Pedidos")').first().click().catch(() => {});
await p.waitForTimeout(7000);
t = await texto();
const hayPedidos = /LT-\d+/.test(t);
anotar('los pedidos existentes se ven', hayPedidos, (t.match(/LT-\d+/g) || []).slice(0, 3).join(', '));

// 3 · pagos y el boton sólo donde corresponde
await p.locator('button:has-text("Pagos"), a:has-text("Pagos")').first().click();
await p.waitForTimeout(8000);
await p.screenshot({ path: `${EV}/panel-01-pagos.png` }).catch(() => {});
const leerAcciones = () => p.evaluate(() => [...document.querySelectorAll('[data-payment-action="recover-order"]')]
  .map((e) => ({ intent: e.dataset.paymentIntent, texto: (e.innerText || '').trim() })));
let recuperables = await leerAcciones();
const totalPagos = Number(((await texto()).match(/(\d+)\s+pago\(s\) listados/) || [])[1] || 0);
anotar('el rearmado se ofrece SOLO donde el servidor lo habilita',
  recuperables.length === 2, `${recuperables.length} botones sobre ${totalPagos} pagos`);

const fx = await traer('payment_intents?select=id,correlation_id&correlation_id=in.(11111111-0000-4000-8000-0000000000aa,11111111-0000-4000-8000-0000000000bb)');
const idA = fx.find((x) => x.correlation_id.endsWith('aa')).id;
const idB = fx.find((x) => x.correlation_id.endsWith('bb')).id;
anotar('los dos botones son exactamente los dos cobros QA',
  recuperables.every((r) => [idA, idB].includes(r.intent)), `A=${idA.slice(0, 8)} B=${idB.slice(0, 8)}`);

// 4 · CASO B primero (no muta nada): stock insuficiente conserva el detalle
await p.locator(`[data-payment-action="recover-order"][data-payment-intent="${idB}"]`).click();
await p.waitForTimeout(9000);
t = await texto();
const mensajeB = (t.match(/No hay stock para armarlo:[^.]*\./) || [])[0] || '';
anotar('sin stock, el Panel dice QUE falta y CUANTO',
  /No hay stock para armarlo/.test(t) && /hacen falta 900/.test(t), mensajeB.slice(0, 140));
const pedidosTrasB = await cuenta('orders?select=id');
anotar('y NO inventa un pedido incumplible', pedidosTrasB === pedidosAntes, `${pedidosAntes} -> ${pedidosTrasB}`);
await p.screenshot({ path: `${EV}/panel-02-sin-stock.png` }).catch(() => {});

// 5 · CASO A: el boton arma el pedido de verdad
await p.locator(`[data-payment-action="recover-order"][data-payment-intent="${idA}"]`).click();
await p.waitForTimeout(12_000);
t = await texto();
const pedidosTrasA = await cuenta('orders?select=id');
anotar('el boton ejecuta el rearmado y crea UN pedido',
  pedidosTrasA === pedidosAntes + 1, `${pedidosAntes} -> ${pedidosTrasA}`);
anotar('y lo dice con el codigo del pedido', /armado|ya estaba armado/i.test(t),
  (t.match(/Pedido LT-\d+ armado|El pedido de este cobro ya estaba armado/) || [])[0] || t.slice(0, 120));
await p.screenshot({ path: `${EV}/panel-03-armado.png` }).catch(() => {});

// 6 · el boton desaparece: no se puede duplicar desde la UI
await p.locator('[data-payment-action="refresh"]').first().click().catch(() => {});
await p.waitForTimeout(8000);
recuperables = await leerAcciones();
anotar('tras armarlo el boton desaparece de ese cobro',
  !recuperables.some((r) => r.intent === idA), `quedan ${recuperables.length}`);

// 7 · el respaldo por consulta sigue vivo
const antesReq = await p.evaluate(() => performance.getEntriesByType('resource')
  .filter((r) => /list_business_payments|list_business_orders/.test(r.name)).length);
await p.waitForTimeout(12_000);
const despuesReq = await p.evaluate(() => performance.getEntriesByType('resource')
  .filter((r) => /list_business_payments|list_business_orders/.test(r.name)).length);
anotar('la consulta de respaldo sigue corriendo', despuesReq > antesReq, `${antesReq} -> ${despuesReq} llamadas`);

// 8 · limpieza de la pagina
anotar('cero errores de consola', errores.length === 0, errores.slice(0, 2).join(' | '));
anotar('cero respuestas >=400', malas.length === 0, [...new Set(malas)].slice(0, 3).join(' | '));

const pedidoNuevo = await traer(`orders?select=id,public_code,status,total,correlation_id&order=created_at.desc&limit=1`);
const informe = {
  momento: new Date().toISOString(),
  url: U,
  pedidosAntes, pedidosDespues: pedidosTrasA, stockAntes,
  cobroA: idA, cobroB: idB,
  pedidoCreado: pedidoNuevo[0],
  pasos,
  verdes: pasos.filter((x) => x.ok).length,
  total: pasos.length,
  errores, respuestas4xx: [...new Set(malas)],
};
fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2), 'utf8');
console.log(`\n${informe.verdes}/${informe.total} verdes`);
console.log('pedido creado por el rearmado:', JSON.stringify(pedidoNuevo[0]));
await b.close();
