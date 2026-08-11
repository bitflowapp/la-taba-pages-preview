// Certificacion de base de datos del auto-dispatch de Riders.
//
// Levanta un PostgreSQL desechable, aplica TODAS las migraciones del repo,
// corre el contrato de runtime y despues ejecuta carreras reales con dos
// sesiones concurrentes y barrera temporal. Es local: no toca staging ni
// produccion, y no reutiliza el contenedor compartido de otro worktree.
//
//   TABA_LOCAL_DISPATCH_DB=1 node scripts/run-rider-dispatch-db.mjs

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_DISPATCH_DB !== '1') {
  console.error('Refusing to run database tests without TABA_LOCAL_DISPATCH_DB=1. This suite is local-only.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const container = process.env.TABA_DISPATCH_DB_CONTAINER || 'taba2_dispatch_verify';
const image = process.env.TABA_DISPATCH_DB_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.143';
// Solo se lee de este contenedor, para copiar los esquemas de plataforma.
const platformSource = process.env.TABA_DISPATCH_PLATFORM_SOURCE || 'supabase_db_la-taba-pages';

const runId = process.hrtime.bigint().toString(36).slice(-6);
const failures = [];
function check(condition, message) {
  if (condition) {
    console.log(`  OK   ${message}`);
  } else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function docker(args, options = {}) {
  return execFileSync(dockerCommand, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    input: options.input, stdio: ['pipe', 'pipe', options.quiet ? 'pipe' : 'inherit'],
  });
}

function psql(sql, { quiet = true } = {}) {
  return docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-X'], { input: sql, quiet });
}

function psqlValue(sql) {
  return docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t'], { input: sql, quiet: true }).trim();
}

// Una sesion independiente que espera la barrera y despues ejecuta su comando.
// Devuelve una promesa con el texto que imprimio psql.
// El preambulo y la espera van en bloques DO para que no impriman filas: la
// unica linea de stdout que importa es RESULT=. Un error del servidor sale por
// stderr y se reporta como codigo propio, nunca clasificado por texto libre.
function racer(label, jwtSub, barrierIso, sqlExpression) {
  const preamble = jwtSub
    ? `do $$ begin perform set_config('request.jwt.claims','{"sub":"${jwtSub}","role":"authenticated"}',false); end $$;`
    : '';
  const script = `
${preamble}
do $$ begin perform pg_sleep(greatest(0, extract(epoch from ('${barrierIso}'::timestamptz - clock_timestamp())))); end $$;
select 'RESULT=' || coalesce((${sqlExpression})::text, 'null');
`;
  return new Promise((resolve) => {
    const child = spawn(dockerCommand, ['exec', '-i', container, 'psql', '-U', 'postgres',
      '-d', 'postgres', '-q', '-X', '-A', '-t'], { cwd: root });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', () => {
      const match = out.match(/RESULT=(.*)/);
      const sqlstate = err.match(/ERROR:\s*(.+)/);
      resolve({
        label,
        code: match ? match[1].trim() : (sqlstate ? `error:${sqlstate[1].trim()}` : 'no_output'),
        stderr: err.trim(),
      });
    });
    child.stdin.end(script);
  });
}

// Corre el contrato capturando stdout y stderr juntos: cada verificacion se
// emite como NOTICE, y un fallo aborta con ERROR. Ambos viven en stderr.
function runContract() {
  const file = path.join(root, 'supabase', 'tests', 'rider_dispatch_runtime.local.sql');
  const result = spawnSync(dockerCommand,
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-X'],
    { cwd: root, encoding: 'utf8', input: fs.readFileSync(file, 'utf8'), maxBuffer: 64 * 1024 * 1024 });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) console.error(combined);
  return combined;
}

function containerRunning() {
  try {
    return docker(['inspect', '-f', '{{.State.Running}}', container], { quiet: true }).trim() === 'true';
  } catch { return false; }
}

