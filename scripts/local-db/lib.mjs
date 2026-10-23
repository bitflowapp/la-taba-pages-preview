// Disposable local PostgreSQL helpers. Refuses anything that is not a loopback cluster created for tests.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Directory with psql/pg_ctl of a PostgreSQL 15+ install (set TABA_PG_BIN). Nothing machine-specific lives in the repo.
export const BIN = process.env.TABA_PG_BIN || '';
export const PORT = Number(process.env.TABA_LOCAL_PG_PORT || 55440);
export const HOST = '127.0.0.1';

const ext = process.platform === 'win32' ? '.exe' : '';

function requireBin() {
  if (!BIN) throw new Error('Set TABA_PG_BIN to the folder that contains psql (a local PostgreSQL install).');
}

export function psqlRaw(db, sql, { tuples = false, check = true, timeout = 180000 } = {}) {
  requireBin();
  if (!/^taba_local_[a-z0-9_]+$/.test(db) && db !== 'postgres') throw new Error('Only disposable taba_local_* databases may be used: ' + db);
  const args = ['-h', HOST, '-p', String(PORT), '-U', 'postgres', '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  if (tuples) args.push('-At');
  const r = spawnSync(path.join(BIN, 'psql' + ext), args, { input: sql, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 });
  if (check && r.status !== 0) {
    const err = new Error(String(r.stderr || r.error).slice(0, 4000));
    err.stderr = r.stderr; err.stdout = r.stdout;
    throw err;
  }
  return r;
}

export function migrationFiles() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => path.join(dir, f));
}

// Managed extensions are replaced by stubs.sql, so their CREATE EXTENSION lines are commented out.
export function localizeMigration(sql) {
  return sql.replace(/create extension if not exists (?:pg_cron|supabase_vault|pg_net)[^;]*;/gi, match => '/* local stub */ select 1; -- ' + match.replace(/\s+/g, ' '));
}

export function bootstrapDatabase(db, { upTo = null } = {}) {
  psqlRaw('postgres', `drop database if exists ${db} with (force); create database ${db};`);
  psqlRaw(db, fs.readFileSync(path.join(ROOT, 'scripts/local-db/stubs.sql'), 'utf8'));
  psqlRaw(db, fs.readFileSync(path.join(ROOT, 'supabase/tests/fixtures/a1-platform-auth.sql'), 'utf8'));
  psqlRaw(db, `grant usage on schema auth, storage to anon, authenticated, service_role;
    grant all on all tables in schema auth, storage to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;`);
  const applied = [];
  for (const file of migrationFiles()) {
    const name = path.basename(file);
    if (upTo && name > upTo) break;
    try {
      psqlRaw(db, 'set search_path=public,extensions;\n' + localizeMigration(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      error.migration = name;
      throw error;
    }
    applied.push(name);
  }
  return applied;
}

// Asynchronous variant for concurrency tests: several sessions run at the same time against one database.
import { spawn } from 'node:child_process';
export function psqlAsync(db, sql, { timeout = 240000 } = {}) {
  requireBin();
  if (!/^taba_local_[a-z0-9_]+$/.test(db)) return Promise.reject(new Error('Only disposable taba_local_* databases may be used: ' + db));
  return new Promise((resolve) => {
    const child = spawn(path.join(BIN, 'psql' + ext), ['-h', HOST, '-p', String(PORT), '-U', 'postgres', '-d', db, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.stdin.end(sql);
  });
}
