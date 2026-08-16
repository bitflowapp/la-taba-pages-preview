// Shadow local de la base productiva: aplica las migraciones autoritativas
// desde cero sobre un cluster propio y descartable, y corre TODAS las suites
// pgTAP del arbol.
//
// No toca staging, ni produccion, ni ningun contenedor ajeno: exige que el
// contenedor destino se llame como el declarado por esta mision.
//
//   node scripts/provision-production-shadow.mjs
//
// Variables:
//   TABA_SHADOW_CONTAINER  contenedor propio (default taba2-prod-shadow)
//   TABA_SHADOW_DATABASE   base destino      (default postgres)
//   TABA_SHADOW_REPORT     ruta del informe JSON

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SHADOW_CONTAINER || 'taba2-prod-shadow';
const database = process.env.TABA_SHADOW_DATABASE || 'postgres';
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';

// Guardia de contenedor: este arnes reinicia y escribe. Solo sobre el propio.
const OWN_CONTAINERS = new Set(['taba2-prod-shadow']);
if (!OWN_CONTAINERS.has(container)) {
  console.error(`ABORTADO: ${container} no es un contenedor de esta mision.`);
  process.exit(2);
}

const migrationDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.readdirSync(migrationDir).filter((n) => n.endsWith('.sql')).sort();

const testDir = path.join(root, 'supabase', 'tests');
const suites = fs.readdirSync(testDir)
  .filter((n) => n.endsWith('_test.sql'))
  .sort();

function psql(sqlBuffer, { capture = false, user = 'postgres' } = {}) {
  const args = ['exec', '-i', container, 'psql', '-U', user, '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-q'];
  if (capture) args.push('-X', '-A', '-t');
  return execFileSync(docker, args, {
    cwd: root,
    input: sqlBuffer,
    encoding: capture ? 'utf8' : undefined,
    maxBuffer: 256 * 1024 * 1024,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'ignore', 'pipe'],
  });
}

function query(sql) {
  return psql(Buffer.from(sql, 'utf8'), { capture: true }).trim();
}

// --- 1. Fixture de plataforma -------------------------------------------------
// La imagen de Supabase trae auth.* pero NO storage.*, porque esas tablas las
// crea el servicio storage-api, no el motor. En produccion existen. Se recrean
// aqui con la forma real para que 20260802170000 (bucket fiscal) aplique tal
// como esta escrita. Es fixture de plataforma, no parte del contrato de TABA.
const PLATFORM_FIXTURE = `
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists vault;
create schema if not exists storage;

-- La imagen trae el auth.users original de GoTrue v1. Un proyecto Supabase real
-- tiene el esquema ya migrado por el servicio auth, con email_confirmed_at y el
-- resto de las columnas modernas. Se completa aqui para que el shadow refleje la
-- forma que tiene produccion; ninguna migracion de TABA las define.
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists phone_confirmed_at timestamptz;
alter table auth.users add column if not exists phone_change text default '';
alter table auth.users add column if not exists phone_change_token varchar(255) default '';
alter table auth.users add column if not exists phone_change_sent_at timestamptz;
alter table auth.users add column if not exists email_change_token_new varchar(255);
alter table auth.users add column if not exists email_change_token_current varchar(255) default '';
alter table auth.users add column if not exists email_change_confirm_status smallint default 0;
alter table auth.users add column if not exists reauthentication_token varchar(255) default '';
alter table auth.users add column if not exists reauthentication_sent_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists is_sso_user boolean not null default false;
alter table auth.users add column if not exists is_anonymous boolean not null default false;

-- Los helpers que trae la imagen son los legacy: solo leen los GUC
-- request.jwt.claim.*. Un proyecto Supabase real lee ademas el JSON completo
-- request.jwt.claims, que es lo que emite PostgREST y lo que usan las suites.
-- Sin esto auth.uid() devuelve null y todo contrato de identidad da falso.
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$fn$;

create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$fn$;

create or replace function auth.email() returns text language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text;
$fn$;

create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$fn$;

-- En un proyecto Supabase real el esquema storage lo posee
-- supabase_storage_admin y postgres es miembro de ese rol; por eso las
-- migraciones pueden insertar buckets y crear policies sobre storage.objects.
grant supabase_storage_admin to postgres;
set local role supabase_storage_admin;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[],
  version text,
  owner_id text,
  user_metadata jsonb
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
reset role;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to postgres, service_role;
`;

function stamp() { return new Date().toISOString(); }

const report = {
  schemaVersion: 1,
  scope: 'shadow-local-from-zero',
  container,
  database,
  startedAt: stamp(),
  migrationsExpected: migrations.length,
  migrationsApplied: 0,
  suites: [],
  assertionsTotal: 0,
  passed: false,
};

console.log(`--- SHADOW ---`);
console.log(`  contenedor : ${container}`);
console.log(`  base       : ${database}`);
console.log(`  migraciones: ${migrations.length}`);
console.log(`  suites     : ${suites.length}`);