function provision() {
  console.log('· Provisionando PostgreSQL desechable');
  try { docker(['rm', '-f', container], { quiet: true }); } catch { /* no existia */ }
  docker(['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image], { quiet: true });

  // pg_isready pasa mientras la imagen todavia reinicia el server durante su
  // bootstrap, asi que la espera exige una consulta real y estable.
  let ready = false;
  for (let i = 0; i < 90 && !ready; i += 1) {
    try {
      docker(['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', 'select 1'],
        { quiet: true });
      ready = true;
    } catch { sleepSync(1000); }
  }
  if (!ready) throw new Error('el PostgreSQL de verificacion no quedo disponible');
  sleepSync(1500);

  // auth/storage los crea la plataforma Supabase, no una migracion del repo.
  const platform = docker(['exec', platformSource, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
    '--schema-only', '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges'],
  { quiet: true });
  docker(['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-q', '-c',
    'drop schema if exists auth cascade; drop schema if exists storage cascade;'], { quiet: true });
  docker(['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-q'],
    { input: platform, quiet: true });
  docker(['exec', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-q', '-c',
    'grant all on schema auth, storage to postgres; '
    + 'grant all on all tables in schema auth, storage to postgres;'], { quiet: true });
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
  `);

  const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    psql(fs.readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8'));
  }
  console.log(`· ${migrations.length} migraciones aplicadas`);
}

// ---------------------------------------------------------------------------
// Fixture de carrera
// ---------------------------------------------------------------------------

// Deja un pedido listo, dos Riders con turno activo y latido fresco, y corre un
// ciclo del worker. Devuelve los identificadores necesarios para la carrera.
function raceFixture(baseTag) {
  // Emails, slugs y claves de idempotencia son unicos globalmente: cada corrida
  // necesita su propia identidad para poder repetirse sobre la misma base.
  const tag = `${baseTag}-${runId}`;
  const json = psqlValue(`
    set client_min_messages = warning;
    do $$
    declare
      v_business uuid := gen_random_uuid();
      v_owner uuid := gen_random_uuid();
      v_a uuid := gen_random_uuid();
      v_b uuid := gen_random_uuid();
      v_order uuid := gen_random_uuid();
      v_shift uuid; v_version bigint;
    begin
      insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values (v_owner,'authenticated','authenticated','race-owner-${tag}@example.invalid','','{}','{}',now(),now()),
             (v_a,'authenticated','authenticated','race-a-${tag}@example.invalid','','{}','{}',now(),now()),
             (v_b,'authenticated','authenticated','race-b-${tag}@example.invalid','','{}','{}',now(),now());
      insert into public.businesses(id,name,status,slug,is_active,address,currency_code)
      values (v_business,'TABA race ${tag}','open','taba-race-${tag}',true,'Av Argentina 100','ARS');
      insert into public.business_members(business_id,user_id,role,is_active)
      values (v_business,v_owner,'owner',true),(v_business,v_a,'rider',true),(v_business,v_b,'rider',true);
      insert into private.rider_map_business_locations(business_id,latitude,longitude,source)
      values (v_business,-38.951,-68.059,'qa_fixture');
      perform public.ensure_rider_dispatch_policy(v_business);

      insert into public.orders(
        id,business_id,code,public_code,client_request_id,payment_method,delivery_mode,
        fulfillment_type,status,subtotal,total,origin,origin_reason,origin_classified_at,
        customer_neighborhood,delivery_latitude,delivery_longitude,
        delivery_location_source,delivery_location_confirmed_at
      ) values (
        v_order,v_business,'RACE-${tag}','RACE-${tag}',left(replace(v_order::text,'-',''),24),
        'cash','delivery','delivery','preparing',1500,1500,'qa','carrera local',now(),
        'centro',-38.955,-68.070,'map_pin',now()
      );
      insert into private.rider_map_order_location_snapshots(
        order_id,business_latitude,business_longitude,business_source,
        customer_latitude,customer_longitude,customer_source
      ) values (v_order,-38.951,-68.059,'qa_fixture',-38.955,-68.070,'qa_fixture')
      on conflict (order_id) do update set
        business_latitude=excluded.business_latitude, business_longitude=excluded.business_longitude,
        business_source=excluded.business_source, customer_latitude=excluded.customer_latitude,
        customer_longitude=excluded.customer_longitude, customer_source=excluded.customer_source;
      insert into private.rider_dispatch_qa_allowlist(order_id,reason,expires_at)
      values (v_order,'carrera local de dispatch',now()+interval '1 day');

      perform set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
      perform public.configure_business_auto_dispatch(v_business,true,true,
        'carrera local de certificacion','race-enable-${tag}');

      -- Rider A mas cerca del pickup que Rider B: ranking predecible.
      perform set_config('request.jwt.claims', json_build_object('sub',v_a::text,'role','authenticated')::text, true);
      perform public.rider_work_now('race-a-worknow-${tag}');
      select id, version into v_shift, v_version from public.rider_shifts where rider_user_id=v_a;
      perform public.rider_shift_heartbeat(v_shift,v_version,now(),-38.9515,-68.0595,12.0,false);

      perform set_config('request.jwt.claims', json_build_object('sub',v_b::text,'role','authenticated')::text, true);
      perform public.rider_work_now('race-b-worknow-${tag}');
      select id, version into v_shift, v_version from public.rider_shifts where rider_user_id=v_b;
      perform public.rider_shift_heartbeat(v_shift,v_version,now(),-38.9600,-68.0700,12.0,false);

      perform set_config('request.jwt.claims', null, true);
      update public.orders set status='ready', ready_at=now() where id=v_order;
      perform public.run_rider_dispatch_cycle(10,'test');

      create temporary table if not exists race_ids(payload jsonb);
      delete from race_ids;
      insert into race_ids(payload) values (jsonb_build_object(
        'business', v_business, 'owner', v_owner, 'rider_a', v_a, 'rider_b', v_b, 'order', v_order));
    end $$;
    select payload::text from race_ids;
  `);
  return JSON.parse(json);
}

function liveOffer(orderId) {
  const row = psqlValue(`
    select coalesce(jsonb_build_object('id',o.id,'version',o.version,'rider',o.rider_user_id)::text,'null')
      from public.dispatch_offers o join public.dispatch_jobs j on j.id=o.job_id
     where j.order_id='${orderId}' and o.status='offered';
  `);
  return row ? JSON.parse(row) : null;
}

function orderAssignment(orderId) {
  return JSON.parse(psqlValue(`
    select jsonb_build_object(
      'status', o.status, 'assigned', o.assigned_rider_user_id,
      'estimated_entries', (select count(*) from public.rider_reward_ledger l
         where l.order_id=o.id and l.entry_type='estimated'),
      'accepted_offers', (select count(*) from public.dispatch_offers d
         join public.dispatch_jobs j on j.id=d.job_id
        where j.order_id=o.id and d.status='accepted'),
      'jobs', (select count(*) from public.dispatch_jobs j where j.order_id=o.id)
    )::text from public.orders o where o.id='${orderId}';
  `));
}

async function barrierAt(ms = 2000) {
  return psqlValue(`select (clock_timestamp() + interval '${ms} milliseconds')::text;`);
}

// ---------------------------------------------------------------------------
// Carreras
// ---------------------------------------------------------------------------

async function raceDoubleTap() {
  console.log('\n· Carrera 1 · doble tap del mismo Rider sobre la misma oferta');
  const ids = raceFixture('dt');
  const offer = liveOffer(ids.order);
  if (!offer) throw new Error('la carrera 1 no obtuvo oferta');

  const barrier = await barrierAt();
  const call = (key) => `public.accept_rider_dispatch_offer('${offer.id}','${offer.version}','${key}') ->> 'code'`;
  const results = await Promise.all([
    racer('A1', offer.rider, barrier, call('race-dt-key-000001')),
    racer('A2', offer.rider, barrier, call('race-dt-key-000002')),
  ]);
  const codes = results.map((r) => r.code);
  console.log(`  codigos: ${JSON.stringify(codes)}`);

  const state = orderAssignment(ids.order);
  check(codes.filter((c) => c === 'offer_accepted').length === 1,
    'exactamente una de las dos sesiones acepta');
  check(codes.some((c) => ['already_accepted', 'offer_not_available'].includes(c)),
    'la perdedora recibe un receipt estructurado, no un texto de error');
  check(state.assigned !== null && state.status === 'assigned', 'el pedido queda asignado');
  check(state.estimated_entries === 1, `un unico asiento estimated (hay ${state.estimated_entries})`);
  check(state.accepted_offers === 1, `una unica oferta aceptada (hay ${state.accepted_offers})`);
  check(state.jobs === 1, `un unico dispatch job (hay ${state.jobs})`);
}

async function raceStaleVersusFresh() {
  console.log('\n· Carrera 2 · oferta vencida contra oferta vigente de otro Rider');
  const ids = raceFixture('sf');
  const stale = liveOffer(ids.order);
  if (!stale) throw new Error('la carrera 2 no obtuvo la primera oferta');

  // Vence el lease de A y se reofrece a B, sin que el cliente de A se entere.
  psql(`
    update public.dispatch_offers
       set offered_at = clock_timestamp() - interval '2 minutes',
           lease_expires_at = clock_timestamp() - interval '1 second'
     where id='${stale.id}';
    select public.run_rider_dispatch_cycle(10,'test');
  `);
  const fresh = liveOffer(ids.order);
  if (!fresh) throw new Error('la carrera 2 no reofrecio al siguiente Rider');
  if (fresh.rider === stale.rider) throw new Error('la reoferta fue al mismo Rider');

  const barrier = await barrierAt();
  const results = await Promise.all([
    racer('stale', stale.rider, barrier,
      `public.accept_rider_dispatch_offer('${stale.id}','${stale.version}','race-sf-stale-0001') ->> 'code'`),
    racer('fresh', fresh.rider, barrier,
      `public.accept_rider_dispatch_offer('${fresh.id}','${fresh.version}','race-sf-fresh-0001') ->> 'code'`),
  ]);
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r.code]));
  console.log(`  codigos: ${JSON.stringify(byLabel)}`);

  const state = orderAssignment(ids.order);
  check(byLabel.fresh === 'offer_accepted', 'la oferta vigente gana');
  check(byLabel.stale !== 'offer_accepted', 'la oferta vencida no puede ganar');
  check(state.assigned === fresh.rider, 'el pedido queda con el Rider de la oferta vigente');
  check(state.estimated_entries === 1, `un unico asiento estimated (hay ${state.estimated_entries})`);
  check(state.accepted_offers === 1, `una unica oferta aceptada (hay ${state.accepted_offers})`);
}

async function raceAcceptVersusOverride() {
  console.log('\n· Carrera 3 · accept del Rider contra override manual del negocio');
  const ids = raceFixture('ov');
  const offer = liveOffer(ids.order);
  if (!offer) throw new Error('la carrera 3 no obtuvo oferta');
  const otherRider = offer.rider === ids.rider_a ? ids.rider_b : ids.rider_a;
  const jobRevision = psqlValue(
    `select revision from public.dispatch_jobs where order_id='${ids.order}';`);

  const barrier = await barrierAt();
  const results = await Promise.all([
    racer('accept', offer.rider, barrier,
      `public.accept_rider_dispatch_offer('${offer.id}','${offer.version}','race-ov-accept-01') ->> 'code'`),
    racer('override', ids.owner, barrier,
      `public.manual_override_dispatch('${ids.business}','${ids.order}','${otherRider}',`
      + `'cobertura confirmada por operacion','race-ov-override-${runId}','${jobRevision}') ->> 'code'`),
  ]);
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r.code]));
  console.log(`  codigos: ${JSON.stringify(byLabel)}`);

  const state = orderAssignment(ids.order);
  const winners = Object.values(byLabel).filter((c) => c === 'offer_accepted' || c === 'claimed');
  check(winners.length === 1, `exactamente un ganador (hubo ${winners.length})`);
  // La asignacion final tiene que corresponder al camino que efectivamente gano.
  const expected = byLabel.accept === 'offer_accepted' ? offer.rider : otherRider;
  check(state.assigned === expected,
    'el Rider asignado es el del camino ganador, no el del perdedor');
  check(state.estimated_entries === 1, `un unico asiento estimated (hay ${state.estimated_entries})`);
  check(state.accepted_offers === 1, `una unica oferta aceptada (hay ${state.accepted_offers})`);
  check(state.jobs === 1, `un unico dispatch job (hay ${state.jobs})`);
}

async function raceAcceptVersusSweep() {
  console.log('\n· Carrera 4 · accept contra el sweep de expiracion');
  const ids = raceFixture('sw');
  const offer = liveOffer(ids.order);
  if (!offer) throw new Error('la carrera 4 no obtuvo oferta');
  psql(`
    update public.dispatch_offers
       set offered_at = clock_timestamp() - interval '2 minutes',
           lease_expires_at = clock_timestamp() + interval '2500 milliseconds'
     where id='${offer.id}';
  `);
  // Envejecer el lease bumpea la version de la oferta. Si el accept viajara con
  // la version previa, la carrera se degradaria a un simple `stale_version` y
  // dejaria de medir el cruce contra el sweep.
  const armed = liveOffer(ids.order);
  if (!armed) throw new Error('la carrera 4 perdio la oferta al armar el lease');

  const barrier = await barrierAt(2400);
  const results = await Promise.all([
    racer('accept', armed.rider, barrier,
      `public.accept_rider_dispatch_offer('${armed.id}','${armed.version}','race-sw-accept-01') ->> 'code'`),
    racer('sweep', null, barrier,
      `public.run_rider_dispatch_cycle(10,'test') ->> 'expired_offers'`),
  ]);
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r.code]));
  console.log(`  codigos: ${JSON.stringify(byLabel)}`);

  const state = orderAssignment(ids.order);
  const accepted = byLabel.accept === 'offer_accepted';
  check(accepted ? state.assigned !== null : state.assigned === null,
    'el resultado del accept y la asignacion del pedido coinciden');
  check(state.estimated_entries <= 1, `nunca mas de un asiento estimated (hay ${state.estimated_entries})`);
  check(state.accepted_offers <= 1, `nunca mas de una oferta aceptada (hay ${state.accepted_offers})`);
  check(state.jobs === 1, `un unico dispatch job (hay ${state.jobs})`);
}

// ---------------------------------------------------------------------------

async function main() {
  const reuse = process.env.TABA_DISPATCH_REUSE === '1' && containerRunning();
  if (reuse) console.log('· Reutilizando contenedor existente');
  else provision();

  console.log('\n· Contrato de runtime');
  // Las verificaciones del contrato salen como NOTICE, es decir por stderr.
  const contract = runContract();
  const notices = contract.split('\n').filter((line) => line.includes('OK'));
  for (const line of notices) console.log(`  ${line.replace(/^NOTICE:\s*/, '')}`);
  check(contract.includes('TODAS LAS VERIFICACIONES PASARON'), 'contrato de runtime completo');

  await raceDoubleTap();
  await raceStaleVersusFresh();
  await raceAcceptVersusOverride();
  await raceAcceptVersusSweep();

  console.log('');
  if (failures.length > 0) {
    console.error(`RESULTADO: FAIL (${failures.length})`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('RESULTADO: PASS · contrato y carreras reales verdes');
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
