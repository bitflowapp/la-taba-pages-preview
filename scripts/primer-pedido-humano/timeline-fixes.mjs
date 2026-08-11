// Timeline completo de los fixes de un pedido, tal como los guarda el backend.
// Sin secretos. Sirve para ver si el ORDEN de captura y el de recepcion difieren.
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

const CODE = process.argv[2] || 'LT-0138';
const [o] = await rest(`orders?code=eq.${CODE}&select=id,status,revision,picked_up_at`);
const cols = 'id,sequence,receipt_sequence,order_revision,created_at,recorded_at,captured_at,lat,lng,accuracy,speed,heading,source,client_request_id';
const locs = await rest(`rider_locations?order_id=eq.${o.id}&select=${cols}&order=receipt_sequence.asc&limit=2000`);
if (!Array.isArray(locs)) { console.log(JSON.stringify(locs)); process.exit(1); }

const metros = (a, b) => {
  const R = 6371000; const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t; const dLng = (b.lng - a.lng) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

console.log(`${CODE}: ${o.status} r${o.revision} · ${locs.length} fixes\n`);
console.log('recv# seq   rev  captured_at              recorded_at              created_at(srv)          d(m)  acc   desorden');
let previo = null;
const desordenes = [];
for (const l of locs) {
  const d = previo ? metros(previo, l).toFixed(1) : '-';
  const cap = l.captured_at || l.recorded_at || l.created_at;
  const capPrev = previo ? (previo.captured_at || previo.recorded_at || previo.created_at) : null;
  const atrasado = capPrev && new Date(cap) < new Date(capPrev);
  if (atrasado) desordenes.push({ recibido: l.receipt_sequence, captured_at: cap, anterior: capPrev });
  console.log(
    `${String(l.receipt_sequence).padStart(5)} ${String(l.sequence ?? '-').padStart(5)} ${String(l.order_revision ?? '-').padStart(4)}  `
    + `${String(l.captured_at || '-').padEnd(24)} ${String(l.recorded_at || '-').padEnd(24)} ${String(l.created_at).padEnd(24)} `
    + `${String(d).padStart(6)} ${String(Math.round(l.accuracy)).padStart(4)}  ${atrasado ? 'SI <<<' : ''}`,
  );
  previo = l;
}

console.log(`\n--- fixes cuyo captured_at es ANTERIOR al del recibido justo antes: ${desordenes.length} ---`);
for (const d of desordenes) console.log(`  recibido #${d.recibido}: capturado ${d.captured_at} despues de ${d.anterior}`);

const dupes = {};
for (const l of locs) {
  const k = `${l.lat},${l.lng},${l.captured_at || l.recorded_at}`;
  dupes[k] = (dupes[k] || 0) + 1;
}
const repetidos = Object.entries(dupes).filter(([, n]) => n > 1);
console.log(`\nfixes con misma coordenada y misma captura: ${repetidos.length}`);
for (const [k, n] of repetidos.slice(0, 10)) console.log(`  x${n}  ${k}`);

const ids = new Set(locs.map((l) => l.client_request_id).filter(Boolean));
console.log(`\nclient_request_id distintos: ${ids.size} sobre ${locs.length} fixes`);

fs.writeFileSync(path.join(evidencia('gate-cliente'), `replay-timeline-${CODE}.json`),
  JSON.stringify({ pedido: o, locs, desordenes, repetidos }, null, 2), 'utf8');
