// Shared, read-only fingerprints for archive-derived restoration evidence.
import { nativeCommand } from './postgres-backup.mjs';

export const FINGERPRINT_SQL = `begin isolation level repeatable read;
set timezone='UTC';
create temp table restore_fingerprints(schema_name text,table_name text,row_count bigint,sha256 text);
do $fingerprint$ declare r record; begin
  for r in select schemaname,tablename from pg_tables where schemaname in ('public','private','catalog_admin','supabase_migrations','auth','storage') order by 1,2 loop
    execute format('insert into restore_fingerprints select %L,%L,count(*),encode(extensions.digest(coalesce(string_agg(encode(extensions.digest(to_jsonb(t)::text,''sha256''),''hex''),'''' order by encode(extensions.digest(to_jsonb(t)::text,''sha256''),''hex'')),''''),''sha256''),''hex'') from %I.%I t',r.schemaname,r.tablename,r.schemaname,r.tablename);
  end loop;
end $fingerprint$;
select jsonb_build_object(
 'tables',(select jsonb_agg(to_jsonb(t) order by schema_name,table_name) from restore_fingerprints t),
 'rls',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','catalog_admin')),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in ('public','private','catalog_admin')),
 'table_acl',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'acl',(select jsonb_agg(x::text order by x::text) from unnest(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) x)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','v','S') and n.nspname in ('public','private','catalog_admin')),
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'signature',p.oid::regprocedure::text,'definition_sha256',encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex'),'acl',(select jsonb_agg(x::text order by x::text) from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) x)) order by n.nspname,p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname in ('public','private','catalog_admin')),
 'publication',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename) order by schemaname,tablename) from pg_publication_tables where pubname='supabase_realtime')
);
rollback;`;

export function fingerprint(tools, env) {
  const text = nativeCommand(tools, 'psql', ['-X','-w','--quiet','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--file','-'], {
    env, input:FINGERPRINT_SQL, encoding:'utf8', timeout:300000,
  });
  return JSON.parse(text.trim());
}
export function compareFingerprints(source, restored) {
  return Object.fromEntries(['tables','rls','policies','table_acl','functions','publication']
    .map(key=>{
      const a=source?.[key],b=restored?.[key];
      // jsonb_agg may return null for an empty section. Undefined (missing),
      // scalar values, or an empty table inventory never certify a restore.
      const valid=value=>Array.isArray(value)?(key!=='tables'||value.length>0):(value===null&&key!=='tables');
      return [key,valid(a)&&valid(b)&&JSON.stringify(a)===JSON.stringify(b)];
    }));
}
