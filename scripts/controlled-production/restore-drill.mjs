// Real backup + restore drill for CONTROLLED_PRODUCTION with pg_dump/pg_restore.
//
// Backup: under ONE exported snapshot, pg_dump (custom format) of the app
// schemas (public, private, supabase_migrations) and of auth.users/identities,
// plus, from that same snapshot, the schema fingerprint and a content hash of
// every table. Files go to a PRIVATE directory outside the repository, with a
// manifest (sizes, sha256, ref, migration head). Nothing secret is printed and
// CONTROLLED_PRODUCTION is only read.
//
// Restore: a disposable local PostgreSQL cluster of the same major version,
// the platform pieces a schema dump does not carry (roles, auth functions,
// extensions schema), pg_restore in dependency order, and then the comparison:
// schema fingerprint category by category (tables, columns, constraints,
// indexes, functions, RLS policies, triggers, table/column/function grants),
// migration ledger, critical functions, catalog/order structures, every
// table's rows, and functional RLS probes as `anon` on the restored copy.
//
//   node scripts/controlled-production/restore-drill.mjs --target controlled-production \
//     --pg-bin <dir with pg_dump, pg_restore, initdb, pg_ctl> --pooler-host <host> [--out file]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { NON_CP_REFS } from './target-keys.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
assert.equal(opt('--target'), 'controlled-production', 'EXPLICIT_TARGET_REQUIRED');
const PG_BIN = opt('--pg-bin');
const HOST = opt('--pooler-host');
const bin = (name) => path.join(PG_BIN, `${name}.exe`);
for (const tool of ['pg_dump', 'pg_restore', 'initdb', 'pg_ctl']) assert.ok(existsSync(bin(tool)), `PG_TOOL_MISSING:${tool}`);
assert.ok(HOST, 'POOLER_HOST_REQUIRED');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'deploy/controlled-production.json'), 'utf8'));
const stored = leerSecreto('CONTROLLED PROD DB PASSWORD');
assert.ok(stored?.secreto && stored.usuario === manifest.supabaseProjectRef && !NON_CP_REFS.has(stored.usuario), 'CP_DB_PASSWORD_NOT_BOUND_TO_CP');
const REF = stored.usuario;
const OUT = opt('--out', path.join(ROOT, 'artifacts', 'controlled-production', `restore-drill-${Date.now()}.json`));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(homedir(), '.taba-backups', 'controlled-production', `pgdump-${stamp}`);
assert.ok(!path.resolve(dir).toLowerCase().startsWith(ROOT.toLowerCase()), 'BACKUP_DIR_CANNOT_BE_IN_REPO');
mkdirSync(dir, { recursive: true });
const FINGERPRINT = readFileSync(path.join(import.meta.dirname, 'schema-fingerprint.sql'), 'utf8');
const SEARCH_PATH = 'set search_path to "$user", public, extensions';
const APP_CATEGORIES = ['tables', 'columns', 'constraints', 'indexes', 'functions', 'policies', 'triggers',
  'table_grants', 'column_grants', 'function_grants'];
const PLATFORM_CATEGORIES = ['cron_jobs', 'realtime_publication', 'storage_buckets'];
const CRITICAL_FUNCTIONS = ['create_order_with_items(jsonb)', 'transition_order(uuid,bigint,text,text)',
  'set_business_open_state(uuid,text)', 'open_qa_window(uuid,integer)', 'close_qa_window(uuid)',
  'close_expired_qa_windows()', 'commerce_availability(uuid,text,jsonb)', 'has_business_role(uuid,text[])',
  'identity_register_session(uuid,text,text,text,text)', 'cancel_order(uuid,bigint,text,text)',
  'confirm_manual_order_payment(uuid,bigint,text,text)', 'accept_rider_order_offer(uuid,bigint,text)',
  'confirm_delivery_code(uuid,bigint,text,text)'];
// Same text rendering of every row on both sides.
const SESSION = `set timezone = 'UTC'; set datestyle = 'ISO, MDY'; set intervalstyle = 'postgres';
  set extra_float_digits = 1; set bytea_output = 'hex'`;
