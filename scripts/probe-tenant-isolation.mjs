// FASE 22 - Aislamiento entre inquilinos medido por el camino real.
//
// pgTAP corre como `postgres`: `set local role authenticated` cambia
// current_user pero NO session_user, y las guardas de identidad de TABA miran
// session_user para distinguir una migracion de una llamada del navegador. Por
// eso una suite pgTAP puede dar verde sobre un contrato que en produccion se
// comporta distinto.
//
// Esta sonda entra por TCP como `authenticator` -el rol con el que PostgREST se
// conecta de verdad- y desde ahi asume anon/authenticated con claims JWT.
// Corre contra el SHADOW, cuyo esquema quedo demostrado identico al de
// produccion por compare-production-drift.mjs.
//
//   node scripts/probe-tenant-isolation.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SHADOW_CONTAINER || 'taba2-prod-shadow';
const dockerBin = process.platform === 'win32' ? 'docker.exe' : 'docker';

// Conexion TCP como authenticator: asi session_user = authenticator, igual que
// en un proyecto Supabase real.
const DSN = 'postgresql://authenticator@127.0.0.1:5432/postgres';

function run(sql) {
  try {
    const out = execFileSync(dockerBin,
      ['exec', '-i', container, 'psql', DSN, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim() };
  } catch (error) {
    const stderr = String(error.stderr || '');
    return { ok: false, out: stderr.trim().split('\n').slice(0, 2).join(' ') };
  }
}

const identity = run('select session_user, current_user;');
console.log('--- SONDA DE AISLAMIENTO (conexion real como authenticator) ---');
console.log(`  session_user/current_user: ${identity.out}`);
if (!identity.ok) {
  console.error('  no se pudo conectar como authenticator');
  process.exit(2);
}

const OTRO_NEGOCIO = '11111111-1111-4111-8111-111111111111';
const OTRO_RIDER = '22222222-2222-4222-8222-222222222222';

// Cada caso corre en su propia transaccion y termina en rollback: no queda una
// sola fila. `set local role` mas el claim JWT reproduce lo que arma PostgREST.
function comoRol(rol, sub, cuerpo) {
  const claims = sub
    ? `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"${rol}"}', true);`
    : `select set_config('request.jwt.claims', '', true);`;
  return `begin;\nset local role ${rol};\n${claims}\n${cuerpo}\nrollback;`;
}

const casos = [
  { nombre: 'anon no lee orders de nadie', rol: 'anon', sub: null,
    sql: 'select count(*) from public.orders;', esperado: 'cero o error' },
  // businesses tiene grants POR COLUMNA: anon ve la vitrina y nada mas. Medir
  // con count(*) da un falso positivo -basta una columna concedida-, asi que se
  // pregunta por las columnas que NO debe ver.
  { nombre: 'anon no lee el telefono del negocio', rol: 'anon', sub: null,
    sql: 'select phone from public.businesses;', esperado: 'error' },
  { nombre: 'anon no lee la config fiscal del negocio', rol: 'anon', sub: null,
    sql: 'select alcohol_sales_enabled from public.businesses;', esperado: 'error' },
  { nombre: 'anon no escribe en businesses', rol: 'anon', sub: null,
    sql: "update public.businesses set name='x';", esperado: 'error' },
  { nombre: 'anon no lee rider_locations', rol: 'anon', sub: null,
    sql: 'select count(*) from public.rider_locations;', esperado: 'cero o error' },
  { nombre: 'anon no lee ofertas de rider', rol: 'anon', sub: null,
    sql: 'select count(*) from public.rider_order_offers;', esperado: 'cero o error' },
  { nombre: 'anon no lee identity_sessions', rol: 'anon', sub: null,
    sql: 'select count(*) from public.identity_sessions;', esperado: 'cero o error' },
  { nombre: 'anon no escribe en orders', rol: 'anon', sub: null,
    sql: "insert into public.orders(id) values (gen_random_uuid());", esperado: 'error' },
  { nombre: 'anon no escribe en fiscal_profile_events', rol: 'anon', sub: null,
    sql: "insert into public.fiscal_profile_events(business_id) values ('" + OTRO_NEGOCIO + "');", esperado: 'error' },
  { nombre: 'autenticado ajeno no ve orders de otro negocio', rol: 'authenticated', sub: OTRO_RIDER,
    sql: 'select count(*) from public.orders;', esperado: 'cero' },
  { nombre: 'autenticado ajeno no ve business_members', rol: 'authenticated', sub: OTRO_RIDER,
    sql: 'select count(*) from public.business_members;', esperado: 'cero o error' },
  { nombre: 'autenticado ajeno no ve customers', rol: 'authenticated', sub: OTRO_RIDER,
    sql: 'select count(*) from public.customers;', esperado: 'cero o error' },
  { nombre: 'autenticado ajeno no ve customer_addresses', rol: 'authenticated', sub: OTRO_RIDER,
    sql: 'select count(*) from public.customer_addresses;', esperado: 'cero o error' },
  { nombre: 'autenticado ajeno no ve payment_intents', rol: 'authenticated', sub: OTRO_RIDER,
    sql: 'select count(*) from public.payment_intents;', esperado: 'cero o error' },
  { nombre: 'autenticado ajeno no ve fiscal_documents', rol: 'authenticated', sub: OTRO_RIDER,
    sql: 'select count(*) from public.fiscal_documents;', esperado: 'cero o error' },
  // Firmas reales, para que el rechazo sea de autorizacion y no un "no existe".
  { nombre: 'autenticado ajeno no asigna un rider', rol: 'authenticated', sub: OTRO_RIDER,
    sql: `select public.assign_order_rider('${OTRO_NEGOCIO}'::uuid, 'ready'::text, null::uuid, '${OTRO_RIDER}'::uuid);`,
    esperado: 'error' },
  { nombre: 'autenticado ajeno no ofrece un pedido', rol: 'authenticated', sub: OTRO_RIDER,
    sql: `select public.offer_order_to_rider('${OTRO_NEGOCIO}'::uuid, 'ready'::text, null::uuid, '${OTRO_RIDER}'::uuid);`,
    esperado: 'error' },
  { nombre: 'autenticado ajeno no acepta una oferta', rol: 'authenticated', sub: OTRO_RIDER,
    sql: `select public.accept_rider_order_offer('${OTRO_NEGOCIO}'::uuid, 1::bigint, 'probe'::text);`,
    esperado: 'error' },
];

const resultados = [];
let fallas = 0;

for (const caso of casos) {
  const r = run(comoRol(caso.rol, caso.sub, caso.sql));
  let veredicto;
  if (!r.ok) {
    veredicto = 'BLOQUEADO (error)';
  } else if (/^0$/m.test(r.out) || r.out === '') {
    veredicto = 'BLOQUEADO (0 filas)';
  } else {
    veredicto = `EXPUESTO -> ${r.out.slice(0, 80)}`;
    fallas += 1;
  }
  const detalle = r.ok ? '' : `  [${r.out.replace(/\s+/g, ' ').slice(0, 90)}]`;
  console.log(`  ${veredicto.startsWith('EXPUESTO') ? 'FAIL' : 'PASS'}  ${caso.nombre.padEnd(48)} ${veredicto}`);
  if (detalle) console.log(`        ${detalle.trim()}`);
  resultados.push({ ...caso, veredicto, salida: r.out.slice(0, 200) });
}

// Nada de esto debe haber dejado rastro.
const residuo = run('select count(*) from public.orders;');
console.log(`\n  filas en orders al terminar: ${residuo.ok ? residuo.out : '(sin acceso, correcto)'}`);

const out = path.join(root, 'artifacts', 'production-supabase', 'TENANT-ISOLATION-PROBE.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({
  schemaVersion: 1,
  probedAt: new Date().toISOString(),
  connection: 'authenticator over TCP (session_user real)',
  target: container,
  note: 'esquema demostrado identico a produccion por compare-production-drift.mjs',
  casos: resultados,
  fallas,
}, null, 2)}\n`);

console.log(`\n  ${casos.length - fallas}/${casos.length} contratos sostienen el aislamiento`);
console.log(`  informe: ${out}`);
process.exit(fallas === 0 ? 0 : 1);
