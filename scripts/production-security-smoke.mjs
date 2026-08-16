// Preguntarle a produccion, con una identidad de verdad, que puede ver.
//
// El aislamiento por tenant esta demostrado por pgTAP contra un esquema
// reconstruido, y eso prueba las policies. Lo que NO prueba es el camino real:
// PostgREST con un JWT emitido por GoTrue, que es como llega un cliente. Esta
// sonda usa ese camino.
//
// Crea UNA identidad anonima sintetica -la misma que crea cualquier visita del
// Customer-, mide, y la borra. No toca datos humanos porque no hay ninguno, y
// deja la base como la encontro.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>   (solo para la limpieza)
//   node scripts/production-security-smoke.mjs --ref wwcpogltfgzgkrlilbcd --key <publishable>
//
// Salida 0 = todo cerrado como corresponde. 1 = algo se ve que no deberia.

import fs from 'node:fs';
import process from 'node:process';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) {
  console.error(`--ref debe ser ${PRODUCTION_REF}`);
  process.exit(2);
}
const keyArg = arg('key');
const keyFile = arg('key-file');
const KEY = (keyArg || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!KEY) { console.error('falta --key o --key-file (la clave publicable)'); process.exit(2); }
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('falta SUPABASE_ACCESS_TOKEN (para poder limpiar)'); process.exit(2); }

const BASE = `https://${ref}.supabase.co`;

// Tablas que una identidad sin membresia NO puede leer. No es la lista completa
// de 85: es la lista de las que, si devolvieran una fila, serian una fuga.
const TABLAS_CERRADAS = [
  'orders', 'order_items', 'order_events', 'customers', 'rider_profiles',
  'rider_locations', 'rider_order_offers', 'payment_attempts', 'payment_outbox',
  'checkout_sessions', 'fiscal_documents', 'business_members', 'staff_profiles',
  'identity_sessions', 'operational_alerts', 'operational_sweep_runs',
];

const hallazgos = [];
function exigir(ok, detalle) { if (!ok) hallazgos.push(detalle); return ok; }

async function api(path, token, init = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

async function admin(sql, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query: sql, read_only: true } : { query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : [];
}

console.log(`--- SMOKE DE SEGURIDAD (${ref}) ---`);

const [antes] = await admin('select count(*)::int as n from auth.users;');
console.log(`  auth.users antes  : ${antes.n}`);

// --- A · una identidad sin membresia ---
const alta = await fetch(`${BASE}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: {} }),
});
const sesion = await alta.json();
const token = sesion?.access_token;
const userId = sesion?.user?.id;
if (!token || !userId) {
  console.error(`  no se pudo crear la identidad sintetica: ${alta.status} ${JSON.stringify(sesion).slice(0, 200)}`);
  process.exit(2);
}
console.log(`  identidad anonima : creada (${userId.slice(0, 8)}…)`);

try {
  // El JWT es de un usuario real, emitido por GoTrue. No es la clave anonima.
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  console.log(`  rol del JWT       : ${claims.role} · is_anonymous=${claims.is_anonymous}`);
  exigir(claims.role === 'authenticated', `el JWT dice role=${claims.role}, esperaba authenticated`);
  exigir(claims.is_anonymous === true, 'el JWT no se declara anonimo');

  // A · las tablas cerradas no devuelven una sola fila
  const abiertas = [];
  for (const tabla of TABLAS_CERRADAS) {
    const r = await api(`/rest/v1/${tabla}?select=*&limit=1`, token);
    const filas = Array.isArray(r.body) ? r.body.length : 0;
    if (r.status === 200 && filas > 0) abiertas.push(`${tabla} (${filas} fila)`);
  }
  console.log(`  tablas cerradas   : ${TABLAS_CERRADAS.length} probadas, ${abiertas.length} devolvieron filas`);
  exigir(abiertas.length === 0, `una identidad sin membresia lee: ${abiertas.join(', ')}`);

  // C · no obtiene rol de negocio
  const ctx = await api('/rest/v1/rpc/identity_current_context', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const rol = Array.isArray(ctx.body) ? ctx.body[0]?.role : ctx.body?.role;
  console.log(`  rol de negocio    : ${rol ?? '(ninguno)'}`);
  exigir(!rol, `una identidad sin membresia obtuvo el rol ${rol}`);

  // C bis · no puede darse un rol a si misma
  const alza = await api('/rest/v1/business_members', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ business_id: CANONICAL_BUSINESS, user_id: userId, role: 'owner', is_active: true }),
  });
  console.log(`  auto-membresia    : HTTP ${alza.status}`);
  exigir(alza.status >= 400, `pudo insertarse en business_members (HTTP ${alza.status})`);

  // E · la superficie publica del Customer sigue existiendo
  const salud = await api('/rest/v1/rpc/scheduler_heartbeat', token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  console.log(`  sonda publica     : HTTP ${salud.status}`);
  exigir(salud.status === 200, 'la sonda anonima dejo de responder: el reloj externo queda ciego');

  // E bis · el catalogo publico no filtra nada que no este publicado
  const cat = await api('/rest/v1/products?select=id,name&limit=5', token);
  const productos = Array.isArray(cat.body) ? cat.body.length : 0;
  console.log(`  catalogo publico  : HTTP ${cat.status} · ${productos} producto(s)`);
  exigir(productos === 0, `el catalogo devolvio ${productos} productos y todavia no hay ninguno publicado`);

  // F · no puede crear un pedido con la persiana cerrada
  const pedido = await api('/rest/v1/orders', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: CANONICAL_BUSINESS, total_amount: 1 }),
  });
  console.log(`  insert en orders  : HTTP ${pedido.status}`);
  exigir(pedido.status >= 400, `pudo insertar en orders directamente (HTTP ${pedido.status})`);
} finally {
  await admin(`delete from auth.users where id = '${userId}';`, false);
  const [despues] = await admin('select count(*)::int as n from auth.users;');
  console.log(`  limpieza          : auth.users = ${despues.n}`);
  if (despues.n !== antes.n) hallazgos.push(`auth.users quedo en ${despues.n}, esperaba ${antes.n}`);
}

if (hallazgos.length) {
  console.error('\n  HALLAZGOS:');
  for (const h of hallazgos) console.error(`    ${h}`);
  process.exit(1);
}
console.log('\n  RESULTADO         : TODO CERRADO');