const STRUCTURE_TABLES = ['public.products', 'public.orders', 'public.order_items', 'public.order_events',
  'public.businesses', 'public.catalog_assets', 'public.business_members', 'public.customers'];
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const log = (m) => process.stderr.write(`[restore-drill] ${m}\n`);

const TABLES_SQL = `select format('%I.%I', n.nspname, c.relname) as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and (n.nspname in ('public','private','supabase_migrations')
    or (n.nspname = 'auth' and c.relname in ('users','identities'))) order by 1`;
async function tableHashes(client) {
  await client.query(SESSION);
  const out = {};
  for (const { t } of (await client.query(TABLES_SQL)).rows) {
    const { rows } = await client.query(`select count(*)::int as n, coalesce(md5(string_agg(h, ',' order by h)), '') as h
      from (select md5(x::text) as h from ${t} x) s`);
    out[t] = rows[0];
  }
  return out;
}
async function fingerprint(client) {
  await client.query(SEARCH_PATH);
  const rows = (await client.query(FINGERPRINT)).rows;
  return Object.fromEntries(rows.map((r) => [r.cat, { n: Number(r.n), hash: r.hash, items: r.items }]));
}
function diffCategory(a = { items: {} }, b = { items: {} }) {
  const ia = a.items || {}; const ib = b.items || {};
  return { onlyLive: Object.keys(ia).filter((k) => !(k in ib)), onlyRestored: Object.keys(ib).filter((k) => !(k in ia)),
    changed: Object.keys(ia).filter((k) => k in ib && ia[k] !== ib[k]) };
}

const report = { at: new Date().toISOString(), ref: REF, backup: {}, restore: {}, compare: {}, checks: {} };
const env = { ...process.env, PGPASSWORD: stored.secreto, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '30' };
const live = new pg.Client({ host: HOST, port: 5432, user: `postgres.${REF}`, password: stored.secreto, database: 'postgres',
  ssl: { rejectUnauthorized: false }, statement_timeout: 120_000 });
