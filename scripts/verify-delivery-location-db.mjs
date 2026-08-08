// Verifica el contrato de ubicación confirmada CONTRA POSTGRESQL DE VERDAD.
//
// POR QUÉ EXISTE
// --------------
// La regla que importa —«ningún pedido delivery sin punto confirmado»— vive en
// funciones PL/pgSQL y en un trigger diferido. Nada de eso se puede probar con
// dobles en Node: o se ejecuta contra un motor real, o lo que se está afirmando
// es una intención, no un hecho.
//
// Corre sobre una base EFÍMERA dentro del contenedor local, creada y destruida
// por esta misma herramienta. No toca producción, no toca staging y no lee datos
// reales: siembra sus propios fixtures y hace rollback.
//
// Uso:  TABA_LOCAL_LOCATION_DB=1 node scripts/verify-delivery-location-db.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_LOCATION_DB !== '1') {
  console.error('Esta verificación es local. Ejecutar con TABA_LOCAL_LOCATION_DB=1.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const container = resolveContainer();
// Modo de iteración: conserva la base entre corridas para no reconstruir 61
// migraciones ni reiniciar el contenedor en cada intento. No es el modo por
// defecto: una certificación se hace sobre una base recién construida.
const reuse = process.env.TABA_LOCATION_DB_REUSE === '1';
const database = reuse
  ? 'taba2_location_verify_reuse'
  : `taba2_location_verify_${process.pid}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => path.join(root, 'supabase', 'migrations', name));

function resolveContainer() {
  const requested = String(process.env.TABA_SUPABASE_DB_CONTAINER || '').trim();
  if (requested) return requested;
  const running = execFileSync(dockerCommand, ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name.startsWith('supabase_db_'));
  if (!running.length) {
    console.error('No hay un contenedor supabase_db_* corriendo. Levantá Supabase local primero.');
    process.exit(2);
  }
  return running[0];
}

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
    '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t',
  ], { cwd: root, encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'inherit'] });
}

function waitForDatabaseContainer(timeoutMs = 120000) {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('el contenedor de base no volvió a estar disponible');
  }
}

// pg_cron sólo deja instalar la extensión desde la base indicada por
// `cron.database_name`, que es postmaster-level. Sin esto, la migración
// 20260803120000 aborta y ninguna migración posterior se aplica. Se apunta el
// GUC del clúster LOCAL a la base efímera y se restaura al terminar: las
// migraciones se aplican exactamente como están escritas.
function setClusterCronDatabase(name) {
  const value = name === null ? 'postgres' : name;
  execFileSync(dockerCommand, ['exec', '-u', 'root', container, 'sh', '-c',
    `sed -i "s|^cron.database_name = .*|cron.database_name = '${value}'|" ${CRON_CONF}`], { cwd: root, stdio: 'pipe' });
  execFileSync(dockerCommand, ['restart', container], { cwd: root, stdio: 'pipe' });
  waitForDatabaseContainer();
  const active = execFileSync(dockerCommand, ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c',
    'show cron.database_name;'], { cwd: root, encoding: 'utf8' }).trim();
  if (active !== value) {
    throw new Error(`el fixture de cron no tomó efecto: cron.database_name=${active} esperado=${value}`);
  }
}

function databaseExists() {
  return execFileSync(dockerCommand, [
    'exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t',
    '-c', `select 1 from pg_database where datname = '${database}';`,
  ], { cwd: root, encoding: 'utf8' }).trim() === '1';
}

try {
  if (!reuse || !databaseExists()) {
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
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations(
        version text primary key, name text, statements text[]);
    `);
    // Staging tiene ocupada la versión 20260804090000 por una migración que no
    // existe en este repositorio: la que creó el esquema `private` y el trigger
    // que fotografía la ubicación del pedido. Migraciones posteriores de ESTE
    // repositorio la consumen (`private.rider_map_location_payload`), así que
    // una base sin esos objetos no representa a staging y ni siquiera termina de
    // aplicar la cadena. Se instala el fixture reconstruido en el mismo punto en
    // que staging lo tiene.
    //
    // Que esté presente importa para lo que se certifica: su CHECK sobre
    // `customer_source` acepta sólo manual/gps/geocoder/previous_order/qa_fixture,
    // y es la razón por la que el origen nuevo viaja en columna propia.
    const riderRemoteFixture = fs.readFileSync(
      path.join(root, 'supabase', 'tests', 'fixtures', 'rider_map_location_contracts.remote.sql'), 'utf8',
    );
    let remoteApplied = false;
    for (const migration of migrations) {
      const version = path.basename(migration).slice(0, 14);
      if (!remoteApplied && version > '20260804090000') {
        psql(riderRemoteFixture);
        remoteApplied = true;
        console.log('Fixture remoto rider_map aplicado en la version 20260804090000.');
      }
      psql(fs.readFileSync(migration));
    }
    if (!remoteApplied) psql(riderRemoteFixture);
    console.log(`Migraciones aplicadas: ${migrations.length}`);
  } else {
    console.log(`Reutilizando la base ${database} ya construida.`);
  }

  const output = psqlCapture(
    `set search_path = public, extensions;\n${fs.readFileSync(path.join(root, 'supabase', 'tests', 'delivery_location_confirmation.local.sql'), 'utf8')}`,
  );
  process.stdout.write(output);
  const assertions = [...output.matchAll(/^OK \d+ /gm)].length;
  if (!/^CERTIFICADO /m.test(output)) {
    throw new Error('la verificación de ubicación confirmada no llegó a su declaración final');
  }
  if (!/^TRAZA \d+ 5\. Rider post-claim/m.test(output)) {
    throw new Error('el pedido QA demostrativo no llegó hasta lo que lee el Rider');
  }
  console.log(`\nAfirmaciones verificadas contra PostgreSQL: ${assertions}`);

  // La evidencia se escribe aunque nadie la mire: sin ella, la afirmación
  // «funciona» es una opinión. No contiene datos reales: los fixtures son
  // sintéticos y la base es efímera.
  const evidenceDir = path.join(root, '.taba-evidencia');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, 'delivery-location-confirmation.txt');
  fs.writeFileSync(evidencePath, [
    'TABA2 · confirmación geográfica obligatoria del destino de delivery',
    `base efímera: ${database} (contenedor ${container})`,
    `migraciones aplicadas: ${migrations.length} + fixture del esquema remoto rider_map`,
    `afirmaciones verificadas: ${assertions}`,
    '',
    output.trim(),
    '',
  ].join('\n'), 'utf8');
  console.log(`Evidencia escrita en ${path.relative(root, evidencePath)}`);
} finally {
  if (!reuse) {
    const cleanup = spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database], {
      cwd: root,
      stdio: 'inherit',
    });
    if (cleanup.status !== 0) console.error(`No se pudo eliminar la base temporal: ${database}`);
    try {
      setClusterCronDatabase(null);
    } catch (error) {
      console.error(`No se pudo restaurar el fixture de cron del clúster: ${error.message}`);
    }
  } else {
    console.log(`Base conservada para la próxima iteración: ${database}. `
      + 'Ejecutar sin TABA_LOCATION_DB_REUSE para certificar sobre una base nueva.');
  }
}
