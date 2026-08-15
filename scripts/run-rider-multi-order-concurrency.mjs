// TABA2 · Rider multi-pedido · CARRERAS REALES
//
// pgTAP corre todo dentro de una transacción, así que no puede probar la única
// pregunta que importa de la capacidad: qué pasa cuando dos escrituras llegan
// AL MISMO TIEMPO desde conexiones distintas. Esto abre conexiones de verdad.
//
// Dos escenarios, los dos del encargo:
//
//   1. Un Rider en 0/3 recibe 8 ofertas y las acepta las 8 a la vez.
//      Esperado: exactamente 3 aceptadas, 5 rechazadas, nunca 4/3.
//   2. Un Rider en 2/3 y dos operadores distintos que le asignan pedidos
//      distintos simultáneamente. Esperado: uno entra, el otro no.
//
// Local y descartable. Sin `TABA_LOCAL_RIDER_DB=1` no arranca.

import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';

if (process.env.TABA_LOCAL_RIDER_DB !== '1') {
  console.error('Refusing to run database tests without TABA_LOCAL_RIDER_DB=1. This suite is local-only.');
  process.exit(2);
}

const container = process.env.TABA_SUPABASE_DB_CONTAINER || 'supabase_db_la-taba-pages';
const database = process.env.TABA_RIDER_DB_NAME;
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';

if (!database) {
  console.error('TABA_RIDER_DB_NAME is required: this script runs against an already-built ephemeral database.');
  process.exit(2);
}

// Un juego de identidades por escenario, para que ninguno herede el estado del
// anterior.
let BUSINESS;
let STAFF_A;
let STAFF_B;
let RIDER;
let ORDER_PREFIX;
let SESSION = {};
let SCENARIO;

function useScenario(digit) {
  SCENARIO = digit;
  BUSINESS = `b900000${digit}-0000-4000-8000-0000000000c0`;
  STAFF_A = `a900000${digit}-0000-4000-8000-0000000000c1`;
  STAFF_B = `a900000${digit}-0000-4000-8000-0000000000c2`;
  RIDER = `a900000${digit}-0000-4000-8000-0000000000c3`;
  ORDER_PREFIX = `f900000${digit}-0000-4000-8000-00000000000`;
  SESSION = {
    [STAFF_A]: `e900000${digit}-0000-4000-8000-0000000000c1`,
    [STAFF_B]: `e900000${digit}-0000-4000-8000-0000000000c2`,
    [RIDER]: `e900000${digit}-0000-4000-8000-0000000000c3`,
  };
}

function psqlCapture(sql) {
  return execFileSync(
    dockerCommand,
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t'],
    { encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'inherit'] },
  ).trim();
}

function claims(user) {
  return JSON.stringify({ sub: user, role: 'authenticated', session_id: SESSION[user] });
}

