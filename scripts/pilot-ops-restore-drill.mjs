/*
 * Simulacro de recuperación y certificación de la superficie operativa.
 *
 * Contesta, con evidencia y sin tocar nada real, tres preguntas que un piloto
 * tiene que poder responder antes de vender:
 *
 *   1. ¿Se puede reconstruir la base desde cero con las migraciones del repo?
 *      Es el camino de recuperación ante desastre. Se replican las migraciones
 *      en orden sobre un Postgres limpio y se aborta al primer corte.
 *   2. ¿Un backup restaura una base equivalente? Se hace `pg_dump` en formato
 *      custom, se restaura en OTRA base y se comparan las huellas de contenido.
 *   3. ¿La superficie operativa sigue diciendo la verdad después de restaurar?
 *      Se corren las mismas aserciones de contrato antes y después.
 *
 * Local-only por construcción: exige confirmación explícita, levanta su propio
 * contenedor efímero y se niega a correr si el entorno apunta a un proyecto
 * hospedado. Los datos son sintéticos: cero datos humanos.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CONFIRMATION = 'I_UNDERSTAND_THIS_IS_LOCAL_ONLY';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = process.env.TABA_PILOT_DRILL_CONTAINER || 'taba2-pilot-ops-drill';
const SOURCE = `${PREFIX}-source`;
// La restauración va a un clúster distinto a propósito: es el escenario real de
// recuperación —proyecto nuevo, esquema desde las migraciones, datos desde el
// backup— y además evita el artefacto de que pg_cron sólo pueda vivir en una
// base por clúster.
const TARGET = `${PREFIX}-target`;
const IMAGE = process.env.TABA_PILOT_DRILL_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.147';
const DB = 'postgres';
// Los datos de la operación viven en estos tres esquemas. `cron`, `extensions`
// y `vault` los provee el clúster nuevo, no el backup.
const DATA_SCHEMAS = ['public', 'auth', 'storage'];
// Bitácoras internas de las migraciones de GoTrue y Storage: las escribe el
// propio servicio al arrancar. Traerlas del backup choca con las del proyecto
// nuevo y no aporta un solo dato de la operación.
const EXCLUDED_TABLES = ['auth.schema_migrations', 'storage.migrations'];
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';

if (String(process.env.TABA_PILOT_RESTORE_DRILL || '').trim() !== CONFIRMATION) {
  console.error(`Definí TABA_PILOT_RESTORE_DRILL=${CONFIRMATION} para correr el simulacro local.`);
  process.exit(2);
}
// Una variable de entorno apuntando a un proyecto hospedado casi siempre
// significa que la terminal quedó preparada para staging. El simulacro no corre
// en ese contexto ni aunque nunca use esas credenciales.
for (const name of ['SUPABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL']) {
  const value = String(process.env[name] || '');
  if (/supabase\.(co|com)/i.test(value) || /^postgres(ql)?:\/\/(?!localhost|127\.0\.0\.1)/i.test(value)) {
    console.error(`${name} apunta fuera de esta máquina. El simulacro es local-only.`);
    process.exit(2);
  }
}

const started = Date.now();
const evidence = {
  declaration: 'TABA2_PILOT_RESTORE_DRILL',
  productionDataUsed: false,
  stagingTouched: false,
  syntheticFixture: 'scripts/sql/pilot-ops-synthetic-fixture.sql',
  image: IMAGE,
  steps: [],
};

function step(name, detail = {}) {
  const entry = { name, at: new Date().toISOString(), ...detail };
  evidence.steps.push(entry);
  console.log(`· ${name}${detail.detail ? ` — ${detail.detail}` : ''}`);
  return entry;
}

function run(args, options = {}) {
  return execFileSync(docker, args, {
    cwd: ROOT,
    encoding: options.encoding === null ? 'buffer' : 'utf8',
    input: options.input,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', options.quiet ? 'pipe' : 'inherit'],
  });
}

function psql(container, sql, user = 'postgres') {
  return run(['exec', '-i', container, 'psql', '-U', user, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql });
}

function query(container, sql) {
  return run([
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', DB,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t',
  ], { input: sql, quiet: true }).trim();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitFor(check, attempts, label) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      if (check()) return;
    } catch (_) { /* todavía no */ }
    sleep(2000);
  }
  throw new Error(`Se agotó la espera de ${label}.`);
}

