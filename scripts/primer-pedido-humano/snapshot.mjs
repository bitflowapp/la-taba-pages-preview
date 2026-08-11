// Foto del estado de staging antes/despues de una mutacion. Solo lectura.
//   node snapshot.mjs antes-de-la-migracion
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REF, URL_BASE, SUPABASE_CLI, evidencia } from './entorno.mjs';
const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();

const ETIQUETA = process.argv[2] || 'snapshot';
const EV = evidencia('gate-cliente');

const foto = {
  etiqueta: ETIQUETA,
  at: new Date().toISOString(),
  pedidos_vivos: await rest('orders?status=not.in.(delivered,cancelled,rejected)&select=code,status,revision,origin,total,assigned_rider_user_id&order=created_at.desc&limit=30'),
  pedidos_del_navegador: await rest('orders?customer_user_id=eq.86c3036d-ee0a-45f2-bbdf-304d2bbbf70f&select=code,status,revision&order=created_at.desc&limit=10'),
  lt0030: (await rest('orders?code=eq.LT-0030&select=code,status,revision,total,updated_at'))[0],
  alertas_abiertas: await rest('operational_alerts?status=neq.resolved&select=alert_code,subject_id,occurrence_count,status'),
  arca: {
    fiscal_documents: (await rest('fiscal_documents?select=id&limit=100')).length,
    pos_sales: (await rest('pos_sales?select=id&limit=100')).length,
    fiscal_outbox: (await rest('fiscal_outbox?select=id&limit=100')).length,
  },
  outbox: {
    delivery_pendientes: (await rest('delivery_outbox?dispatched_at=is.null&select=id')).length,
    notification_pendientes: (await rest('notification_outbox?processed_at=is.null&select=id')).length,
  },
  productos: await rest('products?is_active=eq.true&select=name,stock&order=name.asc&limit=20'),
  ubicaciones_lt0138: (await rest('rider_locations?order_id=eq.60119190-04af-4782-83ab-502d5e2c3a45&select=receipt_sequence&order=receipt_sequence.desc&limit=1'))[0],
  barrido: (await rest('operational_sweep_runs?select=started_at,status&order=started_at.desc&limit=1'))[0],
};

fs.writeFileSync(path.join(EV, `snapshot-${ETIQUETA}.json`), JSON.stringify(foto, null, 2), 'utf8');
console.log(`=== SNAPSHOT ${ETIQUETA} · ${foto.at} ===`);
console.log(`pedidos vivos: ${foto.pedidos_vivos.map((o) => `${o.code}:${o.status}`).join(', ') || 'ninguno'}`);
console.log(`del navegador del cliente: ${foto.pedidos_del_navegador.map((o) => `${o.code}:${o.status}`).join(', ')}`);
console.log(`LT-0030: ${JSON.stringify(foto.lt0030)}`);
console.log(`alertas abiertas: ${foto.alertas_abiertas.length} (${foto.alertas_abiertas.map((a) => a.alert_code).join(', ') || '-'})`);
console.log(`ARCA: ${JSON.stringify(foto.arca)}`);
console.log(`outbox: ${JSON.stringify(foto.outbox)}`);
console.log(`ultimo recibo GPS de LT-0138: ${JSON.stringify(foto.ubicaciones_lt0138)}`);
console.log(`barrido: ${JSON.stringify(foto.barrido)}`);
console.log(`guardado en snapshot-${ETIQUETA}.json`);
