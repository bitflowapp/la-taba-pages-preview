// Rehearses ONE new migration on the hosted recovery project inside a transaction that is always rolled back,
// optionally followed by a pgTAP suite in the same transaction. Nothing persists. Used before sync-hosted --apply.
//   node scripts/recovery/rehearse-migration.mjs --migration supabase/migrations/X.sql [--tap supabase/tests/Y.sql]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './plan.mjs';
import { withRecoveryProject } from './hosted-client.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const target = JSON.parse(fs.readFileSync(arg('--target') || 'deploy/recovery-free-hosted.json', 'utf8'));
const migrationPath = path.resolve(ROOT, arg('--migration') || '');
if (!/supabase[\\/]migrations[\\/]\d{14}_[a-z0-9_]+\.sql$/.test(migrationPath)) throw new Error('--migration must be a migration file');
const migration = fs.readFileSync(migrationPath, 'utf8');
if (/^\s*(?:begin|commit|rollback);/im.test(migration)) throw new Error('Migration cannot manage its own transaction');
let tap = '';
let planned = 0;
if (arg('--tap')) {
  tap = fs.readFileSync(path.resolve(ROOT, arg('--tap')), 'utf8');
  planned = Number(/select plan\((\d+)\)/.exec(tap)?.[1] || 0);
  tap = tap.replace(/^begin;\s*/m, '').replace(/rollback;\s*$/m, '')
    .replace('create extension if not exists pgtap with schema extensions;', 'create extension if not exists pgtap with schema extensions; set local search_path=public,extensions; create temp table recovery_tap(line text);')
    .replace(/^select ((?:ok|is|isnt|like|unlike|throws_ok|lives_ok|cmp_ok)\([\s\S]*?);/gm, 'insert into recovery_tap(line) select $1;')
    .replace(/select \* from finish\(\);/, `do $tap_assert$ begin if (select count(*) from recovery_tap) <> ${planned}
      or exists(select 1 from recovery_tap where line like 'not ok%') then raise exception 'HOSTED_TAP_FAILED: %',(select jsonb_agg(line) from recovery_tap); end if; end $tap_assert$;`);
}
await withRecoveryProject(target, async ({ query }) => {
  // The rehearsal raises at the end on purpose, so even a successful run leaves nothing behind.
  const sql = `begin;\nset local statement_timeout='120s';\n${migration}\n${tap}\ndo $rehearsal$ begin raise exception 'REHEARSAL_OK_ROLLED_BACK'; end $rehearsal$;\nrollback;`;
  try {
    await query(sql);
    console.log(JSON.stringify({ rehearsal: 'unexpected_commit_path' }));
    process.exitCode = 1;
  } catch (error) {
    const message = String(error.message || '');
    const ok = message.includes('REHEARSAL_OK_ROLLED_BACK');
    console.log(JSON.stringify({ migration: path.basename(migrationPath), tapAssertions: planned || null,
      result: ok ? 'passed_and_rolled_back' : 'failed_and_rolled_back', detail: ok ? null : message.slice(0, 1200) }));
    if (!ok) process.exitCode = 1;
  }
});
