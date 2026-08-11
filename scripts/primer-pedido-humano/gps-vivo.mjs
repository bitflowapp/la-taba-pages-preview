// Sólo lectura: ¿está publicando GPS real para este pedido, ahora?
import { execFileSync } from 'node:child_process';
import { REF, URL_BASE, SUPABASE_CLI } from './entorno.mjs';
const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();

const CODE = process.argv[2] || 'LT-0134';
const [o] = await rest(`orders?code=eq.${CODE}&select=id,status,revision,assigned_rider_user_id,picked_up_at,dispatched_at`);
console.log(`${CODE}: ${o.status} r${o.revision} rider=${String(o.assigned_rider_user_id).slice(0, 8)} picked_up=${o.picked_up_at}`);

const cols = 'receipt_sequence,created_at,recorded_at,lat,lng,accuracy,speed,source,client_request_id';
const locs = await rest(`rider_locations?order_id=eq.${o.id}&select=${cols}&order=receipt_sequence.desc&limit=12`);
if (!Array.isArray(locs)) { console.log(JSON.stringify(locs)); process.exit(1); }
console.log(`\nubicaciones publicadas: ${locs.length ? `${locs.length} (ultimas)` : 'NINGUNA'}`);
for (const l of locs) {
  const edad = Math.round((Date.now() - new Date(l.created_at).getTime()) / 1000);
  console.log(`  seq ${String(l.receipt_sequence).padStart(5)}  hace ${String(edad).padStart(4)}s  ${l.lat}, ${l.lng}  +-${l.accuracy} m  ${l.source}`);
}
const total = await rest(`rider_locations?order_id=eq.${o.id}&select=receipt_sequence&order=receipt_sequence.asc&limit=1`);
if (locs.length) {
  const ultimo = Math.round((Date.now() - new Date(locs[0].created_at).getTime()) / 1000);
  console.log(`\nel ultimo punto tiene ${ultimo}s  ->  ${ultimo <= 15 ? 'EN VIVO' : ultimo <= 60 ? 'fresco' : 'VIEJO'}`);
  console.log(`primer seq: ${total[0]?.receipt_sequence}   ultimo seq: ${locs[0].receipt_sequence}`);
}
