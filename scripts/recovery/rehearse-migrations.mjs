// Rehearses SEVERAL consecutive migrations on the hosted recovery project inside ONE transaction that is always
// rolled back, and reports structural checks taken after they applied. Nothing persists.
//   node scripts/recovery/rehearse-migrations.mjs --migration supabase/migrations/A.sql --migration supabase/migrations/B.sql
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './plan.mjs';
import { withRecoveryProject } from './hosted-client.mjs';

const args = process.argv.slice(2);
const files = args.flatMap((value, i) => (value === '--migration' ? [args[i + 1]] : []));
if (!files.length) throw new Error('at least one --migration is required');
const targetPath = args.includes('--target') ? args[args.indexOf('--target') + 1] : 'deploy/recovery-free-hosted.json';
const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const sql = files.map(file => {
  const abs = path.resolve(ROOT, file);
  if (!/supabase[\\/]migrations[\\/]\d{14}_[a-z0-9_]+\.sql$/.test(abs)) throw new Error('not a migration file: ' + file);
  const text = fs.readFileSync(abs, 'utf8');
  if (/^\s*(?:begin|commit|rollback);/im.test(text)) throw new Error('Migration cannot manage its own transaction: ' + file);
  return `-- ${path.basename(abs)}\n${text}`;
}).join('\n');
const checks = `
  select jsonb_build_object(
    'tables', (select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname in ('payment_provider_payments', 'payment_discrepancies', 'provider_ledger_cursors')),
    'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public', 'private') and p.proname in ('payment_financial_hold', 'reserve_for_paid_session', 'retry_stuck_paid_checkouts',
                 'claim_provider_ledger_window', 'record_orphan_provider_payment', 'resolve_ambiguous_refund', 'list_payment_discrepancies')),
    'finalize_core_private', to_regprocedure('private.finalize_paid_checkout_session_core(uuid)') is not null,
    'one_live_reservation_index', to_regclass('public.inventory_reservations_one_live_per_product') is not null,
    'financial_interlock_on_new_tables', (select count(*) from pg_trigger where tgname = 'a1_a4_financial_interlock_v5'
               and tgrelid in ('public.payment_provider_payments'::regclass, 'public.payment_discrepancies'::regclass, 'public.provider_ledger_cursors'::regclass)),
    'cron_active_after', (select count(*) from cron.job where active),
    'integrity_checks_run', public.run_financial_integrity_checks(10),
    'preflight_runs', public.mp_disconnect_preflight(gen_random_uuid(), 'test') is not null
  ) as checks`;
await withRecoveryProject(target, async ({ query }) => {
  const script = `begin;\nset local statement_timeout='180s';\n${sql}\ndo $r$ declare c jsonb; begin\n${checks.replace(/\s+as checks$/, '')} into c;\n raise exception 'REHEARSAL_OK_ROLLED_BACK %', c; end $r$;\nrollback;`;
  try {
    await query(script);
    console.log(JSON.stringify({ rehearsal: 'unexpected_commit_path' }));
    process.exitCode = 1;
  } catch (error) {
    const message = String(error.message || '');
    const ok = message.includes('REHEARSAL_OK_ROLLED_BACK');
    console.log(JSON.stringify({ migrations: files.map(f => path.basename(f)), result: ok ? 'passed_and_rolled_back' : 'failed_and_rolled_back',
      checks: ok ? message.slice(message.indexOf('REHEARSAL_OK_ROLLED_BACK') + 25, message.indexOf('REHEARSAL_OK_ROLLED_BACK') + 900) : null,
      detail: ok ? null : message.slice(0, 1500) }));
    if (!ok) process.exitCode = 1;
  }
});
