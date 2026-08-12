// ============================================================================
//  Certificación del motor comercial: horarios, cobertura, tarifa y mínimo
// ============================================================================
//
//  Corre contra un PostgreSQL REAL, en un contenedor PROPIO y descartable, sobre
//  una base creada VACÍA a la que se le aplica toda la cadena de migraciones.
//  Eso prueba dos cosas a la vez: que el contrato se cumple, y que PROD puede
//  arrancar sin copiar un solo byte de staging.
//
//  NO toca staging. NO toca producción. NO reutiliza el contenedor de otra
//  sesión: pg_cron sólo se instala desde la base que nombra `cron.database_name`,
//  que es del clúster, y cambiarlo en un contenedor ajeno lo reinicia.
//
//  Uso:
//    TABA_LOCAL_BUSINESS_OPS_DB=1 node scripts/run-business-operations-db.mjs
//
//  Variables:
//    TABA_SUPABASE_DB_CONTAINER   contenedor propio (default taba2-business-ops-db)
//    TABA_PLATFORM_SCHEMA_SOURCE  stack Supabase vivo del que se copian los
//                                 esquemas `auth` y `storage` (lectura pura)
//    TABA_BUSINESS_OPS_KEEP=1     no borra la base al terminar (para inspección)
//    TABA_BUSINESS_OPS_REPORT     ruta donde escribir el informe JSON
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_BUSINESS_OPS_DB !== '1') {
  console.error('Refusing to run without TABA_LOCAL_BUSINESS_OPS_DB=1. This suite is local-only.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SUPABASE_DB_CONTAINER || 'taba2-business-ops-db';
const platformSource = process.env.TABA_PLATFORM_SCHEMA_SOURCE || 'supabase_db_la-taba-pages';
const database = `taba2_ops_${process.pid}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => path.join(root, 'supabase', 'migrations', name));

// pgTAP: afirmaciones contadas, plan declarado.
const SUITES = [
  path.join('supabase', 'tests', 'business_operations_delivery_test.sql'),
];

// Cadena real: crea sesiones de checkout y un pedido de verdad. No es pgTAP —
// cada comprobación es un `raise notice` que aborta la corrida si falla.
const CHAINS = [
  path.join('supabase', 'tests', 'business_operations_order_chain.local.sql'),
];

// Sonda con el ROL DE SESIÓN REAL. Va por separado porque necesita otra
// conexión: entra como `authenticator` —el rol de PostgREST— en vez de
// `postgres`. Sin esto, `session_user` es `postgres` y las guardas que
// distinguen una migración de una llamada del navegador dejan pasar todo.
const AUTHENTICATOR_PROBE = path.join('supabase', 'tests', 'business_operations_authenticator_probe.sql');

function docker(args, options = {}) {
  return execFileSync(dockerCommand, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
  });
}

function psql(sql, targetDatabase = database) {
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', targetDatabase, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql });
}

function psqlCapture(sql, targetDatabase = database) {
  return execFileSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', targetDatabase,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t',
  ], { cwd: root, encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'inherit'] });
}

function waitForDatabaseContainer(timeoutMs = 120000) {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('the local database container did not come back');
  }
}

// pg_cron sólo admite `create extension` y `cron.schedule` desde la base que
// nombra el GUC de clúster `cron.database_name`. La migración 20260803120000 lo
// necesita. Se apunta al efímero y se restaura al terminar. El rol `postgres` de
// Supabase no es superusuario, así que no alcanza ALTER SYSTEM: se edita el
// conf.d como root y se reinicia ESTE contenedor, que es propio.
function setClusterCronDatabase(name) {
  const value = name === null ? 'postgres' : name;
  execFileSync(dockerCommand, ['exec', '-u', 'root', container, 'sh', '-c',
    `sed -i "s|^cron.database_name = .*|cron.database_name = '${value}'|" ${CRON_CONF}`], { cwd: root, stdio: 'pipe' });
  execFileSync(dockerCommand, ['restart', container], { cwd: root, stdio: 'pipe' });
  waitForDatabaseContainer();
  const active = execFileSync(dockerCommand, ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c',
    'show cron.database_name;'], { cwd: root, encoding: 'utf8' }).trim();
  if (active !== value) {
    throw new Error(`cluster cron fixture did not take effect: cron.database_name=${active} expected=${value}`);
  }
}

function runPgTap(relativePath) {
  const sql = `set search_path = public, extensions;\n${fs.readFileSync(path.join(root, relativePath), 'utf8')}`;
  const output = psqlCapture(sql);
  process.stdout.write(output);
  const planned = output.match(/^1\.\.([0-9]+)$/m);
  if (/^not ok\b/m.test(output) || !planned) {
    throw new Error(`pgTAP did not pass: ${relativePath}`);
  }
  const ran = (output.match(/^ok [0-9]+/gm) || []).length;
  if (ran !== Number(planned[1])) {
    throw new Error(`pgTAP ran ${ran} assertions but planned ${planned[1]}: ${relativePath}`);
  }
  return ran;
}

// El script aborta con excepción en la primera falla, así que llegar al final es
// la prueba. Se cuentan los OK para poder declarar un número honesto.
function runChain(relativePath) {
  // `raise notice` sale por STDERR, no por stdout: hay que leer los dos o el
  // arnés no ve ni una sola de las comprobaciones que acaba de correr.
  const run = spawnSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X',
  ], {
    cwd: root, encoding: 'utf8',
    input: fs.readFileSync(path.join(root, relativePath), 'utf8'),
  });
  const combined = `${run.stdout || ''}${run.stderr || ''}`;
  process.stdout.write(combined);
  if (run.status !== 0) throw new Error(`the chain aborted: ${relativePath}`);
  const ran = (combined.match(/^NOTICE:\s+OK\s/gm) || []).length;
  if (ran === 0) throw new Error(`the chain produced no assertions: ${relativePath}`);
  return ran;
}

// El fixture y la sonda van en dos conexiones distintas a propósito: el fixture
// necesita poder escribir `business_members` (lo hace como postgres, que es lo
// que hace una migración o una semilla) y la sonda necesita NO poder hacerlo.
function runAuthenticatorProbe() {
  psql(`
    insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,
                           raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      ('e1000000-0000-4000-8000-000000000001','authenticated','authenticated','probe-owner@example.invalid','',now(),'{}','{}',now(),now()),
      ('e1000000-0000-4000-8000-000000000002','authenticated','authenticated','probe-staff@example.invalid','',now(),'{}','{}',now(),now()),
      ('e1000000-0000-4000-8000-000000000003','authenticated','authenticated','probe-outsider@example.invalid','',now(),'{}','{}',now(),now());
    insert into public.businesses(id,name,slug,status,is_active,delivery_enabled,pickup_enabled,currency_code,delivery_fee)
    values ('e2000000-0000-4000-8000-000000000001','Sonda authenticator','sonda-authenticator','open',true,true,true,'ARS',1000);
    insert into public.business_members(business_id,user_id,role,is_active) values
      ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','owner',true),
      ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','staff',true);
    grant usage on schema public to authenticator;
  `);
  // Por TCP y no por socket: el socket usa autenticación `peer`, que exige un
  // usuario del sistema con ese nombre. El contenedor arranca con
  // POSTGRES_HOST_AUTH_METHOD=trust, así que por TCP no hace falta contraseña —y
  // no se le puede poner una: en esta imagen `postgres` no es superusuario y
  // `authenticator` es un rol reservado.
  const run = spawnSync(dockerCommand, [
    'exec', '-i', container,
    'psql', '-U', 'authenticator', '-h', '127.0.0.1', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-X',
  ], {
    cwd: root, encoding: 'utf8',
    input: fs.readFileSync(path.join(root, AUTHENTICATOR_PROBE), 'utf8'),
  });
  const combined = `${run.stdout || ''}${run.stderr || ''}`;
  process.stdout.write(combined);
  if (run.status !== 0) throw new Error(`the authenticator probe failed: ${AUTHENTICATOR_PROBE}`);
  const ran = (combined.match(/^NOTICE:\s+OK\s/gm) || []).length;
  if (ran === 0) throw new Error('the authenticator probe produced no assertions');
  return ran;
}

let assertions = 0;
const started = performance.now();
try {
  setClusterCronDatabase(database);
  docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database]);
  docker(['exec', container, 'createdb', '-U', 'postgres', database]);

  // `auth` y `storage` los crean gotrue y storage-api, no la imagen de Postgres.
  // Se copian SÓLO el esquema (sin datos) desde un stack vivo: es una lectura,
  // no lo muta.
  //
  // Con `TABA_PLATFORM_SCHEMA_FILE` se usa una copia ya guardada en vez de leer
  // el stack de otra sesión. Importa: ese stack puede estar apagado, y
  // encenderlo para leerlo sería tocar algo ajeno para una prueba propia.
  const cachedPlatform = String(process.env.TABA_PLATFORM_SCHEMA_FILE || '').trim();
  const platformSchemas = cachedPlatform
    ? fs.readFileSync(path.resolve(cachedPlatform))
    : execFileSync(dockerCommand, [
      'exec', platformSource, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only',
      '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges',
    ], { maxBuffer: 256 * 1024 * 1024 });
  psql(platformSchemas);
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
  `);

  for (const migration of migrations) psql(fs.readFileSync(migration));

  for (const suite of SUITES) assertions += runPgTap(suite);
  for (const chain of CHAINS) assertions += runChain(chain);
  assertions += runAuthenticatorProbe();

  const contract = JSON.parse(psqlCapture(`
    select json_build_object(
      'migrations', ${migrations.length},
      'service_hours', to_regclass('public.business_service_hours') is not null,
      'service_exceptions', to_regclass('public.business_service_exceptions') is not null,
      'delivery_zones', to_regclass('public.delivery_zones') is not null,
      'config_audit', to_regclass('public.business_config_audit') is not null,
      'business_is_open', to_regprocedure('public.business_is_open(uuid,text,timestamptz)') is not null,
      'resolve_delivery_zone', to_regprocedure('public.resolve_delivery_zone(uuid,double precision,double precision,text)') is not null,
      'commerce_availability', to_regprocedure('public.commerce_availability(uuid,text,jsonb)') is not null
    )::text;
  `).trim());
  if (Object.values(contract).some((value) => value === false)) {
    throw new Error(`missing contract pieces: ${JSON.stringify(contract)}`);
  }

  const durationMs = Math.round(performance.now() - started);
  const report = {
    schemaVersion: 1,
    scope: 'isolated-local-postgresql',
    stagingMutated: false,
    productionDataUsed: false,
    migrationsApplied: migrations.length,
    assertions,
    durationMs,
    contract,
    passed: true,
  };
  const requested = String(process.env.TABA_BUSINESS_OPS_REPORT || '').trim();
  if (requested) {
    const output = path.resolve(requested);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(`Business operations contract verified on an empty database: ${assertions} assertions, ${migrations.length} migrations, ${durationMs} ms.`);
} finally {
  if (process.env.TABA_BUSINESS_OPS_KEEP !== '1') {
    const cleanup = spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database], {
      cwd: root, stdio: 'inherit',
    });
    if (cleanup.status !== 0) console.error(`Temporary local database cleanup failed: ${database}`);
    try {
      setClusterCronDatabase(null);
    } catch (error) {
      console.error(`Cluster cron fixture restore failed: ${error.message}`);
    }
  }
}
