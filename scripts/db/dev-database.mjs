#!/usr/bin/env node
// Una base LOCAL que queda viva, armada exactamente como la arma el gate de base de datos.
//
// POR QUÉ EXISTE
//   `npm run test:db:isolated` (scripts/run-release-v5-db.mjs) arma su base, corre todo y la tira: sirve para
//   certificar, no para reproducir un defecto ni para escribir una prueba nueva. Hasta acá, quien quería una base
//   con todas las migraciones para probar a mano dependía de una herramienta suelta en la máquina de otra sesión.
//   Ésta queda en el repositorio y sirve igual en la PC de trabajo, en CI o en una sesión en la nube.
//
// QUÉ HACE
//   `start` levanta un contenedor de la MISMA imagen de Postgres que el gate (por digest), sin red y sin montar
//   nada, y aplica la misma secuencia: las migraciones viejas, el EXPAND de A1-A4 por su ciclo de vida, y todas
//   las posteriores en orden (con las filas fiscales legadas antes de la línea fiscal). No corre los verificadores,
//   ni pgTAP, ni los simulacros: eso es del gate. El contenedor queda vivo.
//   `test <archivo.sql>...` corre archivos pgTAP contra esa base, como el gate (todo pgTAP del repo es
//   transaccional y se deshace). `stop` la borra.
//
//   TABA_LOCAL_PAYMENT_DB=1 node scripts/db/dev-database.mjs start [--name taba-a1-a4-local-dev] [--until <prefijo>]
//   TABA_LOCAL_PAYMENT_DB=1 node scripts/db/dev-database.mjs test supabase/tests/<archivo>_test.sql ...
//   TABA_LOCAL_PAYMENT_DB=1 node scripts/db/dev-database.mjs stop
//
// `--until 20261003090000` deja afuera esa migración y las siguientes: sirve para medir un defecto ANTES del
// arreglo y aplicar después el archivo a mano.
//
// LÍMITES: el contenedor no tiene red, así que no hay PostgREST ni GoTrue (eso lo cubre el certificador sobre el
// stack efímero). Un contenedor que no se llame taba-a1-a4-local-*, que tenga red o un montaje, se rechaza: esto
// nunca apunta a una base ajena.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.166';
export const IMAGE_DIGEST = 'sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86';
export const DEFAULT_NAME = 'taba-a1-a4-local-dev';
export const NAME_PATTERN = /^taba-a1-a4-local-[\w-]+$/;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['start', 'test', 'stop'].includes(command)) throw new Error('uso: dev-database.mjs start|test|stop [opciones]');
  const value = (flag) => {
    const index = rest.indexOf(flag);
    if (index < 0) return null;
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${flag} requiere un valor`);
    return next;
  };
  const name = value('--name') || DEFAULT_NAME;
  if (!NAME_PATTERN.test(name)) throw new Error(`el contenedor tiene que llamarse taba-a1-a4-local-*; llegó «${name}»`);
  const until = value('--until');
  if (until && !/^\d{14}$/.test(until)) throw new Error('--until es un prefijo de migración de 14 dígitos');
  const files = command === 'test'
    ? rest.filter((arg, index) => !arg.startsWith('--') && !['--name', '--until'].includes(rest[index - 1]))
    : [];
  if (command === 'test' && !files.length) throw new Error('test necesita al menos un archivo .sql');
  return { command, name, until, files };
}

const docker = (args, input) => execFileSync('docker', args, {
  cwd: ROOT, input, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
});

function assertDisposable(name) {
  const info = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(info.HostConfig.NetworkMode, 'none', 'el contenedor de pruebas no puede tener red');
  assert.equal(info.Mounts.some((mount) => mount.Type === 'bind'), false, 'el contenedor de pruebas no puede montar nada');
}

async function ensureImage() {
  try { docker(['image', 'inspect', IMAGE]); return; } catch { /* se baja abajo */ }
  for (const source of [`ghcr.io/supabase/postgres@${IMAGE_DIGEST}`, `public.ecr.aws/supabase/postgres@${IMAGE_DIGEST}`]) {
    try {
      docker(['pull', source]);
      docker(['tag', source, IMAGE]);
      assert.ok(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', IMAGE]).includes(IMAGE_DIGEST));
      return;
    } catch { /* la otra fuente */ }
  }
  throw new Error('POSTGRES_IMAGE_UNAVAILABLE_FROM_ALL_SOURCES');
}

async function start({ name, until }) {
  assert.equal(process.env.TABA_LOCAL_PAYMENT_DB, '1', 'TABA_LOCAL_PAYMENT_DB=1 required');
  const { localClient, localSession } = await import('../../tests/fixtures/release-v5-database.mjs');
  const { platformFixture } = await import('../../tests/fixtures/release-v5-platform.mjs');
  const { localContext, buildSources } = await import('../release-v5/identity.mjs');
  const { Lifecycle } = await import('../release-v5/lifecycle.mjs');
  const { EXPAND } = await import('../release-v5/model.mjs');
  await ensureImage();
  try { assertDisposable(name); docker(['rm', '-f', name]); } catch { /* no existía */ }
  // El mismo arranque que el gate: initdb en tmpfs, sin red, pg_cron/pg_net/vault precargados.
  docker(['run', '-d', '--name', name, '--network', 'none', '--user', 'postgres',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=2048m,uid=100,gid=101', '--tmpfs', '/tmp:rw,size=256m',
    '--tmpfs', '/etc/postgresql-custom:rw,size=1m,uid=100,gid=101',
    '--entrypoint', '/bin/sh', IMAGE, '-c',
    'initdb -D /var/lib/postgresql/data/db -U supabase_admin -A trust >/tmp/init.log && postgres -D /var/lib/postgresql/data/db -k /tmp -c listen_addresses=127.0.0.1 -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/lib/postgresql/bin/pgsodium_getkey.sh -c cron.database_name=postgres -c cron.launch_active_jobs=off']);
  for (let attempt = 0; ; attempt++) {
    try { docker(['exec', name, 'pg_isready', '-h', '/tmp', '-U', 'supabase_admin']); break; }
    catch (error) { if (attempt === 100) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  const admin = (sql) => docker(['exec', name, 'psql', '-h', '/tmp', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  admin('create role postgres login superuser createdb createrole');
  admin('create extension pg_cron with schema pg_catalog; grant usage on schema cron to postgres; grant select on cron.job to postgres; grant select, insert, delete on cron.job_run_details to postgres; grant execute on all functions in schema cron to postgres');
  execFileSync(process.execPath, ['--experimental-vm-modules', 'scripts/bootstrap-a1-v2-local.mjs', name], {
    cwd: ROOT, env: process.env, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const client = await localClient(name);
  const query = (sql, args = []) => client.query(sql, args);
  // Como el gate en su modo enfocado: las tres primeras del EXPAND a mano, la cuarta por el ciclo de vida.
  for (const file of EXPAND.slice(0, 3)) await query(fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8'));
  const clear = () => query(`begin; set local session_replication_role=replica;
    truncate public.checkout_sessions,public.payment_intents,public.payment_outbox,public.payment_refunds,
      public.payment_cancellations,public.payment_disputes,public.payment_webhook_receipts,public.payment_events cascade;
    update public.business_payment_settings set enabled=false;
    update public.mp_seller_connections set status='disconnected',protected_tokens=null,refresh_owner=null,refresh_started_at=null;
    delete from public.mp_oauth_states; commit;`);
  await clear();
  await query("select vault.create_secret('fixture-worker-hmac-only-for-local-tests','taba_payment_worker_hmac_secret'); select vault.create_secret('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-payment-worker','taba_payment_worker_url')");
  await query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  for (const file of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((v) => v.endsWith('.sql') && v < '20260909050330').sort()) {
    await query('insert into supabase_migrations.schema_migrations(version,statements) values($1,$2)',
      [file.slice(0, 14), [fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8')]]);
  }
  // Como la plataforma: postgres no es superusuario y cron.job es de supabase_admin.
  await query(`alter database postgres owner to postgres;
    alter table cron.job owner to supabase_admin;
    revoke all on cron.job from postgres; grant select on cron.job to postgres;
    alter function cron.alter_job(bigint,text,text,text,text,boolean) owner to supabase_admin;
    grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to postgres;
    alter table net.http_request_queue owner to supabase_admin;
    alter table net._http_response owner to supabase_admin;
    grant set on parameter session_replication_role to postgres;
    grant anon, authenticated, service_role to postgres with admin option;
    alter role postgres nosuperuser bypassrls createdb createrole;`);
  const { platform } = platformFixture(async (sql, args) => (await query(sql, args)).rows);
  const session = await localSession(name, platform);
  await session.acquire(0);
  await new Lifecycle({ session, platform, context: localContext(ROOT, { requireClean: false }), built: await buildSources() }).expand();
  await session.close();
  await clear();
  execFileSync(process.execPath, ['--experimental-vm-modules', 'scripts/verify-release-v5-local.mjs', name], {
    cwd: ROOT, env: process.env, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const later = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter((v) => v.endsWith('.sql') && v.slice(0, 14) > '20260909050330' && (!until || v.slice(0, 14) < until)).sort();
  let legacyFiscalRows = false;
  for (const file of later) {
    if (!legacyFiscalRows && file.includes('_fiscal_core_')) {
      await query(fs.readFileSync(path.join(ROOT, 'supabase/tests/fixtures/fiscal_core_legacy_rows.sql'), 'utf8'));
      legacyFiscalRows = true;
    }
    await query(fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8'));
  }
  await client.end();
  console.log(`DEV_DATABASE_READY ${name}: ${later.length} migraciones posteriores, la última ${later.at(-1)}`);
}

function test({ name, files }) {
  assertDisposable(name);
  let failed = 0;
  for (const file of files) {
    let output;
    try {
      output = docker(['exec', '-i', name, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
        `set search_path=public,extensions;\n${fs.readFileSync(path.resolve(file), 'utf8')}`);
    } catch (error) {
      failed += 1;
      console.log(`${path.basename(file)}: ERROR ${String(error.stderr || error.message).trim().split('\n')[0]}`);
      continue;
    }
    const plan = /^1\.\.(\d+)$/m.exec(output)?.[1];
    const notOk = output.split('\n').filter((line) => line.startsWith('not ok'));
    if (!plan || notOk.length) failed += 1;
    console.log(`${path.basename(file)}: plan=${plan ?? '?'} not_ok=${notOk.length}`);
    for (const line of notOk) console.log(`  ${line}`);
  }
  if (failed) process.exitCode = 1;
}

function stop({ name }) {
  assertDisposable(name);
  docker(['rm', '-f', name]);
  console.log(`borrado ${name}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (options.command === 'start') await start(options);
  else if (options.command === 'test') test(options);
  else stop(options);
}
