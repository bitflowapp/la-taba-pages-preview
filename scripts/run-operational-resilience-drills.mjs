/**
 * Ensayos de resiliencia operativa contra una base PostgreSQL real y descartable.
 *
 * Levanta una base efímera en un contenedor PROPIO, le aplica la cadena completa
 * de migraciones y corre los ensayos de `supabase/tests/operational_resilience_drills.local.sql`:
 * cada condición crítica se provoca de verdad, se mide cuánto tarda el sistema en
 * detectarla sin que nadie abra el Panel, y se comprueba qué pasa cuando el
 * servicio vuelve.
 *
 *   TABA_LOCAL_OPS_DB=1 node scripts/run-operational-resilience-drills.mjs
 *
 * Por qué un contenedor propio y no el stack local que ya esté corriendo: para
 * instalar pg_cron hay que apuntar el GUC `cron.database_name` del CLÚSTER a la
 * base efímera y reiniciar el servidor. Hacer eso sobre el stack de otra sesión
 * le reinicia la base abajo de los pies. El contenedor de acá es propio,
 * descartable y no lo comparte nadie.
 *
 * Nunca toca staging ni producción: sólo habla con el contenedor nombrado.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_OPS_DB !== '1') {
  console.error('Este arnés es local y descartable. Exigimos TABA_LOCAL_OPS_DB=1 para correrlo.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const container = process.env.TABA_OPS_DB_CONTAINER || 'taba2-resilience-db';
const image = process.env.TABA_OPS_DB_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.143';
// De acá sólo se LEE el esquema de plataforma (auth y storage), que la imagen
// desnuda no trae completo. Un pg_dump no muta nada.
const platformContainer = process.env.TABA_OPS_PLATFORM_CONTAINER || 'supabase_db_la-taba-pages';
const database = (process.env.TABA_OPS_DB_NAME || `taba2_ops_${process.pid}`).toLowerCase();
const reuse = process.env.TABA_OPS_DB_REUSE === '1';
const keep = process.env.TABA_OPS_DB_KEEP === '1';
const drillFile = process.argv[2] || path.join('supabase', 'tests', 'operational_resilience_drills.local.sql');
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => path.join(root, 'supabase', 'migrations', name));

function docker(args, options = {}) {
  return execFileSync(dockerCommand, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit',
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

function containerExists() {
  const probe = spawnSync(dockerCommand, ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8' });
  if (probe.status !== 0) return 'missing';
  return probe.stdout.trim() === 'true' ? 'running' : 'stopped';
}

function waitForDatabase(timeoutMs = 180000) {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('la base local no llegó a aceptar conexiones');
  }
}

function ensureContainer() {
  const state = containerExists();
  if (state === 'missing') {
    console.log(`· creando el contenedor ${container}`);
    execFileSync(dockerCommand, [
      'run', '-d', '--name', container,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
      '-e', 'POSTGRES_PASSWORD=postgres',
      image,
    ], { cwd: root, stdio: 'pipe' });
  } else if (state === 'stopped') {
    execFileSync(dockerCommand, ['start', container], { cwd: root, stdio: 'pipe' });
  }
  waitForDatabase();
}

// pg_cron sólo se instala desde la base que indica `cron.database_name`, que es
// del clúster. Se apunta al efímero y se restaura al terminar.
function setClusterCronDatabase(name) {
  const value = name === null ? 'postgres' : name;
  execFileSync(dockerCommand, ['exec', '-u', 'root', container, 'sh', '-c',
    `sed -i "s|^cron.database_name = .*|cron.database_name = '${value}'|" ${CRON_CONF}`], { cwd: root, stdio: 'pipe' });
  execFileSync(dockerCommand, ['restart', container], { cwd: root, stdio: 'pipe' });
  waitForDatabase();
  const active = execFileSync(dockerCommand, ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c',
    'show cron.database_name;'], { cwd: root, encoding: 'utf8' }).trim();
  if (active !== value) throw new Error(`el fixture de pg_cron no tomó: cron.database_name=${active} esperado=${value}`);
}

function loadPlatformSchemas() {
  // `storage.buckets` la crea el servicio storage-api, no la imagen: hace falta
  // para una migración fiscal. Se copia el ESQUEMA desde un stack que la tenga
  // —lectura pura, no lo muta— y se guarda en caché para no depender de que ese
  // stack esté levantado la próxima vez.
  const cache = process.env.TABA_OPS_PLATFORM_DUMP
    || path.join(process.env.TEMP || root, 'taba2-platform-schema.sql');
  let dump = '';
  try {
    dump = execFileSync(dockerCommand, [
      'exec', platformContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only',
      '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges',
    ], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    fs.writeFileSync(cache, dump, 'utf8');
  } catch (error) {
    if (!fs.existsSync(cache)) {
      throw new Error(
        `no se pudo leer el esquema de plataforma de ${platformContainer} ni hay copia en ${cache}. `
        + 'Levantá un stack de Supabase local (docker start) o apuntá TABA_OPS_PLATFORM_DUMP a un volcado.',
      );
    }
    console.log(`· ${platformContainer} no está disponible: se usa la copia de ${cache}`);
    dump = fs.readFileSync(cache, 'utf8');
  }
  psql(dump);
}

/**
 * Dos barridos a la vez. Una sesión toma el lock consultivo y lo sostiene; la
 * otra corre el barrido de verdad y tiene que irse sin escribir nada.
 */
