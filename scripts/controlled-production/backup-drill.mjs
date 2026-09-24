// Logical backup + restore drill for CONTROLLED_PRODUCTION data.
//
// Backup: every table of the business schemas (public, auth users/identities)
// is exported as JSON rows (gzip) plus a manifest (column types, row counts,
// sha256 of the sorted rows) in a PRIVATE directory outside the repo. Sized
// for the controlled rollout (one business, ~30 customers); no extra deps.
// Restore test: a disposable local PostgreSQL 17 cluster is created, each
// table is recreated with the same column types and loaded from the files,
// then counts and sorted-row hashes must match the manifest exactly. The
// schema itself (functions, RLS, grants) is restored from migrations and is
// drilled in CI (database_contracts). Nothing is printed except counts.
//
//   node scripts/controlled-production/backup-drill.mjs --target controlled-production --pg-bin <dir with initdb.exe>
//   node scripts/controlled-production/backup-drill.mjs --self-test --pg-bin <dir>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCHEMAS = ['public', 'auth'];
const AUTH_TABLES = new Set(['users', 'identities']);
const q = (name) => `"${String(name).replaceAll('"', '""')}"`;

export async function listTables(client) {
  const { rows } = await client.query(`
    select c.table_schema, c.table_name,
           json_agg(json_build_object('name', c.column_name,
             'type', format_type(a.atttypid, a.atttypmod)) order by c.ordinal_position) as columns
      from information_schema.columns c
      join pg_attribute a on a.attrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
                         and a.attname = c.column_name
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = any($1) and t.table_type = 'BASE TABLE'
     group by c.table_schema, c.table_name
     order by 1, 2`, [SCHEMAS]);
  return rows.filter((row) => row.table_schema !== 'auth' || AUTH_TABLES.has(row.table_name));
}

// Order-independent fingerprint: sha256 over the sorted canonical JSON rows.
export function fingerprint(rows) {
  const lines = rows.map((row) => JSON.stringify(row)).sort();
  return { rows: lines.length, sha256: createHash('sha256').update(lines.join('\n')).digest('hex') };
}

async function tableRows(client, schema, name) {
  const { rows } = await client.query(`select coalesce(json_agg(t), '[]'::json) as data from ${q(schema)}.${q(name)} t`);
  return rows[0].data;
}

