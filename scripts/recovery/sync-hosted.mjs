// Incremental changes to the hosted recovery project AFTER its bootstrap, when it already has QA tenants.
// bootstrap-hosted.mjs refuses a project with Auth users and pauses every business at the end; that is right
// for a first restore and wrong for a running QA environment. This script:
//   --migrations          applies ONLY migrations newer than the recovery ledger, after verifying that the
//                         ledger is an exact prefix (same versions, same SHA-256) of the files in the repo;
//   --functions a,b,c     deploys exactly those Edge Functions from the current sources (verify_jwt from config.toml).
// Default is a dry run that prints what would change. --apply executes. Evidence is appended as JSONL.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, recoveryPlan } from './plan.mjs';
import { withRecoveryProject } from './hosted-client.mjs';
import { checkResumeLedger, migrationTransaction } from './bootstrap-hosted.mjs';
import { deployRecoveryFunctions } from './deploy-functions.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const apply = process.argv.includes('--apply');
const target = JSON.parse(fs.readFileSync(arg('--target') || 'deploy/recovery-free-hosted.json', 'utf8'));
const evidence = arg('--evidence');
const record = row => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...row });
  if (evidence) fs.appendFileSync(evidence, line + '\n');
  console.log(line);
};
const plan = recoveryPlan();

if (process.argv.includes('--migrations')) {
  await withRecoveryProject(target, async ({ query }) => {
    const marker = await query('select project_ref from private.la_taba_recovery_target where singleton');
    if (marker.length !== 1 || marker[0].project_ref !== target.projectRef) throw new Error('Recovery database receipt mismatch');
    const ledger = await query('select version,sha256 from private.la_taba_recovery_migrations order by version');
    const start = checkResumeLedger(plan, ledger);
    const standard = await query('select version from supabase_migrations.schema_migrations order by version');
    if (JSON.stringify(standard.map(row => row.version)) !== JSON.stringify(ledger.map(row => row.version))) {
      throw new Error('Platform migration ledger differs from recovery ledger');
    }
    const pending = plan.migrations.slice(start);
    record({ phase: 'migrations', applied: ledger.length, pending: pending.map(m => m.version + ' ' + path.basename(m.path)), apply });
    if (!apply) return;
    for (const migration of pending) {
      const sql = fs.readFileSync(path.join(ROOT, migration.path), 'utf8');
      await query(migrationTransaction(migration, sql));
      record({ phase: 'migration', version: migration.version, sha256: migration.sha256, result: 'applied' });
    }
    // migrationTransaction pauses every taba-* pg_cron job on purpose (a new schema must not run before its functions).
    if (pending.length) {
      const paused = await query(`select jobname from cron.job where jobname like 'taba-%' and not active order by jobname`);
      record({ phase: 'schedulers', paused: paused.map(row => row.jobname),
        next: 'deploy the functions (--functions), then re-enable the jobs that were active: qa-schedulers.mjs --enable <jobs>' });
    }
  });
}

const names = (arg('--functions') || '').split(',').map(name => name.trim()).filter(Boolean);
if (names.length) {
  const unknown = names.filter(name => !plan.functions.some(fn => fn.name === name));
  if (unknown.length) throw new Error(`Unknown functions: ${unknown.join(', ')}`);
  const selected = { ...plan, functions: plan.functions.filter(fn => names.includes(fn.name)) };
  record({ phase: 'functions', functions: selected.functions.map(fn => ({ name: fn.name, verifyJwt: fn.verifyJwt, files: fn.files.length })), apply });
  if (apply) {
    await deployRecoveryFunctions(target, selected, row => record({ phase: 'function', ...row }), { partial: true });
  }
}
