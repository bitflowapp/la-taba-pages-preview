#!/usr/bin/env node
/**
 * Runs the Mobbex migration and its SQL contract against the REAL schema, in a disposable local cluster.
 *
 *   TABA_LOCAL_PAYMENT_DB=1 node scripts/mobbex/run-mobbex-db-tests.mjs [--native] [--keep] [--container=<name>]
 *
 * Default: the pinned Supabase Postgres image in Docker, built exactly like the existing payment bench does
 * (scripts/run-release-v5-db.mjs "final cluster"): no network, tmpfs only, no bind mounts, no published ports; roles
 * and auth fixture; every migration in order EXCEPT the Mobbex one.
 *
 * `--native` (fallback when Docker cannot run, e.g. the host has no disk space): a throwaway PostgreSQL started from
 * the PostgreSQL binaries on PATH in MOBBEX_NATIVE_PG_DIR (default: a mobbex-native-pg folder under the OS temp dir), with minimal STUBS of the
 * Supabase-only extensions (pg_cron, pg_net, supabase_vault). Same migrations, same test, a WEAKER fixture than the
 * pinned image: results are reported as such and the Docker bench in CI stays the canonical gate.
 *
 * Then, inside transactions that are ALWAYS rolled back:
 *   run A  fingerprint of every pre-existing function/constraint -> Mobbex migration -> same fingerprint (identical)
 *          -> supabase/tests/mobbex_ledger.local.sql (the contract)
 *   run B  migration -> rollback script -> nothing Mobbex left, orders constraint restored -> migration again
 *   run C  the contract's data followed by the rollback script: it must REFUSE (money was recorded)
 *
 * Everything rolls back, so `--keep` leaves a reusable base: pass `--container=<name>` (or `--native --container=x`)
 * to iterate on the migration or the test in seconds instead of rebuilding ~300 migrations.
 *
 * This is a LOCAL database with fixtures. It proves the ledger's SQL; it says nothing about a real Mobbex account.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EXPAND } from '../release-v5/model.mjs';

assert.equal(process.env.TABA_LOCAL_PAYMENT_DB, '1', 'TABA_LOCAL_PAYMENT_DB=1 required');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION = '20261103010000_mobbex_checkout_foundation.sql';
const ROLLBACK = 'docs/migrations/rollback/20261103010000_mobbex_checkout_foundation.rollback.sql';
// Additive follow-up: needs the foundation, so it is applied INSIDE the test transactions, never into the base cluster.
const ALERT_MIGRATION = '20261103020000_mobbex_operational_alert.sql';
const ALERT_ROLLBACK = 'docs/migrations/rollback/20261103020000_mobbex_operational_alert.rollback.sql';
// Merchant console (panel list + re-read request): additive too, needs the foundation, applied inside the test transactions.
const CONSOLE_MIGRATION = '20261105010000_mobbex_merchant_console.sql';
const CONSOLE_ROLLBACK = 'docs/migrations/rollback/20261105010000_mobbex_merchant_console.rollback.sql';
const image = 'public.ecr.aws/supabase/postgres:17.6.1.166';
const native = process.argv.includes('--native');
const keep = process.argv.includes('--keep');
const given = (process.argv.find((a) => a.startsWith('--container=')) || '').split('=')[1];
const container = native ? 'native' : given || `taba-a1-a4-local-mbx-${process.pid}-${randomUUID().slice(0, 8)}`;
const NATIVE_DIR = (process.env.MOBBEX_NATIVE_PG_DIR || path.join(os.tmpdir(), 'mobbex-native-pg')).replace(/\\/g, '/');
const NATIVE_PORT = Number(process.env.MOBBEX_NATIVE_PG_PORT || 54329);
assert.ok(native || /^taba-a1-a4-local-[\w-]+$/.test(container), 'only a disposable taba-a1-a4-local-* container may be used');

const docker = (args, input) => execFileSync('docker', args, { cwd: ROOT, input, encoding: input === undefined ? 'utf8' : undefined, maxBuffer: 128 * 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const dockerArgs = ['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const nativeArgs = ['-h', '127.0.0.1', '-p', String(NATIVE_PORT), '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const spawnPsql = (input) => native
  ? spawnSync('psql', nativeArgs, { cwd: ROOT, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  : spawnSync('docker', dockerArgs, { cwd: ROOT, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const sql = (text) => {
  const result = spawnPsql(`set search_path=public,extensions;\n${text}`);
  if (result.status !== 0) throw new Error(`psql failed: ${String(result.stderr).split('\n').slice(-12).join('\n')}`);
  return result.stdout;
};
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
// Native mode has stubs for the Supabase-only extensions, so their CREATE EXTENSION statements are skipped.
const STUBBED_EXTENSIONS = /^create extension if not exists (?:pg_cron|pg_net|supabase_vault)\b[^;]*;[ \t]*$/gim;
const migration = (name) => native
  ? read(`supabase/migrations/${name}`).replace(STUBBED_EXTENSIONS, '-- (stubbed in native mode)')
  : read(`supabase/migrations/${name}`);

const FINGERPRINT = `select 'FP=' || md5(coalesce(string_agg(md5(pg_get_functiondef(p.oid)), '' order by n.nspname, p.proname, p.oid::regprocedure::text), '')) ||
  '|' || (select md5(coalesce(string_agg(conrelid::regclass::text || conname || pg_get_constraintdef(oid), '' order by conrelid::regclass::text, conname), ''))
            from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text not in ('orders') and conname not like '%mobbex%' and conrelid::regclass::text not like '%mobbex%')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and p.proname not like '%mobbex%' and p.prokind = 'f'
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');`;

const NATIVE_STUBS = `create role anon; create role authenticated; create role service_role bypassrls;
 create role supabase_auth_admin; create role supabase_storage_admin; create role supabase_admin;
 create schema extensions; create extension pgcrypto with schema extensions; create extension pg_trgm with schema extensions;
 create extension "uuid-ossp" with schema extensions; create extension citext with schema extensions; create extension btree_gist with schema extensions;
 grant usage on schema extensions to anon,authenticated,service_role;
 create schema vault;
 create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, description text, secret text, created_at timestamptz default now());
 create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$ insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id $$;
 create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at from vault.secrets;
 create schema cron;
 create table cron.job(jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432, database text default 'postgres', username text default 'postgres', active boolean default true, jobname text unique);
 create table cron.job_run_details(runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
 create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
 create function cron.schedule(schedule text, command text) returns bigint language sql as $$ insert into cron.job(schedule, command) values (schedule, command) returning jobid $$;
 create function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname = job_name returning true $$;
 create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = job_id returning true $$;
 create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language sql as $$ update cron.job j set schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command), active = coalesce(alter_job.active, j.active) where j.jobid = job_id $$;
 create schema net;
 create table net.http_request_queue(id bigserial primary key, method text, url text, headers jsonb, body bytea, timeout_milliseconds int);
 create table net._http_response(id bigint, status_code int, content_type text, headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz default now());
 create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $$ insert into net.http_request_queue(method, url, headers, body, timeout_milliseconds) values ('POST', url, headers, convert_to(body::text, 'UTF8'), timeout_milliseconds) returning id $$;
 create function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000) returns bigint language sql as $$ select 1::bigint $$;`;

const STORAGE_FIXTURE = `grant usage on schema auth to anon,authenticated,service_role;
 create schema if not exists storage;
 create table if not exists storage.buckets(id text primary key,name text,created_at timestamptz default now(),updated_at timestamptz default now(),public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated,service_role;
 grant all on all tables in schema auth,storage to service_role;
 alter default privileges in schema public grant all on tables to service_role;
 alter default privileges in schema public grant all on sequences to service_role;`;

const WORKER_SECRETS = "select vault.create_secret('fixture-worker-hmac-only-for-local-tests','taba_payment_worker_hmac_secret'); select vault.create_secret('https://example.invalid/functions/v1/mercadopago-payment-worker','taba_payment_worker_url')";

function recordHistory(migrations) {
  sql('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  for (const name of migrations.filter((v) => v.slice(0, 14) < '20260909050330')) {
    sql(`insert into supabase_migrations.schema_migrations(version,statements) values('${name.slice(0, 14)}',array[$q$${migration(name).replace(/\$q\$/g, '$ q $')}$q$])`);
  }
}

function applyAfterInterlock(migrations) {
  sql(migration(EXPAND[3]));
  sql(`insert into supabase_migrations.schema_migrations(version,name,statements) values('${EXPAND[3].slice(0, 14)}','${EXPAND[3].slice(15, -4)}',array['']) on conflict do nothing`);
  let count = 0;
  for (const name of migrations.filter((v) => v.slice(0, 14) > '20260909050330' && v !== MIGRATION && v !== ALERT_MIGRATION && v !== CONSOLE_MIGRATION)) { sql(migration(name)); count += 1; }
  return count;
}

const admin = (text) => docker(['exec', '-i', container, 'psql', '-h', '/tmp', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], Buffer.from(text));

async function buildNative() {
  if (fs.existsSync(path.join(NATIVE_DIR, 'PG_VERSION'))) throw new Error(`${NATIVE_DIR} already holds a cluster: remove it or pass --container=x to reuse it`);
  // stderr se deja pasar: en CI un arranque fallido tiene que explicarse solo.
  execFileSync('initdb', ['-D', NATIVE_DIR, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.appendFileSync(path.join(NATIVE_DIR, 'postgresql.conf'), "\nfsync=off\nsynchronous_commit=off\nfull_page_writes=off\n");
  // En Linux el socket Unix por defecto (/var/run/postgresql) no es escribible para un usuario común: va dentro del clúster descartable.
  const socketDir = process.platform === 'win32' ? '' : ` -c unix_socket_directories=${NATIVE_DIR}`;
  execFileSync('pg_ctl', ['start', '-w', '-D', NATIVE_DIR, '-o', `-p ${NATIVE_PORT} -c listen_addresses=127.0.0.1${socketDir}`, '-l', path.join(NATIVE_DIR, 'server.log')], { stdio: ['ignore', 'ignore', 'inherit'] });
  sql(NATIVE_STUBS);
  sql(read('supabase/tests/fixtures/a1-platform-auth.sql'));
  sql(STORAGE_FIXTURE);
  const all = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((v) => v.endsWith('.sql')).sort();
  for (const name of all.filter((v) => v.slice(0, 14) < '20260908164550')) sql(migration(name));
  for (const name of EXPAND.slice(0, 3)) sql(migration(name));
  sql(WORKER_SECRETS);
  recordHistory(all);
  const count = applyAfterInterlock(all);
  console.log(`BASE_CLUSTER_READY native PostgreSQL with stubbed Supabase extensions; migrations_after_interlock=${count}`);
}

async function buildDocker() {
  try { docker(['image', 'inspect', image]); } catch { throw new Error(`Pinned image missing; pull it as scripts/run-release-v5-db.mjs does (${image}) or use --native`); }
  docker(['run', '-d', '--name', container, '--network', 'none', '--user', 'postgres',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=1024m,uid=100,gid=101', '--tmpfs', '/tmp:rw,size=128m',
    '--tmpfs', '/etc/postgresql-custom:rw,size=1m,uid=100,gid=101', '--entrypoint', '/bin/sh', image, '-c',
    'initdb -D /var/lib/postgresql/data/db -U supabase_admin -A trust >/tmp/init.log && postgres -D /var/lib/postgresql/data/db -k /tmp -c listen_addresses=127.0.0.1 -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/lib/postgresql/bin/pgsodium_getkey.sh -c cron.database_name=postgres -c cron.launch_active_jobs=off']);
  for (let attempt = 0; ; attempt += 1) {
    try { docker(['exec', container, 'pg_isready', '-h', '/tmp', '-U', 'supabase_admin']); break; }
    catch (error) { if (attempt === 100) throw error; await new Promise((r) => setTimeout(r, 100)); }
  }
  admin('create role postgres login superuser createdb createrole');
  admin('create extension pg_cron with schema pg_catalog; grant usage on schema cron to postgres; grant select on cron.job to postgres; grant execute on all functions in schema cron to postgres');
  execFileSync(process.execPath, ['scripts/bootstrap-a1-v2-local.mjs', container], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
  const all = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((v) => v.endsWith('.sql')).sort();
  for (const name of EXPAND.slice(0, 3)) sql(migration(name));
  sql(WORKER_SECRETS);
  recordHistory(all);
  sql(`alter database postgres owner to postgres; alter table cron.job owner to supabase_admin; revoke all on cron.job from postgres; grant select on cron.job to postgres;
    alter function cron.alter_job(bigint,text,text,text,text,boolean) owner to supabase_admin;
    grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to postgres;
    alter table net.http_request_queue owner to supabase_admin; alter table net._http_response owner to supabase_admin;
    grant set on parameter session_replication_role to postgres; grant anon, authenticated, service_role to postgres with admin option;
    alter role postgres nosuperuser bypassrls createdb createrole;`);
  const count = applyAfterInterlock(all);
  console.log(`BASE_CLUSTER_READY pinned Supabase image; migrations_after_interlock=${count} container=${container}`);
}

function runTransaction(label, body) {
  const result = spawnPsql(`set search_path=public,extensions;\nbegin;\n${body}\nrollback;\n`);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) { console.error(output.split('\n').slice(-40).join('\n')); throw new Error(`${label} FAILED`); }
  return output;
}

const objectCount = (tag) => `select '${tag}=' || (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like '%mobbex%') || '/' || (select count(*) from pg_class where relname like 'mobbex\\_%' and relkind='r');`;

let ok = false;
try {
  if (!given) await (native ? buildNative() : buildDocker());
  const before = /FP=(\S+)/.exec(sql(FINGERPRINT))?.[1];
  assert.ok(before, 'fingerprint before');

  const outputA = runTransaction('contract', `${migration(MIGRATION)}\n${FINGERPRINT.replace("select 'FP='", "select 'AFTERFP='")}\n${read('supabase/tests/mobbex_ledger.local.sql')}`);
  const after = /AFTERFP=(\S+)/.exec(outputA)?.[1];
  assert.equal(after, before, 'EVERY PRE-EXISTING FUNCTION AND CONSTRAINT (outside orders.payment_method) MUST BE IDENTICAL AFTER THE MIGRATION');
  const passed = [...outputA.matchAll(/ok - (.+)/g)].map((m) => m[1]);
  assert.match(outputA, /MOBBEX_LEDGER_ALL_PASS/, 'the contract did not finish');
  assert.doesNotMatch(outputA, /FAILED:/);
  console.log(`MOBBEX_LEDGER_CONTRACT: ${passed.length} assertions passed (${native ? 'native PostgreSQL, stubbed extensions' : 'pinned Supabase image'})`);
  console.log('MOBBEX_MP_UNTOUCHED: fingerprint of every pre-existing function and constraint identical before/after');

  const outputB = runTransaction('rollback drill', `${migration(MIGRATION)}
    ${objectCount('UP_OBJECTS')}
    ${read(ROLLBACK)}
    ${objectCount('DOWN_OBJECTS')}
    select 'DOWN_CONSTRAINT=' || pg_get_constraintdef(oid) from pg_constraint where conname='orders_payment_method_valid';
    ${migration(MIGRATION)}
    ${objectCount('REUP_OBJECTS')}`);
  const up = /UP_OBJECTS=(\S+)/.exec(outputB)?.[1];
  assert.equal(/DOWN_OBJECTS=(\S+)/.exec(outputB)?.[1], '0/0', 'rollback leaves Mobbex objects behind');
  assert.doesNotMatch(/DOWN_CONSTRAINT=(.+)/.exec(outputB)?.[1] || '', /mobbex/, 'rollback did not restore the orders constraint');
  assert.equal(/REUP_OBJECTS=(\S+)/.exec(outputB)?.[1], up, 're-applying after rollback differs from the first apply');
  console.log(`MOBBEX_ROLLBACK_DRILL: up(${up}) -> down(0/0) -> up(${up}) PASS`);

  // The rollback refuses once money is recorded: the contract's own data, then the rollback script.
  const contractWithoutEnd = read('supabase/tests/mobbex_ledger.local.sql').replace(/\n\s*raise notice 'MOBBEX_LEDGER_ALL_PASS';[\s\S]*$/, '\nend $$;\n');
  const outputC = spawnPsql(`set search_path=public,extensions;\nbegin;\n${migration(MIGRATION)}\n${contractWithoutEnd}\n${read(ROLLBACK)}\nrollback;`);
  assert.match(`${outputC.stdout}\n${outputC.stderr}`, /ROLLBACK_REFUSED/, 'the rollback must refuse when money was recorded');
  console.log('MOBBEX_ROLLBACK_REFUSES_WITH_MONEY: PASS');

  // Health alert (20261103020000): additive, off by default, wired into the existing alert reconciliation.
  const reconMd5 = `select 'RECON_MD5=' || md5(pg_get_functiondef('public.reconcile_operational_alerts_for_business(uuid)'::regprocedure));`;
  const contract = read('supabase/tests/mobbex_ledger.local.sql');
  const helpers = contract.split('\nselect pg_temp.as_admin();')[0];
  const originalRecon = /RECON_MD5=(\S+)/.exec(sql(reconMd5))?.[1];
  assert.ok(originalRecon, 'md5 of the pre-existing alert reconciliation');
  const outputD = runTransaction('health alert', `${migration(MIGRATION)}
${migration(ALERT_MIGRATION)}
${helpers}
${read('supabase/tests/mobbex_health_alert.local.sql')}`);
  assert.match(outputD, /MOBBEX_HEALTH_ALERT_ALL_PASS/, 'the health alert contract did not finish');
  assert.doesNotMatch(outputD, /FAILED:/);
  console.log(`MOBBEX_HEALTH_ALERT_CONTRACT: ${[...outputD.matchAll(/ok - (.+)/g)].length} assertions passed`);
  const outputE = runTransaction('health alert rollback drill', `${migration(MIGRATION)}
    ${reconMd5.replace('RECON_MD5=', 'BEFORE_ALERT_MD5=')}
    ${migration(ALERT_MIGRATION)}
    ${reconMd5.replace('RECON_MD5=', 'WIRED_MD5=')}
    ${read(ALERT_ROLLBACK)}
    ${reconMd5.replace('RECON_MD5=', 'UNWIRED_MD5=')}
    select 'ALERT_LEFTOVERS=' || (select count(*) from pg_proc where proname in ('list_mobbex_operational_alerts', 'set_mobbex_health_alert'))
      || '/' || (select count(*) from information_schema.columns where table_name = 'mobbex_business_settings' and column_name = 'health_alert_enabled');
    ${migration(ALERT_MIGRATION)}
    ${reconMd5.replace('RECON_MD5=', 'REWIRED_MD5=')}`);
  const md5Of = (tag) => new RegExp(`${tag}=(\\S+)`).exec(outputE)?.[1];
  assert.equal(md5Of('BEFORE_ALERT_MD5'), originalRecon, 'the foundation migration must not change the alert reconciliation');
  assert.notEqual(md5Of('WIRED_MD5'), originalRecon, 'the alert migration must change the reconciliation');
  assert.equal(md5Of('UNWIRED_MD5'), originalRecon, 'the alert rollback must restore the reconciliation byte for byte');
  assert.equal(md5Of('REWIRED_MD5'), md5Of('WIRED_MD5'), 're-applying after rollback differs from the first apply');
  assert.equal(/ALERT_LEFTOVERS=(\S+)/.exec(outputE)?.[1], '0/0', 'the alert rollback leaves objects behind');
  console.log('MOBBEX_HEALTH_ALERT_ROLLBACK_DRILL: reconciliation restored byte for byte, nothing left behind, re-apply identical PASS');

  // Merchant console (20261105010000): isolation between businesses, role gating, honest flags, bounded list.
  const outputF = runTransaction('merchant console', `${migration(MIGRATION)}
${migration(CONSOLE_MIGRATION)}
${helpers}
${read('supabase/tests/mobbex_merchant_console.local.sql')}`);
  assert.match(outputF, /MOBBEX_MERCHANT_CONSOLE_ALL_PASS/, 'the merchant console contract did not finish');
  assert.doesNotMatch(outputF, /FAILED:/);
  console.log(`MOBBEX_MERCHANT_CONSOLE_CONTRACT: ${[...outputF.matchAll(/ok - (.+)/g)].length} assertions passed`);
  const consoleObjects = `select 'CONSOLE_FUNCTIONS=' || (select count(*) from pg_proc where proname in ('mobbex_list_business_payments', 'mobbex_request_business_reconcile'));`;
  const outputG = runTransaction('merchant console rollback drill', `${migration(MIGRATION)}
    ${migration(CONSOLE_MIGRATION)}
    ${consoleObjects.replace('CONSOLE_FUNCTIONS=', 'UP_CONSOLE=')}
    ${read(CONSOLE_ROLLBACK)}
    ${consoleObjects.replace('CONSOLE_FUNCTIONS=', 'DOWN_CONSOLE=')}
    ${migration(CONSOLE_MIGRATION)}
    ${consoleObjects.replace('CONSOLE_FUNCTIONS=', 'REUP_CONSOLE=')}`);
  assert.equal(/UP_CONSOLE=(\S+)/.exec(outputG)?.[1], '2');
  assert.equal(/DOWN_CONSOLE=(\S+)/.exec(outputG)?.[1], '0', 'the console rollback leaves functions behind');
  assert.equal(/REUP_CONSOLE=(\S+)/.exec(outputG)?.[1], '2', 're-applying after rollback differs');
  console.log('MOBBEX_MERCHANT_CONSOLE_ROLLBACK_DRILL: up(2) -> down(0) -> up(2) PASS');
  ok = true;
} finally {
  if (native) {
    if (!keep && !given) { try { execFileSync('pg_ctl', ['stop', '-m', 'immediate', '-D', NATIVE_DIR], { stdio: 'ignore' }); fs.rmSync(NATIVE_DIR, { recursive: true, force: true }); } catch { /* best effort */ } }
    else console.log(`native cluster kept at ${NATIVE_DIR}; reuse with --native --container=x`);
  } else if (!given && !keep) { try { docker(['rm', '-f', container]); } catch { /* already gone */ } }
  else console.log(`container kept: ${container} (reuse with --container=${container})`);
}
process.exit(ok ? 0 : 1);
