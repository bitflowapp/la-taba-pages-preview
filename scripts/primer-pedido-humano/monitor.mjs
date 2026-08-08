// Monitor del primer pedido humano, para correr DURANTE la entrega.
//
// Mira todo lo que el objetivo pide vigilar, cada pocos segundos, y grita
// cuando algo se sale de lo esperado. No muta nada: es solo lectura.
//
//   node monitor.mjs                 -> engancha el pedido humano automaticamente
//   node monitor.mjs LT-0104         -> vigila ese codigo
//   MINUTOS=90 node monitor.mjs      -> cuanto tiempo vigilar
//
// Como distingue el pedido humano de los QA viejos: los pedidos que entran por
// el storefront publicado quedan con `origin='production'`; los sembrados por QA
// quedan con `origin='qa'`. El humano es el `production` mas reciente que no
// este terminado. Si hubiera mas de uno, se planta y pide el codigo a mano: no
// adivina.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { REF, URL_BASE, SUPABASE_CLI, evidencia } from './entorno.mjs';

const CODE = process.argv[2] || null;
const MINUTOS = Number(process.env.MINUTOS || 90);
const CADA_MS = Number(process.env.CADA_MS || 6000);
const EV = evidencia('pedido-humano');

const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H });
  return r.json();
};

// ------------------------------------------------------------ el pedido -----
async function elegirPedido() {
  if (CODE) {
    const [o] = await rest(`orders?code=eq.${CODE}&select=id,code,status,revision,origin,total`);
    if (!o) throw new Error(`no existe ${CODE}`);
    return o;
  }
  const vivos = await rest(
    "orders?status=not.in.(delivered,cancelled,rejected)&origin=eq.production" +
    "&select=id,code,status,revision,origin,total,created_at&order=created_at.desc",
  );
  if (!Array.isArray(vivos) || vivos.length === 0) return null;
  if (vivos.length > 1) {
    console.log(`\nHAY ${vivos.length} PEDIDOS production VIVOS: ${vivos.map((o) => o.code).join(', ')}`);
    console.log('No adivino cual es el humano. Volvé a correr con el código: node monitor.mjs LT-XXXX\n');
    process.exit(2);
  }
  return vivos[0];
}

// --------------------------------------------------------- las verdades -----
const LT0030 = { status: 'arrived', revision: 11, total: '550.00' };
let stockInicial = null;
let alertas = [];

const grita = (m) => { if (!alertas.includes(m)) { alertas.push(m); console.log(`\n  >>> ${m}`); } };

async function foto(pedido) {
  const [prod] = await rest('products?name=ilike.*red%20bull*&select=name,stock,price,is_active');
  const [lt30] = await rest('orders?code=eq.LT-0030&select=status,revision,total');
  const fiscales = await rest('fiscal_documents?select=id&limit=2');
  const pos = await rest('pos_sales?select=id&limit=2');
  const delivery = await rest('delivery_outbox?dispatched_at=is.null&select=id');
  const notif = await rest('notification_outbox?processed_at=is.null&select=id');
  if (!pedido) return { prod, lt30, fiscales, pos, delivery, notif, o: null };

  const [o] = await rest(`orders?id=eq.${pedido.id}&select=id,code,status,revision,total,assigned_rider_user_id,delivered_at`);
  const locs = await rest(`rider_locations?order_id=eq.${pedido.id}&select=receipt_sequence,created_at,accuracy,client_request_id&order=receipt_sequence.desc&limit=200`);
  const handoff = await rest(`order_delivery_handoffs?order_id=eq.${pedido.id}&select=failed_attempts,confirmed_at`);
  const enVuelo = o.assigned_rider_user_id
    ? await rest(`orders?assigned_rider_user_id=eq.${o.assigned_rider_user_id}&status=in.(assigned,picked_up,on_the_way,arrived)&select=code`)
    : [];
  const gemelos = await rest(`orders?code=eq.${o.code}&select=id`);
  return { prod, lt30, fiscales, pos, delivery, notif, o, locs, handoff: handoff?.[0] || null, enVuelo, gemelos };
}

