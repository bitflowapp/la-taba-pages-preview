// Arnés local y descartable para el contrato Rider multi-pedido.
//
// Reconstruye TODA la base desde cero —las migraciones del candidato de
// producción más las de esta rama— en una base efímera dentro del contenedor
// local de Supabase, corre las suites pgTAP y borra la base al terminar.
//
// NO habla con staging ni con producción. Sin `TABA_LOCAL_RIDER_DB=1` no arranca.
//
// El GUC `cron.database_name` es postmaster-level y pg_cron sólo se deja
// instalar desde esa base, así que la migración 20260803120000 aborta el
// runner si no se lo apunta a la base efímera. Se hace igual que en
// run-mercadopago-local-db.mjs: se edita el conf.d como root, se reinicia el
// contenedor y se restaura al final. La migración se aplica tal como está.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_RIDER_DB !== '1') {
  console.error('Refusing to run database tests without TABA_LOCAL_RIDER_DB=1. This suite is local-only.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SUPABASE_DB_CONTAINER || 'supabase_db_la-taba-pages';
const database = `taba2_rider_multi_${process.pid}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

const only = process.argv.slice(2).filter((value) => !value.startsWith('-'));
const keepDatabase = process.argv.includes('--keep');

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => path.join(root, 'supabase', 'migrations', name));

const suites = (only.length > 0
  ? only
  : [
      'supabase/tests/rider_multi_order_capacity_test.sql',
      'supabase/tests/rider_multi_order_offer_test.sql',
      'supabase/tests/rider_multi_order_security_test.sql',
      'supabase/tests/rider_multi_order_isolation_test.sql',
    ]
).filter((relative) => fs.existsSync(path.join(root, relative)));

function docker(args, options = {}) {
  return execFileSync(dockerCommand, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input: options.input,
  });
}

function psql(sql, targetDatabase = database) {
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', targetDatabase, '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: sql,
  });
}

function psqlCapture(sql, targetDatabase = database) {
  return execFileSync(
    dockerCommand,
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', targetDatabase, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t'],
    { cwd: root, encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'inherit'] },
  );
}

function waitForDatabaseContainer(timeoutMs = 120000) {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('the local database container did not come back');
  }
}

function setClusterCronDatabase(name) {
  const value = name === null ? 'postgres' : name;
  execFileSync(
    dockerCommand,
    ['exec', '-u', 'root', container, 'sh', '-c', `sed -i "s|^cron.database_name = .*|cron.database_name = '${value}'|" ${CRON_CONF}`],
    { cwd: root, stdio: 'pipe' },
  );
  execFileSync(dockerCommand, ['restart', container], { cwd: root, stdio: 'pipe' });
  waitForDatabaseContainer();
  const active = execFileSync(
    dockerCommand,
    ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c', 'show cron.database_name;'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  if (active !== value) {
    throw new Error(`cluster cron fixture did not take effect: cron.database_name=${active} expected=${value}`);
  }
}

let planned = 0;
let failed = 0;

function runPgTap(relativePath) {
  const sql = `set search_path = public, extensions;\n${fs.readFileSync(path.join(root, relativePath), 'utf8')}`;
  const output = psqlCapture(sql);
  process.stdout.write(output);
  const plan = /^1\.\.([0-9]+)$/m.exec(output);
  const notOk = (output.match(/^not ok\b/gm) || []).length;
  if (!plan || notOk > 0) {
    failed += notOk || 1;
    throw new Error(`pgTAP did not pass: ${relativePath} (${notOk} failing)`);
  }
  planned += Number(plan[1]);
  console.log(`\n[ok] ${relativePath}: ${plan[1]} assertions\n`);
}

try {
  setClusterCronDatabase(database);
  docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database]);
  docker(['exec', container, 'createdb', '-U', 'postgres', database]);

  const platformSchemas = execFileSync(dockerCommand, [
    'exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only',
    '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges',
  ]);
  psql(platformSchemas);
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
  `);

  const started = Date.now();
  for (const migration of migrations) psql(fs.readFileSync(migration));
  console.log(`Applied ${migrations.length} migrations from scratch in ${Math.round((Date.now() - started) / 1000)} s.`);

  psql('create extension if not exists pgtap with schema extensions;');

  const fixture = path.join(root, 'supabase', 'tests', 'rider_multi_order.local.sql');
  if (fs.existsSync(fixture)) psql(fs.readFileSync(fixture));

  for (const suite of suites) runPgTap(suite);

  // Las carreras necesitan conexiones de verdad, asi que van fuera de pgTAP.
  if (only.length === 0) {
    const race = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-rider-multi-order-concurrency.mjs')], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, TABA_RIDER_DB_NAME: database, TABA_SUPABASE_DB_CONTAINER: container },
    });
    if (race.status !== 0) throw new Error('la suite de concurrencia no paso');
  }

  console.log(`\nRIDER MULTI-ORDER LOCAL DB: ${suites.length} suites, ${planned} assertions, ${failed} failing.`);
} finally {
  if (!keepDatabase) {
    const cleanup = spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database], {
      cwd: root,
      stdio: 'inherit',
    });
    if (cleanup.status !== 0) console.error(`Temporary local database cleanup failed: ${database}`);
  } else {
    console.log(`Kept ephemeral database: ${database}`);
  }
  try {
    setClusterCronDatabase(null);
  } catch (error) {
    console.error(`Cluster cron fixture restore failed: ${error.message}`);
  }
}
