-- Schema fingerprint of the application schemas (public, private) plus the
-- platform objects the app configures (storage policies and buckets, cron jobs,
-- realtime publication). One row per category: count, md5 of the sorted
-- key=value lines, and the md5 of every item. Read only. Used to compare
-- CONTROLLED_PRODUCTION with a restored copy (restore-drill.mjs) and before and
-- after a migration.
with
tbl as (
  select n.nspname||'.'||c.relname as k,
         jsonb_build_object('rls', c.relrowsecurity, 'force', c.relforcerowsecurity, 'kind', c.relkind) as v
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')
),
col as (
  select n.nspname||'.'||c.relname||'.'||a.attname as k,
         jsonb_build_object('type', format_type(a.atttypid,a.atttypmod), 'nn', a.attnotnull,
           'def', pg_get_expr(d.adbin, d.adrelid), 'gen', a.attgenerated) as v
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname in ('public','private') and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped
),
con as (
  select n.nspname||'.'||c.relname||'.'||co.conname as k, to_jsonb(pg_get_constraintdef(co.oid)) as v
  from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private')
),
idx as (
  select n.nspname||'.'||i.relname as k, to_jsonb(pg_get_indexdef(i.oid)) as v
  from pg_index x join pg_class i on i.oid=x.indexrelid join pg_namespace n on n.oid=i.relnamespace
  where n.nspname in ('public','private')
),
fn as (
  select p.oid::regprocedure::text as k,
         jsonb_build_object('src', md5(p.prosrc), 'secdef', p.prosecdef, 'cfg', p.proconfig,
           'vol', p.provolatile, 'ret', pg_get_function_result(p.oid), 'lang', l.lanname) as v
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname in ('public','private')
),
pol as (
  select schemaname||'.'||tablename||'.'||policyname as k,
         jsonb_build_object('cmd', cmd, 'perm', permissive, 'roles', roles, 'qual', qual, 'check', with_check) as v
  from pg_policies where schemaname in ('public','private','storage')
),
trg as (
  select n.nspname||'.'||c.relname||'.'||t.tgname as k, to_jsonb(pg_get_triggerdef(t.oid)) as v
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','private')
),
tgrant as (
  select n.nspname||'.'||c.relname||'|'||r.rolname as k,
         to_jsonb(array(select distinct x.privilege_type from aclexplode(c.relacl) x
                        where x.grantee=r.oid order by 1)) as v
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  cross join pg_roles r
  where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
    and r.rolname in ('anon','authenticated','service_role')
),
cgrant as (
  select n.nspname||'.'||c.relname||'.'||a.attname||'|'||r.rolname as k,
         to_jsonb(array(select distinct x.privilege_type from aclexplode(a.attacl) x
                        where x.grantee=r.oid order by 1)) as v
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  cross join pg_roles r
  where n.nspname in ('public','private') and a.attnum>0 and not a.attisdropped and a.attacl is not null
    and r.rolname in ('anon','authenticated','service_role')
),
fgrant as (
  select p.oid::regprocedure::text||'|'||r.rolname as k,
         to_jsonb(has_function_privilege(r.oid, p.oid, 'execute')) as v
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r
  where n.nspname in ('public','private') and r.rolname in ('anon','authenticated','service_role')
),
pub as (
  select schemaname||'.'||tablename as k, to_jsonb(pubname) as v
  from pg_publication_tables where pubname='supabase_realtime'
),
cronj as (
  select jobname as k, jsonb_build_object('schedule', schedule, 'command', command, 'active', active) as v
  from cron.job
),
bucket as (
  select id as k, jsonb_build_object('public', public, 'limit', file_size_limit, 'mime', allowed_mime_types) as v
  from storage.buckets
),
cats as (
  select 'tables' as cat, k, v from tbl union all
  select 'columns', k, v from col union all
  select 'constraints', k, v from con union all
  select 'indexes', k, v from idx union all
  select 'functions', k, v from fn union all
  select 'policies', k, v from pol union all
  select 'triggers', k, v from trg union all
  select 'table_grants', k, v from tgrant union all
  select 'column_grants', k, v from cgrant union all
  select 'function_grants', k, v from fgrant union all
  select 'realtime_publication', k, v from pub union all
  select 'cron_jobs', k, v from cronj union all
  select 'storage_buckets', k, v from bucket
)
select cat, count(*) as n, md5(string_agg(k||'='||v::text, E'\n' order by k)) as hash,
       jsonb_object_agg(k, md5(v::text)) as items
from cats group by cat order by cat
