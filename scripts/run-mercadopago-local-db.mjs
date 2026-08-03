import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_PAYMENT_DB !== '1') {
  console.error('Refusing to run database tests without TABA_LOCAL_PAYMENT_DB=1. This suite is local-only.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SUPABASE_DB_CONTAINER || 'supabase_db_la-taba-real-orders-staging';
const database = `taba2_mp_verify_${process.pid}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
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

function psql(sql) {
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql });
}

function psqlCapture(sql) {
  return execFileSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t',
  ], {
    cwd: root,
    encoding: 'utf8',
    input: sql,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function runPgTap(relativePath) {
  const sql = `set search_path = public, extensions;\n${fs.readFileSync(path.join(root, relativePath), 'utf8')}`;
  const output = psqlCapture(sql);
  process.stdout.write(output);
  if (/^not ok\b/m.test(output) || !/^1\.\.[0-9]+$/m.test(output)) {
    throw new Error(`pgTAP did not pass: ${relativePath}`);
  }
}

try {
  docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', database]);
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
  `);
  for (const migration of migrations) psql(fs.readFileSync(migration));
  psql(fs.readFileSync(path.join(root, 'supabase', 'tests', 'mercadopago_checkout_pro.local.sql')));
  runPgTap(path.join('supabase', 'tests', 'business_windows_scanner_fiscal_test.sql'));
  runPgTap(path.join('supabase', 'tests', 'fiscal_document_closure_test.sql'));
  runPgTap(path.join('supabase', 'tests', 'production_operations_control_plane_test.sql'));
  console.log(`Integrated PostgreSQL lifecycle verified in isolated local database ${database}.`);
} finally {
  const cleanup = spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', database], {
    cwd: root,
    stdio: 'inherit',
  });
  if (cleanup.status !== 0) console.error(`Temporary local database cleanup failed: ${database}`);
}