let cluster = null;
try {
  // ---------- backup under one snapshot ----------
  await live.connect();
  await live.query('begin isolation level repeatable read read only');
  const snapshot = (await live.query('select pg_export_snapshot() as s, now() as at, current_setting(\'server_version\') as v')).rows[0];
  report.backup.snapshotAt = snapshot.at; report.backup.serverVersion = snapshot.v;
  const dump = (file, selection) => {
    const r = spawnSync(bin('pg_dump'), ['-h', HOST, '-p', '5432', '-U', `postgres.${REF}`, '-d', 'postgres',
      `--snapshot=${snapshot.s}`, '-Fc', '-Z', '6', '-f', file, ...selection], { env, encoding: 'utf8', windowsHide: true, timeout: 900_000 });
    if (r.status !== 0) throw Error(`PG_DUMP_FAILED:${path.basename(file)}:${(r.stderr || '').split('\n').find((l) => l.includes('error')) || r.status}`);
    return { file: path.basename(file), bytes: statSync(file).size, sha256: sha(file) };
  };
  const appDump = path.join(dir, 'app.dump');
  const authDump = path.join(dir, 'auth-users.dump');
  report.backup.files = [dump(appDump, ['-n', 'public', '-n', 'private', '-n', 'supabase_migrations']),
    dump(authDump, ['-t', 'auth.users', '-t', 'auth.identities'])];
  log('dumps written');
  const liveFp = await fingerprint(live);
  const liveData = await tableHashes(live);
  const liveMigrations = (await live.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((r) => r.version);
  const liveAnonProducts = (await live.query(`select count(*)::int as n from public.products p where exists (select 1 from public.businesses b
    where b.id = p.business_id and b.is_active and b.status = 'open' and b.ordering_verified and b.ordering_enabled
      and (not b.qa_fixture or b.qa_window_until > now())) and p.is_active and p.is_verified and p.available and p.stock > 0`)).rows[0].n;
  await live.query('commit');
  report.backup.directory = dir.replace(homedir(), '~');
  report.backup.migrations = { count: liveMigrations.length, head: liveMigrations.at(-1) };
  report.backup.tables = Object.keys(liveData).length;
  report.backup.rows = Object.values(liveData).reduce((a, t) => a + t.n, 0);
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ref: REF, ...report.backup,
    fingerprint: Object.fromEntries(Object.entries(liveFp).map(([k, v]) => [k, { n: v.n, hash: v.hash }])), tables: liveData }, null, 2));

  // ---------- disposable local cluster ----------
  const data = mkdtempSync(path.join(tmpdir(), 'taba-restore-'));
  const port = 56000 + Math.floor(Math.random() * 3000);
  const password = randomBytes(18).toString('hex');
  const pw = path.join(data, 'pw');
  writeFileSync(pw, password);
  let r = spawnSync(bin('initdb'), ['-D', path.join(data, 'db'), '-U', 'postgres', '-A', 'scram-sha-256', `--pwfile=${pw}`, '-E', 'UTF8', '--locale=C'],
    { windowsHide: true, stdio: 'ignore', timeout: 180_000 });
  rmSync(pw, { force: true });
  assert.equal(r.status, 0, 'INITDB_FAILED');
  r = spawnSync(bin('pg_ctl'), ['-D', path.join(data, 'db'), '-o', `-p ${port} -c listen_addresses=127.0.0.1`, '-l', path.join(data, 'pg.log'), '-w', 'start'],
    { windowsHide: true, stdio: 'ignore', timeout: 120_000 });
  assert.equal(r.status, 0, 'PG_START_FAILED');
  cluster = { data, stop: () => { spawnSync(bin('pg_ctl'), ['-D', path.join(data, 'db'), '-m', 'fast', '-w', 'stop'], { windowsHide: true, stdio: 'ignore', timeout: 120_000 }); } };
  const local = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' });
  await local.connect();
  // Platform pieces a schema dump does not carry: roles, auth functions, the
  // extensions schema; empty cron/storage/publication so the fingerprint runs.
  await local.query(`
    do $roles$ declare r text; begin
      foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin',
        'supabase_storage_admin','supabase_functions_admin','supabase_realtime_admin','supabase_replication_admin',
        'supabase_read_only_user','dashboard_user','pgbouncer','supabase_etl_admin'] loop
        if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
      end loop; end $roles$;
    drop schema if exists public cascade;
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create extension if not exists "uuid-ossp" with schema extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create schema if not exists auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create or replace function auth.uid() returns uuid language sql stable as
      $f$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $f$;
    create or replace function auth.role() returns text language sql stable as
      $f$ select nullif(coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text $f$;
    create or replace function auth.jwt() returns jsonb language sql stable as
      $f$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $f$;
    create or replace function auth.email() returns text language sql stable as
      $f$ select nullif(coalesce(current_setting('request.jwt.claim.email', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')), '')::text $f$;
    create schema if not exists cron;
    create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, active boolean default true, jobname text);
    create schema if not exists storage;
    create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create publication supabase_realtime;`);
  const restore = (file, sections) => {
    const res = spawnSync(bin('pg_restore'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '--no-owner',
      ...sections.map((s) => `--section=${s}`), file], { env: { ...process.env, PGPASSWORD: password }, encoding: 'utf8', windowsHide: true, timeout: 900_000 });
    const errors = (res.stderr || '').split(/\r?\n/).filter((l) => /error:/i.test(l));
    return { file: path.basename(file), sections, status: res.status, errors: errors.slice(0, 20), errorCount: errors.length };
  };
  report.restore.steps = [
    restore(authDump, ['pre-data', 'data']),
    restore(appDump, ['pre-data', 'data']),
    restore(authDump, ['post-data']),
    restore(appDump, ['post-data']),
  ];
  report.restore.errors = report.restore.steps.reduce((a, s) => a + s.errorCount, 0);
  log(`restored with ${report.restore.errors} errors`);

  // ---------- compare ----------
  const restoredFp = await fingerprint(local);
  for (const cat of APP_CATEGORIES) {
    const liveCat = cat === 'policies'
      ? { items: Object.fromEntries(Object.entries(liveFp[cat]?.items || {}).filter(([k]) => !k.startsWith('storage.'))) }
      : liveFp[cat];
    const d = diffCategory(liveCat, restoredFp[cat]);
    report.compare[cat] = { live: Object.keys(liveCat?.items || {}).length, restored: Object.keys(restoredFp[cat]?.items || {}).length,
      identical: !d.onlyLive.length && !d.onlyRestored.length && !d.changed.length,
      ...(d.onlyLive.length || d.onlyRestored.length || d.changed.length ? { diff: { onlyLive: d.onlyLive.slice(0, 15), onlyRestored: d.onlyRestored.slice(0, 15), changed: d.changed.slice(0, 15) } } : {}) };
  }
  // pg_dump writes a CHECK as text and the restore parses it again: a BETWEEN
  // (stored as a nested AND) comes back with different grouping parentheses. A
  // changed CHECK counts as identical only if re-creating the LIVE definition
  // on the restored copy yields exactly the restored definition.
  const changedChecks = report.compare.constraints.diff?.changed || [];
  if (changedChecks.length && !report.compare.constraints.diff.onlyLive.length && !report.compare.constraints.diff.onlyRestored.length) {
    const DEFS = `select n.nspname || '.' || c.relname || '.' || co.conname as k, n.nspname as s, c.relname as t, co.contype,
      pg_get_constraintdef(co.oid) as def from pg_constraint co join pg_class c on c.oid = co.conrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname || '.' || c.relname || '.' || co.conname = any($1)`;
    await live.query(SEARCH_PATH); await local.query(SEARCH_PATH);
    const liveDefs = Object.fromEntries((await live.query(DEFS, [changedChecks])).rows.map((x) => [x.k, x]));
    const localDefs = Object.fromEntries((await local.query(DEFS, [changedChecks])).rows.map((x) => [x.k, x]));
    const strip = (d) => d.replace(/\s+NOT VALID$/, '');
    const roundTrip = [];
    for (const k of changedChecks) {
      const a = liveDefs[k]; const b = localDefs[k];
      if (!a || !b || a.contype !== 'c' || b.contype !== 'c') { roundTrip.push({ k, equivalent: false }); continue; }
      await local.query('begin');
      await local.query(`create temp table rt_probe (like "${a.s}"."${a.t}")`);
      await local.query(`alter table rt_probe add constraint rt_probe_check ${strip(a.def)} not valid`);
      const again = (await local.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'rt_probe'::regclass and conname = 'rt_probe_check'`)).rows[0].d;
      await local.query('rollback');
      roundTrip.push({ k, equivalent: strip(again) === strip(b.def) && /NOT VALID$/.test(a.def) === /NOT VALID$/.test(b.def) });
    }
    report.compare.constraints.roundTrip = roundTrip;
    if (roundTrip.every((x) => x.equivalent)) {
      report.compare.constraints.identical = true;
      report.compare.constraints.note = `${roundTrip.length} CHECK constraints differ only by the grouping parentheses pg_dump re-parsing gives a BETWEEN; each equals the live definition re-created on the copy`;
    }
  }
  report.compare.platformLevel = Object.fromEntries(PLATFORM_CATEGORIES.map((cat) => [cat, { live: Object.keys(liveFp[cat]?.items || {}) }]));
  report.compare.platformLevel.storagePolicies = Object.keys(liveFp.policies?.items || {}).filter((k) => k.startsWith('storage.'));
  const restoredMigrations = (await local.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((x) => x.version);
  report.compare.migrations = { live: liveMigrations.length, restored: restoredMigrations.length, head: restoredMigrations.at(-1),
    identical: JSON.stringify(liveMigrations) === JSON.stringify(restoredMigrations) };
  report.compare.criticalFunctions = Object.fromEntries(CRITICAL_FUNCTIONS.map((f) => [f,
    Boolean(liveFp.functions?.items?.[f]) && liveFp.functions.items[f] === restoredFp.functions?.items?.[f]]));
  report.compare.structures = Object.fromEntries(STRUCTURE_TABLES.map((t) => {
    const keys = (fp) => Object.entries(fp.columns?.items || {}).filter(([k]) => k.startsWith(`${t}.`));
    const a = keys(liveFp); const b = Object.fromEntries(keys(restoredFp));
    return [t, a.length > 0 && a.every(([k, v]) => b[k] === v) && a.length === Object.keys(b).length];
  }));
  const restoredData = await tableHashes(local);
  const dataDiff = Object.keys(liveData).filter((t) => !restoredData[t] || restoredData[t].n !== liveData[t].n || restoredData[t].h !== liveData[t].h);
  report.compare.data = { tables: Object.keys(liveData).length, rows: report.backup.rows, identical: Object.keys(liveData).length - dataDiff.length, mismatches: dataDiff };

  // Functional RLS on the restored copy, as the anonymous role.
  const probe = async (sql) => { try { await local.query('begin'); await local.query('set local role anon'); const x = await local.query(sql); await local.query('rollback'); return { ok: true, rows: x.rows }; }
    catch (error) { await local.query('rollback').catch(() => {}); return { ok: false, code: error.code }; } };
  const anonProducts = await probe('select count(*)::int as n from public.products');
  const anonCost = await probe('select unit_cost from public.products limit 1');
  const anonOrders = await probe('select count(*)::int as n from public.orders');
  // Positive probe: a QA window opened inside a rolled-back transaction makes that tenant's catalog public.
  await local.query('begin');
  await local.query(`update public.businesses set status = 'open', qa_window_until = now() + interval '10 minutes' where qa_fixture and ordering_enabled`);
  await local.query('set local role anon');
  const windowed = (await local.query('select count(*)::int as n from public.products')).rows[0].n;
  await local.query('rollback');
  report.compare.rls = { anonProducts: anonProducts.rows?.[0]?.n ?? anonProducts.code, liveAnonProducts,
    anonUnitCost: anonCost.ok ? 'READABLE' : anonCost.code, anonOrders: anonOrders.ok ? anonOrders.rows[0].n : anonOrders.code,
    anonProductsDuringQaWindow: windowed };
  await local.end();

  const allApp = APP_CATEGORIES.every((c) => report.compare[c].identical);
  report.checks.DB_BACKUP = report.backup.files.every((f) => f.bytes > 0) ? 'PASS' : 'FAIL';
  report.checks.DB_RESTORE_TEST = report.restore.errors === 0 && report.compare.data.mismatches.length === 0 ? 'PASS' : 'FAIL';
  report.checks.RESTORED_SCHEMA_MATCH = allApp && report.compare.migrations.identical
    && Object.values(report.compare.criticalFunctions).every(Boolean) && Object.values(report.compare.structures).every(Boolean) ? 'PASS' : 'FAIL';
  report.checks.RESTORED_RLS = report.compare.policies.identical && report.compare.tables.identical && report.compare.table_grants.identical
    && report.compare.column_grants.identical && report.compare.rls.anonProducts === liveAnonProducts && report.compare.rls.anonUnitCost === '42501'
    && report.compare.rls.anonOrders === 0 && report.compare.rls.anonProductsDuringQaWindow > 0 ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = error.message;
  await live.query('rollback').catch(() => {});
} finally {
  await live.end().catch(() => {});
  if (cluster) { cluster.stop(); if (!args.includes('--keep')) rmSync(cluster.data, { recursive: true, force: true }); }
}
report.verdict = !report.error && Object.values(report.checks).length === 4 && Object.values(report.checks).every((v) => v === 'PASS') ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, verdict: report.verdict, checks: report.checks, error: report.error || null,
  backup: { directory: report.backup.directory, files: report.backup.files, migrations: report.backup.migrations, tables: report.backup.tables, rows: report.backup.rows },
  restoreErrors: report.restore.errors }));
process.exit(report.verdict === 'PASS' ? 0 : 1);