// Una conexión propia por llamada. Ésa es la diferencia con pgTAP.
function raceCall(user, sql) {
  return new Promise((resolve) => {
    const child = spawn(dockerCommand, [
      'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-q', '-X', '-A', '-t',
      '-c', `select set_config('request.jwt.claims', ${quote(claims(user))}, false)`,
      '-c', sql,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', () => resolve({ out: out.trim(), err: err.trim() }));
  });
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const failures = [];
function check(condition, message, detail) {
  if (condition) {
    console.log(`ok - ${message}`);
  } else {
    failures.push(message);
    console.log(`not ok - ${message}`);
    if (detail !== undefined) console.log(`#   ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

// Cada escenario siembra su propio comercio. No se borra nada entre uno y otro:
// la base es efimera y el alta de pedidos deja rastro en tablas satelite
// (order_events, operational_alerts) que un DELETE tendria que perseguir.
function seed(prefix, count) {
  psqlCapture(`
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values
      ('${STAFF_A}','authenticated','authenticated','race-staff-a-${SCENARIO}@example.invalid','',now(),'{}','{"display_name":"Staff A"}',now(),now()),
      ('${STAFF_B}','authenticated','authenticated','race-staff-b-${SCENARIO}@example.invalid','',now(),'{}','{"display_name":"Staff B"}',now(),now()),
      ('${RIDER}','authenticated','authenticated','race-rider-${SCENARIO}@example.invalid','',now(),'{}','{"display_name":"Marco"}',now(),now());

    insert into public.businesses(id,name,status,slug,is_active)
    values('${BUSINESS}','TABA carreras ${SCENARIO}','open','taba-carreras-${SCENARIO}',true);

    insert into public.business_members(business_id,user_id,role,is_active) values
      ('${BUSINESS}','${STAFF_A}','staff',true),
      ('${BUSINESS}','${STAFF_B}','staff',true),
      ('${BUSINESS}','${RIDER}','rider',true);

    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
      ('${SESSION[STAFF_A]}','${STAFF_A}','${BUSINESS}','staff','panel_web'),
      ('${SESSION[STAFF_B]}','${STAFF_B}','${BUSINESS}','staff','panel_web'),
      ('${SESSION[RIDER]}','${RIDER}','${BUSINESS}','rider','rider_android');

    -- El punto de entrega confirmado va EN EL INSERT: el trigger que lo exige es
    -- una constraint diferida, asi que en pgTAP (que termina en rollback) nunca
    -- se dispara y aca, con autocommit, si.
    insert into public.orders(
      id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
      client_request_id,customer_name,customer_neighborhood,customer_street_address,
      payment_method,subtotal,delivery_fee,total,
      delivery_latitude,delivery_longitude,delivery_location_source,delivery_location_confirmed_at
    )
    select
      ('${ORDER_PREFIX}' || to_hex(n))::uuid, '${BUSINESS}',
      '${prefix}-' || n, '${prefix}-' || n, 'ready', 'delivery', 'delivery',
      '${prefix}-req-' || n, 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro', 'Calle ' || n,
      'cash', 1000, 0, 1000,
      -38.9460616, -68.0533209, 'map_pin', clock_timestamp()
    from generate_series(1, ${count}) as n;
  `);
}

function activeCount() {
  return Number(psqlCapture(`select public.count_rider_active_orders('${BUSINESS}','${RIDER}',null);`));
}

// ── Escenario 1: 8 aceptaciones simultáneas sobre un Rider en 0/3 ──────────
console.log('# escenario 1: ocho aceptaciones simultaneas, rider en 0/3');
useScenario(1);
seed('RACE', 8);

const offerIds = psqlCapture(`
  select set_config('request.jwt.claims', ${quote(claims(STAFF_A))}, false);
  select public.offer_order_to_rider(o.id, 'ready', null, '${RIDER}') ->> 'offer_id'
    from public.orders o
   where o.business_id = '${BUSINESS}'
   order by o.public_code;
`).split('\n').filter((line) => /^[0-9a-f-]{36}$/.test(line.trim()));

check(offerIds.length === 8, 'ocho ofertas vivas al mismo rider', offerIds.length);
check(activeCount() === 0, 'y el rider arranca en 0/3');

const results = await Promise.all(offerIds.map((offerId, index) => raceCall(
  RIDER,
  `select public.accept_rider_order_offer('${offerId}'::uuid, 1, 'race-accept-${String(index).padStart(6, '0')}')`,
)));

const accepted = results.filter((r) => r.out.includes('"code": "accepted"')).length;
const atCapacity = results.filter((r) => r.out.includes('at_capacity')).length;
const errored = results.filter((r) => r.err.length > 0);

check(errored.length === 0, 'ninguna de las ocho llamadas erroro', errored.map((e) => e.err).join(' | '));
check(accepted === 3, `exactamente 3 aceptaciones ganaron (fueron ${accepted})`);
check(atCapacity === 5, `y 5 se rechazaron por capacidad (fueron ${atCapacity})`);

const finalCount = activeCount();
check(finalCount === 3, `el rider quedo en 3/3, nunca en 4/3 (quedo en ${finalCount})`);
check(
  Number(psqlCapture(`select count(*) from public.rider_order_offers where business_id='${BUSINESS}' and status='accepted';`)) === 3,
  'y hay exactamente 3 ofertas marcadas como aceptadas',
);
check(
  Number(psqlCapture(`select count(*) from public.orders where business_id='${BUSINESS}' and assigned_rider_user_id='${RIDER}';`)) === 3,
  'y exactamente 3 pedidos nombran al rider',
);

// ── Escenario 2: dos operadores, mismo Rider en 2/3 ───────────────────────
console.log('# escenario 2: dos operadores asignan a la vez a un rider en 2/3');
useScenario(2);
seed('MULTI', 4);
psqlCapture(`
  select set_config('request.jwt.claims', ${quote(claims(STAFF_A))}, false);
  update public.orders set assigned_rider_user_id = '${RIDER}', status = 'assigned'
   where business_id = '${BUSINESS}' and public_code in ('MULTI-1','MULTI-2');
`);
check(activeCount() === 2, 'el rider arranca en 2/3');

const staffRace = await Promise.all([
  raceCall(STAFF_A, `select public.assign_order_rider((select id from public.orders where public_code='MULTI-3'), 'ready', null, '${RIDER}')`),
  raceCall(STAFF_B, `select public.assign_order_rider((select id from public.orders where public_code='MULTI-4'), 'ready', null, '${RIDER}')`),
]);

const staffOk = staffRace.filter((r) => r.err.length === 0).length;
const staffRejected = staffRace.filter((r) => /el rider ya tiene/.test(r.err)).length;
check(staffOk === 1, `un solo operador entro (entraron ${staffOk})`);
check(staffRejected === 1, `y al otro lo freno la capacidad (freno a ${staffRejected})`);
const staffFinal = activeCount();
check(staffFinal === 3, `el rider quedo en 3/3 (quedo en ${staffFinal})`);

if (failures.length > 0) {
  console.error(`\nCONCURRENCIA: ${failures.length} fallas.`);
  process.exit(1);
}
console.log('\nCONCURRENCIA: 11 comprobaciones, 0 fallas.');
