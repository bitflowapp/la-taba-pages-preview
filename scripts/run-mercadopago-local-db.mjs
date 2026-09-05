import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_PAYMENT_DB !== '1') {
  console.error('Refusing to run database tests without TABA_LOCAL_PAYMENT_DB=1. This suite is local-only.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SUPABASE_DB_CONTAINER || 'supabase_db_la-taba-real-orders-staging';
const database = `taba2_mp_verify_${process.pid}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
const restoreDatabase = `${database}_restore`;
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => path.join(root, 'supabase', 'migrations', name));

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
  ], {
    cwd: root,
    encoding: 'utf8',
    input: sql,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function dockerBuffer(args, input) {
  return execFileSync(dockerCommand, args, {
    cwd: root,
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

// Fixture de clúster para pg_cron.
//
// La migración 20260803120000 instala pg_cron y programa el job del worker. pg_cron
// sólo admite ambas cosas desde la base indicada por el GUC `cron.database_name`,
// que es postmaster-level; el harness corre en una base efímera distinta, así que
// la migración abortaba y ninguna de las cinco suites llegaba a ejecutarse.
//
// En vez de modificar la migración —que además todavía no está desplegada en
// staging— se apunta el GUC del clúster LOCAL a la base efímera y se restaura al
// terminar. La migración se aplica exactamente como está escrita.
//
// El rol `postgres` de Supabase no es superusuario, por eso no alcanza ALTER
// SYSTEM: se edita el conf.d del contenedor como root y se reinicia.
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

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
  if (/^not ok\b/m.test(output) || !/^1\.\.[0-9]+$/m.test(output)) {
    throw new Error(`pgTAP did not pass: ${relativePath}`);
  }
}

function databaseSummary(targetDatabase) {
  const output = psqlCapture(`
    select json_build_object(
      'public_tables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
      'public_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
      'restore_marker', (select marker from restore_drill.evidence where id=1),
      'critical_contracts',
        to_regclass('public.orders') is not null
        and to_regclass('public.payment_intents') is not null
        and to_regclass('public.fiscal_documents') is not null
        and to_regclass('public.daily_reconciliations') is not null
        and to_regprocedure('public.finalize_paid_checkout_session(uuid)') is not null
    )::text;
  `, targetDatabase).trim();
  return JSON.parse(output);
}

function writeRestoreReport(report) {
  const requested = String(process.env.TABA_RESTORE_DRILL_REPORT || '').trim();
  if (!requested) return;
  const output = path.resolve(requested);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

try {
  // pg_cron sólo deja instalar la extensión y programar jobs desde la base
  // indicada por `cron.database_name`, que es postmaster-level. Sin esto, la
  // migración 20260803120000 aborta el runner completo y ninguna suite corre.
  // Se apunta el GUC del clúster local a la base efímera y se restaura al final:
  // la migración se aplica tal como está escrita, sin saltos ni excepciones.
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
  for (const migration of migrations) psql(fs.readFileSync(migration));
  psql(fs.readFileSync(path.join(root, 'supabase', 'tests', 'mercadopago_checkout_pro.local.sql')));
  runPgTap(path.join('supabase', 'tests', 'business_windows_scanner_fiscal_test.sql'));
  runPgTap(path.join('supabase', 'tests', 'mercadopago_seller_oauth.local.sql'));
  runPgTap(path.join('supabase', 'tests', 'fiscal_document_closure_test.sql'));
  runPgTap(path.join('supabase', 'tests', 'production_operations_control_plane_test.sql'));
  runPgTap(path.join('supabase', 'tests', 'durable_offline_packing_test.sql'));
  runPgTap(path.join('supabase', 'tests', 'public_tracking_gps_quality_test.sql'));
  runPgTap(path.join('supabase', 'tests', 'business_timezone_windows_test.sql'));
  // El día completo se escribe 00:00-24:00 y el canal de alcohol NO se abre por
  // eso. Corre acá porque es el único lugar del repositorio donde las funciones
  // de horario se ejercitan contra un Postgres de verdad, con las 118
  // migraciones aplicadas y el huso del comercio decidiendo.
  runPgTap(path.join('supabase', 'tests', 'horario_24x7_test.sql'));
  // La puerta que CREA productos. Es SECURITY DEFINER y hace INSERT: leer su
  // texto no alcanza, hay que ejercitarla con identidades reales —anon, un
  // autenticado sin membresia, el owner de otro comercio— y comprobar la forma
  // exacta de la fila que deja.
  runPgTap(path.join('supabase', 'tests', 'alta_propuesta_comercial_test.sql'));
  psql(`
    create schema restore_drill;
    create table restore_drill.evidence(id integer primary key, marker text not null);
    insert into restore_drill.evidence(id,marker)
    values(1,'TABA2_SYNTHETIC_RESTORE_DRILL_V1');
  `);
  const sourceSummary = databaseSummary(database);
  const restoreStarted = performance.now();
  // El drill excluye las extensiones de plataforma que instala 20260803120000:
  // pg_cron, supabase_vault y pg_net. Las tres marcan tablas propias como
  // configuración (cron.job, vault.secrets, net.http_request_queue), así que
  // pg_dump arrastra su contenido y pg_restore falla con `permission denied`:
  // el rol `postgres` de Supabase no es superusuario. pg_cron además sólo puede
  // instalarse en la base de `cron.database_name`, y el restore usa otra.
  //
  // Son estado del clúster, no contrato de la aplicación. El drill sigue
  // probando lo que debe: que el esquema de negocio —tablas, funciones y los
  // contratos críticos que verifica databaseSummary— sobrevive íntegro un
  // dump/restore.
  const archive = dockerBuffer([
    'exec', container, 'pg_dump', '-U', 'postgres', '-d', database,
    '--format=custom', '--no-owner', '--no-privileges',
    '--exclude-extension=pg_cron', '--exclude-schema=cron',
    '--exclude-extension=supabase_vault', '--exclude-schema=vault',
    '--exclude-extension=pg_net', '--exclude-schema=net',
  ]);
  const dumpSha256 = crypto.createHash('sha256').update(archive).digest('hex');
  docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', restoreDatabase]);
  docker(['exec', container, 'createdb', '-U', 'postgres', restoreDatabase]);
  dockerBuffer([
    'exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', restoreDatabase,
    '--no-owner', '--no-privileges', '--exit-on-error',
  ], archive);
  const restoredSummary = databaseSummary(restoreDatabase);
  if (JSON.stringify(sourceSummary) !== JSON.stringify(restoredSummary) || restoredSummary.critical_contracts !== true) {
    throw new Error('Isolated restore drill did not reproduce the critical database contract.');
  }
  const restoreDurationMs = Math.round(performance.now() - restoreStarted);
  writeRestoreReport({
    schemaVersion: 1,
    scope: 'isolated-local-postgresql',
    productionDataUsed: false,
    migrationsApplied: migrations.length,
    dumpSizeBytes: archive.length,
    dumpSha256,
    restoreDurationMs,
    sourceSummary,
    restoredSummary,
    passed: true,
  });
  console.log(`Integrated PostgreSQL lifecycle and restore drill verified (${archive.length} bytes, ${restoreDurationMs} ms).`);
} finally {
  for (const temporaryDatabase of [restoreDatabase, database]) {
    const cleanup = spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', temporaryDatabase], {
      cwd: root,
      stdio: 'inherit',
    });
    if (cleanup.status !== 0) console.error(`Temporary local database cleanup failed: ${temporaryDatabase}`);
  }
  try {
    setClusterCronDatabase(null);
  } catch (error) {
    console.error(`Cluster cron fixture restore failed: ${error.message}`);
  }
}