function cleanup() {
  for (const container of [SOURCE, TARGET]) {
    try { run(['rm', '-f', container], { quiet: true }); } catch (_) { /* ya no está */ }
  }
}

function boot(container) {
  try { run(['rm', '-f', container], { quiet: true }); } catch (_) { /* ya no está */ }
  run(['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE], { quiet: true });
  // El entrypoint corre initdb contra un servidor temporal: hablar antes de que
  // termine deja los objetos creados a merced de los scripts de inicialización.
  waitFor(() => run(['logs', container], { quiet: true }).includes('PostgreSQL init process complete'), 120, 'la inicialización');
  waitFor(() => { run(['exec', container, 'pg_isready', '-U', 'postgres'], { quiet: true }); return true; }, 60, 'Postgres');

  // pg_cron sólo se instala en la base nombrada por el GUC del clúster.
  run(['exec', '-u', 'root', container, 'bash', '-lc',
    `printf "cron.database_name = '${DB}'\\n" > /etc/postgresql-custom/conf.d/taba-drill.conf`], { quiet: true });
  // storage-api crea estas tablas en el proyecto real; acá alcanza con su forma.
  psql(container, `
    create table if not exists storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[], created_at timestamptz not null default now());
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text, owner uuid, created_at timestamptz not null default now(), metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to postgres, service_role, authenticated, anon;
    grant all on storage.buckets, storage.objects to postgres, service_role;
    alter table storage.buckets owner to postgres; alter table storage.objects owner to postgres;
  `, 'supabase_admin');
  if (query(container, "select to_regclass('storage.buckets')") !== 'storage.buckets') {
    throw new Error('No se pudo preparar el esquema de Storage para el simulacro.');
  }
  run(['restart', container], { quiet: true });
  waitFor(() => { run(['exec', container, 'pg_isready', '-U', 'postgres'], { quiet: true }); return true; }, 60, 'Postgres tras reiniciar');
}

function replayMigrations(container) {
  const migrations = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    try {
      psql(container, fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', name), 'utf8'));
    } catch (_) {
      throw new Error(`La cadena de migraciones no es replayable: cortó en ${name}.`);
    }
  }
  return migrations.length;
}

// Huella del contenido operativo. Compara lo que le importa a la operación
// —cuántas filas y qué contienen— y no el orden físico ni los OID, que cambian
// legítimamente en cualquier restauración.
const FINGERPRINT_SQL = `
  select string_agg(entry, E'\\n' order by entry) from (
    select format('%s=%s', t.table_name, (
      xpath('/row/c/text()', query_to_xml(
        format('select count(*) as c from public.%I', t.table_name), false, true, ''))
      )[1]::text) as entry
    from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
  ) counted;
`;

const CONTENT_SQL = `
  select
    (select md5(string_agg(o.id::text || o.status || o.total::text || o.origin, ',' order by o.id)) from public.orders o)
    || '|' || (select md5(coalesce(string_agg(i.id::text || i.quantity::text || i.subtotal::text, ',' order by i.id), '')) from public.order_items i)
    || '|' || (select md5(coalesce(string_agg(p.id::text || p.internal_status || coalesce(p.paid_amount::text, ''), ',' order by p.id), '')) from public.payment_intents p)
    || '|' || (select md5(coalesce(string_agg(a.fingerprint || a.status || a.alert_code, ',' order by a.fingerprint), '')) from public.operational_alerts a)
    || '|' || (select md5(coalesce(string_agg(pr.id::text || pr.name || coalesce(pr.stock::text, ''), ',' order by pr.id), '')) from public.products pr);
`;

const fixtureSql = fs.readFileSync(path.join(ROOT, 'scripts', 'sql', 'pilot-ops-synthetic-fixture.sql'), 'utf8');
const assertionsSql = fs.readFileSync(path.join(ROOT, 'scripts', 'sql', 'pilot-ops-contract-assertions.sql'), 'utf8');

try {
  step('Levantando el clúster de origen', { detail: IMAGE });
  boot(SOURCE);

  let replayStart = Date.now();
  const migrations = replayMigrations(SOURCE);
  step('Reconstrucción desde cero', {
    detail: `${migrations} migraciones replicadas`,
    migrations,
    durationMs: Date.now() - replayStart,
  });
  evidence.rebuildFromMigrations = { ok: true, migrations };

  psql(SOURCE, fixtureSql);
  step('Escenario sintético cargado', { detail: 'cero datos humanos' });

  psql(SOURCE, assertionsSql);
  step('Contrato operativo verificado antes del backup');
  evidence.contractBeforeBackup = { ok: true };

  const sourceFingerprint = query(SOURCE, FINGERPRINT_SQL);
  const sourceContent = query(SOURCE, CONTENT_SQL);

  const dumpStart = Date.now();
  const dump = run(['exec', '-i', SOURCE, 'pg_dump', '-U', 'postgres', '-d', DB,
    '--format=custom', '--data-only',
    ...DATA_SCHEMAS.flatMap((schema) => ['--schema', schema]),
    ...EXCLUDED_TABLES.flatMap((table) => ['--exclude-table', table])],
  { encoding: null, quiet: true });
  const dumpSha256 = crypto.createHash('sha256').update(dump).digest('hex');
  step('Backup tomado', {
    detail: `${(dump.length / 1024 / 1024).toFixed(2)} MB · sha256 ${dumpSha256.slice(0, 16)}…`,
    bytes: dump.length,
    dumpSha256,
    schemas: DATA_SCHEMAS,
    durationMs: Date.now() - dumpStart,
  });

  // Proyecto nuevo: clúster limpio y esquema reconstruido desde las mismas
  // migraciones. Es el camino que un equipo puede ejecutar por su cuenta.
  step('Levantando el clúster de destino', { detail: 'proyecto de recuperación' });
  boot(TARGET);
  replayStart = Date.now();
  const targetMigrations = replayMigrations(TARGET);
  step('Esquema del destino reconstruido', {
    detail: `${targetMigrations} migraciones`,
    durationMs: Date.now() - replayStart,
  });
  // Las migraciones siembran el negocio de referencia y el bucket fiscal; el
  // backup trae los suyos. Se vacía lo que el backup va a repoblar para que la
  // comparación mida la restauración y no la mezcla de las dos.
  psql(TARGET, `
    do $wipe$
    declare v_table record;
    begin
      for v_table in
        select table_schema, table_name from information_schema.tables
         where table_schema in ('public', 'storage')
           and table_type = 'BASE TABLE'
           and table_schema || '.' || table_name <> all (array['storage.migrations'])
      loop
        execute format('truncate table %I.%I cascade', v_table.table_schema, v_table.table_name);
      end loop;
    end;
    $wipe$;`, 'supabase_admin');

  const restoreStart = Date.now();
  run(['exec', '-i', TARGET, 'pg_restore', '-U', 'supabase_admin', '-d', DB,
    '--data-only', '--disable-triggers', '--exit-on-error', '--single-transaction', '--no-owner'],
  { input: dump, quiet: true });
  const restoreDurationMs = Date.now() - restoreStart;
  step('Restauración completada', { detail: `${restoreDurationMs} ms`, durationMs: restoreDurationMs });

  const restoredFingerprint = query(TARGET, FINGERPRINT_SQL);
  const restoredContent = query(TARGET, CONTENT_SQL);
  if (sourceFingerprint !== restoredFingerprint) {
    throw new Error('La base restaurada no tiene la misma cantidad de filas por tabla.');
  }
  if (sourceContent !== restoredContent) {
    throw new Error('El contenido operativo restaurado no coincide con el original.');
  }
  step('Contenido idéntico verificado', {
    detail: `${sourceFingerprint.split('\n').length} tablas comparadas`,
    tables: sourceFingerprint.split('\n').length,
    contentSha256: crypto.createHash('sha256').update(sourceContent).digest('hex'),
  });
  evidence.restoreEquivalence = { ok: true, tables: sourceFingerprint.split('\n').length };

  // La prueba que importa: después de restaurar, ¿el tablero sigue diciendo la
  // verdad? Las mismas aserciones, sobre el proyecto recuperado.
  psql(TARGET, assertionsSql);
  step('Contrato operativo verificado sobre el proyecto recuperado');
  evidence.contractAfterRestore = { ok: true };

  evidence.ok = true;
  evidence.durationMs = Date.now() - started;
  const target = path.join(ROOT, 'artifacts', 'pilot-ops-restore-drill.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nSIMULACRO APROBADO. Evidencia en ${path.relative(ROOT, target)}`);
} catch (error) {
  evidence.ok = false;
  evidence.error = String(error?.message || error);
  console.error(`\nSIMULACRO FALLIDO: ${evidence.error}`);
  process.exitCode = 1;
} finally {
  if (String(process.env.TABA_PILOT_DRILL_KEEP || '') !== '1') cleanup();
}