async function proveSweepConcurrencyGuard() {
  const holder = spawn(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t',
  ], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
  let holderOut = '';
  holder.stdout.on('data', (chunk) => { holderOut += chunk.toString(); });
  holder.stdin.write("begin;\nselect pg_advisory_xact_lock(hashtext('taba:operational_alerts_sweep'));\nselect 'LOCK_TOMADO';\n");

  const deadline = Date.now() + 30000;
  while (!holderOut.includes('LOCK_TOMADO')) {
    if (Date.now() > deadline) {
      holder.kill();
      throw new Error('la sesión que sostiene el lock no llegó a tomarlo');
    }
    await sleep(200);
  }

  const before = psqlCapture('select count(*)::text from public.operational_sweep_runs;').trim();
  const blocked = psqlCapture("select public.evaluate_operational_alerts_sweep()->>'status';").trim();
  const after = psqlCapture('select count(*)::text from public.operational_sweep_runs;').trim();

  holder.stdin.write('rollback;\n\\q\n');
  holder.stdin.end();

  if (blocked !== 'skipped') {
    throw new Error(`con otro barrido en curso el segundo debía retirarse; devolvió "${blocked}"`);
  }
  if (before !== after) {
    throw new Error(`el barrido bloqueado escribió igual: ${before} -> ${after}`);
  }
  console.log(`OK    ${'dos barridos simultáneos: el segundo se retira'.padEnd(58, '.')}  status=${blocked}, filas ${before} -> ${after}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * La prueba que sostiene toda la misión: que el barrido corre SOLO.
 *
 * No se llama a la función. Se vacía el registro, se espera, y se mira si
 * apareció una corrida. Si aparece, la escribió el planificador.
 */
async function proveSchedulerRunsTheSweep() {
  psql('truncate table public.operational_sweep_runs;');
  const before = psqlCapture('select count(*)::text from public.operational_sweep_runs;').trim();
  console.log(`· esperando a que el planificador corra el barrido solo (registro en ${before})`);
  const started = Date.now();
  let rows = '0';
  while (Date.now() - started < 150000) {
    await sleep(5000);
    rows = psqlCapture('select count(*)::text from public.operational_sweep_runs;').trim();
    if (Number(rows) > 0) break;
  }
  if (Number(rows) === 0) {
    throw new Error('el planificador no ejecutó el barrido por su cuenta en 150 s');
  }
  const detail = psqlCapture(`
    select r.status || ' · negocios=' || r.businesses_evaluated || ' · hallazgos=' || r.findings
      || ' · ' || round(extract(epoch from (clock_timestamp() - r.started_at))) || ' s atrás'
    from public.operational_sweep_runs r order by r.started_at desc limit 1;
  `).trim();
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`OK    ${'el barrido corre SOLO, sin que nadie lo llame'.padEnd(58, '.')}  ${detail} (esperamos ${seconds} s)`);
}

let cronPointed = false;
try {
  ensureContainer();

  if (!reuse) {
    setClusterCronDatabase(database);
    cronPointed = true;
    docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database]);
    docker(['exec', container, 'createdb', '-U', 'postgres', database]);
    loadPlatformSchemas();
    psql(`
      create schema if not exists extensions;
      grant usage on schema extensions to anon, authenticated, service_role;
      create extension if not exists pgcrypto with schema extensions;
      create schema if not exists vault;
    `);
    console.log(`· aplicando ${migrations.length} migraciones`);
    for (const migration of migrations) psql(fs.readFileSync(migration));
  } else {
    setClusterCronDatabase(database);
    cronPointed = true;
    console.log(`· reutilizando la base ${database}`);
  }

  const scheduled = psqlCapture("select count(*)::text from cron.job where jobname like 'taba-%';").trim();
  console.log(`· tareas propias programadas en el planificador: ${scheduled}`);

  await proveSchedulerRunsTheSweep();

  // A partir de acá el planificador se estaciona: los ensayos manejan el reloj
  // y una corrida automática cayendo en el medio los volvería no deterministas.
  // Las tareas siguen registradas —los ensayos del planificador las necesitan—,
  // sólo deja de ejecutarlas.
  setClusterCronDatabase(null);
  console.log('· planificador estacionado: los ensayos manejan el reloj');

  console.log(`· ensayos: ${drillFile}`);
  psql(fs.readFileSync(path.join(root, drillFile)));
  await proveSweepConcurrencyGuard();

  console.log('\nEnsayos de resiliencia operativa: TODOS VERDES.');
} finally {
  if (!keep) {
    spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database], { stdio: 'ignore' });
    if (cronPointed) {
      try { setClusterCronDatabase(null); } catch { /* el contenedor es descartable */ }
    }
  }
}
