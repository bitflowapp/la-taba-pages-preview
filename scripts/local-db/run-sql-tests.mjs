// node scripts/local-db/run-sql-tests.mjs <taba_local_db> <supabase/tests/file.sql> [...]
// Runs the repository's pgTAP-style SQL tests on a disposable local cluster using scripts/local-db/pgtap-shim.sql.
// A file passes only when every assertion is "ok", the plan matches and nothing was skipped.
import fs from 'node:fs';
import path from 'node:path';
import { psqlRaw, ROOT } from './lib.mjs';

const [db, ...files] = process.argv.slice(2);
if (!db || !files.length) throw new Error('usage: run-sql-tests.mjs <db> <file.sql>...');
psqlRaw(db, fs.readFileSync(path.join(ROOT, 'scripts/local-db/pgtap-shim.sql'), 'utf8'));
let failed = 0;
for (const file of files) {
  const abs = path.resolve(ROOT, file);
  const sql = fs.readFileSync(abs, 'utf8')
    .replace(/create extension if not exists pgtap with schema extensions;/gi, 'select 1 as pgtap_shim;')
    .replace(/^\s*set local search_path[^;]*;/gim, m => m);
  const r = psqlRaw(db, 'set search_path=public,extensions;\n' + sql, { tuples: true, check: false, timeout: 600000 });
  const lines = r.stdout.split('\n').map(s => s.replace(/\r$/, ''));
  const notOk = lines.filter(l => l.startsWith('not ok'));
  const ok = lines.filter(l => /^ok \d+/.test(l)).length;
  const planned = Number((lines.find(l => /^1\.\.\d+$/.test(l)) || '').slice(3)) || null;
  const problems = [...notOk, ...lines.filter(l => l.startsWith('# Looks like'))];
  if (r.status !== 0) problems.push('psql exit ' + r.status + ': ' + String(r.stderr).slice(0, 600));
  if (planned !== null && planned !== ok + notOk.length) problems.push(`plan ${planned} != ran ${ok + notOk.length}`);
  const pass = problems.length === 0;
  if (!pass) failed++;
  console.log(JSON.stringify({ file: path.basename(file), pass, style: planned === null ? 'script' : 'tap', ok, planned, problems: problems.slice(0, 8) }));
}
process.exit(failed ? 1 : 0);