export async function backup(client, dir, meta) {
  mkdirSync(dir, { recursive: true });
  await client.query("set timezone = 'UTC'");
  const tables = await listTables(client);
  const manifest = { ...meta, createdAt: new Date().toISOString(), tables: [] };
  for (const table of tables) {
    const file = `${table.table_schema}.${table.table_name}.json.gz`;
    const data = await tableRows(client, table.table_schema, table.table_name);
    writeFileSync(path.join(dir, file), gzipSync(Buffer.from(JSON.stringify(data))));
    const print = fingerprint(data);
    manifest.tables.push({ schema: table.table_schema, name: table.table_name, columns: table.columns, file, ...print });
  }
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// Plain PostgreSQL has no Supabase extension types; those columns restore as
// text, which still proves the bytes are all there.
const PORTABLE = /^(uuid|text|boolean|integer|bigint|smallint|numeric(\(\d+,\s*\d+\))?|jsonb|json|date|timestamp with time zone|timestamp without time zone|double precision|real|bytea|inet|character varying(\(\d+\))?|text\[\]|uuid\[\]|interval|time without time zone)$/;

export async function restoreAndVerify(client, dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const results = [];
  await client.query("set timezone = 'UTC'");
  for (const table of manifest.tables) {
    await client.query(`create schema if not exists ${q(`restore_${table.schema}`)}`);
    const target = `${q(`restore_${table.schema}`)}.${q(table.name)}`;
    const cols = table.columns.map((c) => `${q(c.name)} ${PORTABLE.test(c.type) ? c.type : 'text'}`).join(', ');
    await client.query(`create table ${target} (${cols})`);
    const rows = JSON.parse(gunzipSync(readFileSync(path.join(dir, table.file))).toString('utf8'));
    await client.query(`insert into ${target} select * from json_populate_recordset(null::${target}, $1::json)`, [JSON.stringify(rows)]);
    const again = fingerprint(await tableRows(client, `restore_${table.schema}`, table.name));
    results.push({ table: `${table.schema}.${table.name}`, rows: table.rows, restoredRows: again.rows,
      identical: again.rows === table.rows && again.sha256 === table.sha256 });
  }
  return results;
}

export function startLocalCluster(pgBin) {
  const bin = (name) => path.join(pgBin, `${name}.exe`);
  assert.ok(existsSync(bin('initdb')) && existsSync(bin('pg_ctl')), 'PORTABLE_POSTGRES_REQUIRED');
  const data = mkdtempSync(path.join(tmpdir(), 'taba-restore-drill-'));
  const port = 55000 + Math.floor(Math.random() * 3000);
  const password = randomBytes(18).toString('hex');
  const pw = path.join(data, '..', `${path.basename(data)}.pw`);
  writeFileSync(pw, password);
  let r = spawnSync(bin('initdb'), ['-D', path.join(data, 'db'), '-U', 'postgres', '-A', 'scram-sha-256', `--pwfile=${pw}`, '-E', 'UTF8'], { windowsHide: true, stdio: 'ignore', timeout: 120_000 });
  rmSync(pw, { force: true });
  assert.equal(r.status, 0, 'INITDB_FAILED');
  // stdio 'ignore': the server inherits pg_ctl's handles, and piped handles
  // would keep spawnSync waiting for the whole life of the server.
  r = spawnSync(bin('pg_ctl'), ['-D', path.join(data, 'db'), '-o', `-p ${port} -c listen_addresses=127.0.0.1`, '-l', path.join(data, 'pg.log'), '-w', 'start'], { windowsHide: true, stdio: 'ignore', timeout: 60_000 });
  assert.equal(r.status, 0, 'PG_START_FAILED');
  return { port, password, stop: () => {
    spawnSync(bin('pg_ctl'), ['-D', path.join(data, 'db'), '-m', 'fast', '-w', 'stop'], { windowsHide: true, stdio: 'ignore', timeout: 60_000 });
    rmSync(data, { recursive: true, force: true });
  } };
}

async function localClient(cluster) {
  const c = new pg.Client({ host: '127.0.0.1', port: cluster.port, user: 'postgres', password: cluster.password, database: 'postgres' });
  await c.connect();
  return c;
}

async function main(args) {
  const opt = (name) => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1]; };
  const pgBin = opt('--pg-bin');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const privateRoot = path.join(homedir(), '.taba-backups', args.includes('--self-test') ? 'self-test' : 'controlled-production');
  const dir = path.join(privateRoot, stamp);
  assert.ok(!path.resolve(dir).toLowerCase().startsWith(ROOT.toLowerCase()), 'BACKUP_DIR_CANNOT_BE_IN_REPO');
  const restoreCluster = startLocalCluster(pgBin);
  let sourceCluster = null;
  let source;
  const report = { at: new Date().toISOString(), mode: args.includes('--self-test') ? 'self-test' : 'controlled-production' };
  try {
    if (args.includes('--self-test')) {
      sourceCluster = startLocalCluster(pgBin);
      source = await localClient(sourceCluster);
      await source.query(`create table public.orders(id uuid primary key default md5(random()::text)::uuid, total numeric(12,2), status text, meta jsonb, created_at timestamptz default now());
        insert into public.orders(total,status,meta) select g, 'delivered', jsonb_build_object('n', g, 'txt', 'coma, "comilla"') from generate_series(1,250) g;`);
    } else {
      const { leerSecreto } = await import('../e2e-production-sale/secretos-windows.mjs');
      const stored = leerSecreto('CONTROLLED PROD DB PASSWORD');
      const host = opt('--pooler-host');
      assert.ok(stored?.usuario?.match(/^[a-z0-9]{20}$/) && host, 'CP_DB_PASSWORD_AND_POOLER_HOST_REQUIRED');
      source = new pg.Client({ host, port: 5432, user: `postgres.${stored.usuario}`, password: stored.secreto,
        database: 'postgres', ssl: { rejectUnauthorized: false } });
      await source.connect();
      report.ref = stored.usuario;
    }
    const manifest = await backup(source, dir, { target: report.mode, ref: report.ref || null });
    report.backup = { directory: dir.replace(homedir(), '~'), tables: manifest.tables.length,
      rows: manifest.tables.reduce((a, t) => a + t.rows, 0) };
    const target = await localClient(restoreCluster);
    try { report.restore = await restoreAndVerify(target, dir); } finally { await target.end(); }
    report.DB_RESTORE_TEST = report.restore.every((r) => r.identical) ? 'PASS' : 'FAIL';
  } finally {
    await source?.end().catch(() => {});
    sourceCluster?.stop();
    restoreCluster.stop();
    if (args.includes('--self-test')) rmSync(privateRoot, { recursive: true, force: true });
  }
  const summary = { ...report, restore: { tables: report.restore.length, identical: report.restore.filter((r) => r.identical).length,
    mismatches: report.restore.filter((r) => !r.identical).map((r) => r.table) } };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = report.DB_RESTORE_TEST === 'PASS' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`BACKUP_DRILL_FAILED:${error.message}`); process.exitCode = 1; });
}