// --- 2. Base limpia -----------------------------------------------------------
// El cluster propio arranca vacio; se verifica que no haya esquema de TABA.
const preexisting = query(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');`);
if (Number(preexisting) !== 0) {
  console.error(`ABORTADO: public ya tiene ${preexisting} tablas. El shadow debe nacer vacio.`);
  process.exit(3);
}
console.log(`  public     : 0 tablas (base virgen)`);

psql(Buffer.from(PLATFORM_FIXTURE, 'utf8'), { user: 'supabase_admin' });
console.log(`  fixture    : auth/storage/extensions/vault listos`);

// --- 3. Migraciones desde cero ------------------------------------------------
console.log(`\n--- APLICANDO 0 -> ${migrations.length} ---`);
const digest = crypto.createHash('sha256');
const manifest = [];
for (const [index, name] of migrations.entries()) {
  const body = fs.readFileSync(path.join(migrationDir, name));
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  digest.update(`${name}:${sha}\n`);
  manifest.push({ version: name.slice(0, 14), filename: name, sha256: sha });
  const began = Date.now();
  try {
    psql(body);
  } catch (error) {
    console.error(`\nFALLO en la migracion ${index + 1}/${migrations.length}: ${name}`);
    console.error(String(error.stderr || error.message));
    report.failedMigration = name;
    fs.writeFileSync(reportPath(), `${JSON.stringify(report, null, 2)}\n`);
    process.exit(4);
  }
  report.migrationsApplied += 1;
  const ms = Date.now() - began;
  if (ms > 900) console.log(`  [${String(index + 1).padStart(3)}] ${name}  ${ms}ms`);
}
report.migrationDigest = digest.digest('hex');
report.manifest = manifest;
console.log(`  ${report.migrationsApplied}/${migrations.length} aplicadas sin intervencion manual`);
console.log(`  digest: ${report.migrationDigest}`);

// --- 4. Retrato del esquema (para comparar contra produccion) -----------------
report.schemaSnapshot = JSON.parse(query(`
  select json_build_object(
    'tables',    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
    'views',     (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')),
    'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
    'policies',  (select count(*) from pg_policies where schemaname='public'),
    'indexes',   (select count(*) from pg_indexes where schemaname='public'),
    'triggers',  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
    'enums',     (select count(distinct t.oid) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'),
    'rls_off',   (select coalesce(json_agg(c.relname order by c.relname),'[]'::json) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity)
  )::text;
`));
console.log(`\n--- ESQUEMA RESULTANTE ---`);
for (const [k, v] of Object.entries(report.schemaSnapshot)) {
  console.log(`  ${k.padEnd(10)} ${Array.isArray(v) ? `[${v.length}] ${v.join(', ')}` : v}`);
}

// --- 5. pgTAP -----------------------------------------------------------------
psql(Buffer.from('create extension if not exists pgtap with schema extensions;', 'utf8'));
console.log(`\n--- pgTAP (${suites.length} suites) ---`);
let failed = 0;
for (const suite of suites) {
  const sql = Buffer.concat([
    Buffer.from('set search_path = public, extensions;\n', 'utf8'),
    fs.readFileSync(path.join(testDir, suite)),
  ]);
  let output = '';
  let ok = true;
  try {
    output = psql(sql, { capture: true });
  } catch (error) {
    output = String(error.stdout || '') + String(error.stderr || '');
    ok = false;
  }
  const planMatch = output.match(/^1\.\.(\d+)$/m);
  const notOk = (output.match(/^not ok\b/gm) || []).length;
  const okCount = (output.match(/^ok\b/gm) || []).length;
  if (!planMatch || notOk > 0) ok = false;
  const planned = planMatch ? Number(planMatch[1]) : 0;
  if (ok) report.assertionsTotal += planned; else failed += 1;
  report.suites.push({ suite, planned, ok: okCount, notOk, passed: ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${suite.padEnd(46)} ${okCount}/${planned}`);
  if (!ok) {
    const lines = output.split(/\r?\n/).filter((l) => /^not ok\b|^psql:|ERROR/.test(l));
    for (const line of lines.slice(0, 12)) console.log(`        ${line}`);
  }
}

report.suitesFailed = failed;
report.finishedAt = stamp();
report.passed = failed === 0 && report.migrationsApplied === migrations.length;

function reportPath() {
  return process.env.TABA_SHADOW_REPORT
    || path.join(root, 'artifacts', 'production-supabase', 'SHADOW-LOCAL-FROM-ZERO.json');
}
fs.mkdirSync(path.dirname(reportPath()), { recursive: true });
fs.writeFileSync(reportPath(), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n--- RESULTADO ---`);
console.log(`  migraciones : ${report.migrationsApplied}/${migrations.length}`);
console.log(`  suites      : ${suites.length - failed}/${suites.length}`);
console.log(`  aserciones  : ${report.assertionsTotal}`);
console.log(`  informe     : ${reportPath()}`);
console.log(`  veredicto   : ${report.passed ? 'PASS' : 'FAIL'}`);
process.exit(report.passed ? 0 : 1);
