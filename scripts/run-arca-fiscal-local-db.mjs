// Circuito fiscal ARCA contra una PostgreSQL local y desechable.
//
// Levanta su propio contenedor, aplica las migraciones del repositorio en orden
// y corre las suites pgTAP fiscales. No toca staging, no toca produccion y no
// habla con ARCA: verifica el contrato de base que sostiene el circuito.
//
//   node scripts/run-arca-fiscal-local-db.mjs
//   node scripts/run-arca-fiscal-local-db.mjs --keep   (deja el contenedor vivo)

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_ARCA_FISCAL_CONTAINER || 'taba2-arca-fiscal-pg';
const image = process.env.TABA_ARCA_FISCAL_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.147';
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const keepContainer = process.argv.includes('--keep');
const reuseContainer = process.argv.includes('--reuse');

const SUITES = [
  'supabase/tests/arca_fiscal_automation_test.sql',
  'supabase/tests/fiscal_document_closure_test.sql',
  'supabase/tests/business_windows_scanner_fiscal_test.sql',
];

// Defecto PREEXISTENTE, ajeno a la facturacion: 20260806160000 hace CREATE OR
// REPLACE de get_rider_queue cambiando sus columnas OUT, cosa que PostgreSQL no
// permite. En staging ya esta aplicada, pero una base nueva no se puede
// construir sin soltar antes la version previa. Se sortea aca, en el harness
// local, y NO se reescribe la migracion historica.
const PRE_MIGRATION_FIXES = new Map([
  ['20260806160000_order_qa_origin_classification.sql', 'drop function if exists public.get_rider_queue(uuid);'],
]);

function psql(sql, role = 'postgres') {
  const result = spawnSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', role, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q',
  ], { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    throw new Error(`psql fallo con codigo ${result.status}`);
  }
  return result.stdout;
}

function psqlCapture(sql) {
  const result = spawnSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-X', '-A', '-t',
  ], { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// El bootstrap de la imagen levanta PostgreSQL, corre initdb y lo REINICIA. Una
// sola consulta exitosa no significa que la base este lista: hay que esperar el
// healthcheck del contenedor y despues varias consultas seguidas sin caidas.
function waitHealthy(timeoutMs = 240_000) {
  const started = Date.now();
  let stable = 0;
  for (;;) {
    const health = spawnSync(dockerCommand, ['inspect', '-f', '{{.State.Health.Status}}', container], { encoding: 'utf8' });
    const status = String(health.stdout || '').trim();
    if (status === 'healthy' || status === '' || status === '<no value>') {
      const query = spawnSync(dockerCommand, ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], { encoding: 'utf8' });
      stable = query.status === 0 ? stable + 1 : 0;
      if (stable >= 5) return;
    } else {
      stable = 0;
    }
    if (Date.now() - started > timeoutMs) throw new Error('la base local nunca quedo disponible');
    sleep(1000);
  }
}

function startContainer() {
  if (reuseContainer) {
    const running = spawnSync(dockerCommand, ['inspect', '-f', '{{.State.Running}}', container], { encoding: 'utf8' });
    if (running.status === 0 && String(running.stdout).trim() === 'true') return false;
  }
  spawnSync(dockerCommand, ['rm', '-f', container], { encoding: 'utf8' });
  execFileSync(dockerCommand, ['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=postgres', image], {
    cwd: root, encoding: 'utf8', stdio: 'pipe',
  });
  return true;
}

// La imagen base trae auth y storage a medias: los esquemas existen pero las
// tablas y columnas que crean GoTrue y Storage en su propio ciclo, no. Se
// completan aca, como fixture del harness, sin tocar ninguna migracion.
function installPlatformFixture() {
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
  `);
  // La imagen trae event triggers de GraphQL y PostgREST que sólo sirven para
  // avisarle a servicios que aquí no corren, y que se caen a mitad de una tanda
  // larga de DDL. Se sueltan en el harness; no son contrato de la aplicación.
  psql(`
    drop event trigger if exists issue_pg_graphql_access;
    drop event trigger if exists issue_graphql_placeholder;
    drop event trigger if exists pgrst_ddl_watch;
    drop event trigger if exists pgrst_drop_watch;
  `, 'supabase_admin');
  psql(`
    create schema if not exists storage;
    create table if not exists storage.buckets(
      id text primary key, name text not null, owner uuid, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[],
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table if not exists storage.objects(
      id uuid primary key default extensions.gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    alter table storage.objects enable row level security;
    grant all on schema storage to postgres;
    grant all on all tables in schema storage to postgres;
    alter table auth.users add column if not exists email_confirmed_at timestamptz;
    alter table auth.users add column if not exists phone text;
    alter table auth.users add column if not exists phone_confirmed_at timestamptz;
    alter table auth.users add column if not exists banned_until timestamptz;
    alter table auth.users add column if not exists deleted_at timestamptz;
    alter table auth.users add column if not exists is_anonymous boolean not null default false;
    grant all on schema auth to postgres;
    grant all on all tables in schema auth to postgres;
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
  `, 'supabase_admin');
}

function applyMigrations() {
  const directory = path.join(root, 'supabase', 'migrations');
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    const fix = PRE_MIGRATION_FIXES.get(name);
    if (fix) psql(fix);
    psql(fs.readFileSync(path.join(directory, name), 'utf8'));
  }
  return files.length;
}

function runSuite(relativePath) {
  const sql = `set search_path = public, extensions;\n${fs.readFileSync(path.join(root, relativePath), 'utf8')}`;
  const output = psqlCapture(sql);
  const planned = /^1\.\.(\d+)$/m.exec(output);
  const failed = (output.match(/^not ok\b/gm) || []).length;
  const passed = (output.match(/^ok\b/gm) || []).length;
  const ok = Boolean(planned) && failed === 0 && passed === Number(planned[1]);
  if (!ok) process.stdout.write(output.split('\n').filter((line) => !/^ok /.test(line)).join('\n'));
  return { relativePath, planned: planned ? Number(planned[1]) : 0, passed, failed, ok };
}

let created = false;
try {
  created = startContainer();
  waitHealthy();
  if (created) {
    installPlatformFixture();
    const applied = applyMigrations();
    process.stdout.write(`Migraciones aplicadas sobre una base vacia: ${applied}\n`);
  }
  const results = SUITES.map(runSuite);
  for (const result of results) {
    process.stdout.write(`${result.ok ? 'OK  ' : 'FALLA'} ${result.relativePath}: ${result.passed}/${result.planned}\n`);
  }
  if (results.some((result) => !result.ok)) {
    throw new Error('el contrato fiscal local no quedo verde');
  }
  process.stdout.write('Contrato fiscal local verificado. Homologacion real de ARCA es un paso aparte.\n');
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${error?.message || error}\n`);
} finally {
  if (created && !keepContainer) spawnSync(dockerCommand, ['rm', '-f', container], { encoding: 'utf8' });
}
