// Read-only security/data audit of the CONTROLLED_PRODUCTION database through
// the Management API (no DB password). Every query is a SELECT.
import assert from 'node:assert/strict';
import { conToken } from '../lib/supabase-cli-token.mjs';
import { NON_CP_REFS } from './target-keys.mjs';

const ref = process.argv[process.argv.indexOf('--ref') + 1];
assert.match(ref || '', /^[a-z0-9]{20}$/, 'REF_REQUIRED');
assert.ok(!NON_CP_REFS.has(ref), 'AUDIT_IS_FOR_CONTROLLED_PRODUCTION');
const QUERIES = {
  seededData: `select (select count(*) from public.businesses) businesses, (select count(*) from public.products) products,
    (select count(*) from public.orders) orders, (select count(*) from auth.users) users,
    (select count(*) from public.business_members) members, (select count(*) from public.customers) customers`,
  tablesWithoutRls: `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1`,
  definerWithoutSearchPath: `select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1`,
  definerCount: `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`,
  anonExecutableDefiner: `select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`,
  anonReadableTables: `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v') and has_table_privilege('anon', c.oid, 'SELECT') order by 1`,
  anonWritableTables: `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v')
      and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) order by 1`,
  anonPolicies: `select tablename, policyname, cmd from pg_policies where schemaname='public' and ('anon' = any(roles) or 'public' = any(roles)) order by 1,2`,
  publicBuckets: `select id, public from storage.buckets order by 1`,
  conflictCode40001: `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosrc ~ 'errcode\s*=\s*''40001'''`,
  conflictCodePT409: `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosrc ~ 'errcode\s*=\s*''PT409'''`,
  policiesCount: `select count(*) from pg_policies where schemaname='public'`,
  realtimePublication: `select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`,
  cronJobs: `select jobname, schedule, active from cron.job order by 1`,
};
await conToken(async (token) => {
  const out = {};
  for (const [name, query] of Object.entries(QUERIES)) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query?read_only=true`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, read_only: true }), signal: AbortSignal.timeout(60_000) });
    const text = await response.text();
    out[name] = response.ok ? JSON.parse(text) : { error: response.status, detail: text.slice(0, 160) };
  }
  console.log(JSON.stringify({ ref, at: new Date().toISOString(), ...out }, null, 1));
});
