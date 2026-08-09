/*
 * Base efimera con TODAS las migraciones aplicadas, para medir el circuito de
 * intake y despacho sin tocar staging ni datos de nadie.
 *
 * Reutiliza el fixture de cluster de run-mercadopago-local-db.mjs: pg_cron solo
 * deja instalarse desde la base que indica `cron.database_name` (GUC de
 * postmaster), asi que se apunta al esquema efimero y se restaura al terminar.
 * Las migraciones se aplican tal como estan escritas, sin saltos.
 *
 *   node scripts/run-order-intake-drill.mjs <archivo.sql> [...]
 *   --keep        deja la base viva para seguir midiendo sobre ella
 *   --reuse=NAME  corre contra una base ya construida (no aplica migraciones)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_PAYMENT_DB !== '1') {
  console.error('Falta TABA_LOCAL_PAYMENT_DB=1. Esta suite es solo local.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SUPABASE_DB_CONTAINER || 'supabase_db_la-taba-pages';
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const reuseArg = args.find((a) => a.startsWith('--reuse='));
const reuse = reuseArg ? reuseArg.slice('--reuse='.length) : null;
const sqlFiles = args.filter((a) => !a.startsWith('--'));
const database = reuse || `taba2_intake_${process.pid}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();

function docker(cmdArgs, options = {}) {
  return execFileSync(dockerCommand, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
  });
}

function psql(sql, targetDatabase = database) {
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', targetDatabase, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql });
}

function waitForDatabaseContainer(timeoutMs = 120000) {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('el contenedor de base no volvio');
  }
}

function setClusterCronDatabase(name) {
  const value = name === null ? 'postgres' : name;
  execFileSync(dockerCommand, ['exec', '-u', 'root', container, 'sh', '-c',
    `sed -i "s|^cron.database_name = .*|cron.database_name = '${value}'|" ${CRON_CONF}`], { cwd: root, stdio: 'pipe' });
  execFileSync(dockerCommand, ['restart', container], { cwd: root, stdio: 'pipe' });
  waitForDatabaseContainer();
  const active = execFileSync(dockerCommand, ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c',
    'show cron.database_name;'], { cwd: root, encoding: 'utf8' }).trim();
  if (active !== value) throw new Error(`el fixture de cron no tomo efecto: ${active} != ${value}`);
}

function build() {
  const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => path.join(root, 'supabase', 'migrations', name));
  setClusterCronDatabase(database);
  docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database]);
  docker(['exec', container, 'createdb', '-U', 'postgres', database]);
  const platformSchemas = execFileSync(dockerCommand, [
    'exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only',
    '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges',
  ], { maxBuffer: 64 * 1024 * 1024 });
  psql(platformSchemas);
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
  `);
  for (const migration of migrations) psql(fs.readFileSync(migration));
  console.log(`base efimera lista: ${database} (${migrations.length} migraciones)`);
}

let failed = false;
try {
  if (!reuse) build();
  for (const file of sqlFiles) {
    const full = path.resolve(root, file);
    console.log(`\n=== ${path.relative(root, full)} ===`);
    psql(fs.readFileSync(full));
  }
} catch (error) {
  failed = true;
  console.error(`\nFALLO: ${error.message}`);
} finally {
  if (!keep && !reuse) {
    spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database], {
      cwd: root, stdio: 'inherit',
    });
    try { setClusterCronDatabase(null); } catch (error) {
      console.error(`no se pudo restaurar cron.database_name: ${error.message}`);
    }
  } else if (keep) {
    console.log(`\nbase conservada: ${database} (restaura el cluster con --reuse y luego a mano)`);
  }
}
process.exit(failed ? 1 : 0);