function pinta(f) {
  const ahora = new Date();
  const hhmm = ahora.toTimeString().slice(0, 8);
  if (!f.o) {
    console.log(`${hhmm}  esperando el pedido humano...  stock=${f.prod?.stock}  ARCA=${f.fiscales.length}/${f.pos.length}  LT-0030=${f.lt30.status} r${f.lt30.revision}`);
    return;
  }
  const locs = Array.isArray(f.locs) ? f.locs : [];
  const ultimo = locs[0] ? (Date.now() - new Date(locs[0].created_at).getTime()) / 1000 : null;
  const vivo = ultimo !== null && ultimo <= 15;
  const marcaGps = locs.length === 0 ? 'sin puntos'
    : `${locs.length} pts · ${ultimo.toFixed(0)}s ${vivo ? 'EN VIVO' : 'frio'} · ±${Number(locs[0].accuracy).toFixed(0)}m`;
  console.log(
    `${hhmm}  ${f.o.code} ${String(f.o.status).padEnd(11)} r${String(f.o.revision).padStart(2)}  ` +
    `$${f.o.total}  stock=${f.prod.stock}  gps: ${marcaGps}  ` +
    `outbox d/n=${f.delivery.length}/${f.notif.length}  ` +
    `codigo: ${f.handoff ? (f.handoff.confirmed_at ? 'confirmado' : `${f.handoff.failed_attempts} fallidos`) : '-'}`,
  );

  // ---- lo que NUNCA puede pasar -------------------------------------------
  if (f.fiscales.length > 0 || f.pos.length > 0) grita('ARCA EMITIO ALGO. Frenar.');
  if (f.lt30.status !== LT0030.status || Number(f.lt30.revision) !== LT0030.revision) {
    grita(`LT-0030 SE MOVIO: ${f.lt30.status} r${f.lt30.revision}. Frenar.`);
  }
  if (Array.isArray(f.gemelos) && f.gemelos.length > 1) grita(`EL PEDIDO ESTA DUPLICADO: ${f.gemelos.length} filas con el codigo ${f.o.code}.`);
  const claves = new Set(locs.map((l) => l.client_request_id));
  if (claves.size !== locs.length) grita('HAY UBICACIONES DUPLICADAS: exactly-once roto.');
  if (stockInicial === null) stockInicial = Number(f.prod.stock);
  const caida = stockInicial - Number(f.prod.stock);
  if (caida > 1) grita(`EL STOCK CAYO ${caida} unidades y el pedido es de una. Revisar.`);

  // ---- lo que tiene que pasar al terminar ---------------------------------
  if (f.o.status === 'delivered') {
    if (locs.length > 0) grita('QUEDARON COORDENADAS DESPUES DE ENTREGAR: la purga no corrio.');
    if (Array.isArray(f.enVuelo) && f.enVuelo.length > 0) grita(`EL RIDER NO QUEDO LIBRE: ${f.enVuelo.map((x) => x.code).join(', ')}`);
    if (!f.handoff?.confirmed_at) grita('ENTREGADO SIN CODIGO CONFIRMADO.');
  }
}

// ------------------------------------------------------------------ loop ----
let pedido = await elegirPedido();
if (pedido) console.log(`vigilando ${pedido.code} (${pedido.status}, origin=${pedido.origin}, $${pedido.total})`);
else console.log('todavia no hay pedido humano. Lo engancho apenas entre.');
console.log('Ctrl+C para cortar. Nada de esto muta: es solo lectura.\n');

const hasta = Date.now() + MINUTOS * 60_000;
const historia = [];
while (Date.now() < hasta) {
  try {
    if (!pedido) pedido = await elegirPedido();
    const f = await foto(pedido);
    pinta(f);
    if (f.o) historia.push({ t: new Date().toISOString(), code: f.o.code, status: f.o.status, revision: f.o.revision, puntos: (f.locs || []).length });
    if (f.o?.status === 'delivered' && alertas.length === 0) {
      console.log('\nENTREGADO y sin alertas. El monitor sigue 60 s mas por si algo se mueve despues.');
      await new Promise((s) => setTimeout(s, 60_000));
      const cierre = await foto(pedido);
      pinta(cierre);
      break;
    }
  } catch (e) {
    console.log(`  (lectura fallida: ${String(e).slice(0, 80)})`);
  }
  await new Promise((s) => setTimeout(s, CADA_MS));
}

fs.writeFileSync(`${EV}/monitor.json`, JSON.stringify({ alertas, historia }, null, 2));
console.log(`\n${alertas.length === 0 ? 'SIN ALERTAS' : `ALERTAS: ${alertas.length}`}`);
alertas.forEach((a) => console.log(`  - ${a}`));
console.log(`evidencia: ${EV}/monitor.json`);
