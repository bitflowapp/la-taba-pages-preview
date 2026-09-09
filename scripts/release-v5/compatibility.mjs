import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './model.mjs';

export function packCompatibility(stages, contract) {
  const delta=(before,after)=>Object.fromEntries(['functions','tables'].map(key=>[key,{
    changed:Object.fromEntries(Object.entries(after[key]).filter(([name,hash])=>before[key][name]!==hash)),
    removed:Object.keys(before[key]).filter(name=>!(name in after[key])),
  }]));
  assert.ok([...stages,contract].every(s=>s.major===stages[0].major));
  return {schema_version:1,base:stages[0],expand:stages.slice(1).map((s,i)=>delta(stages[i],s)),contract:delta(stages[4],contract)};
}
export function compatibilityAt(specification,stage=4,contracted=false) {
  assert.equal(specification.schema_version,1);assert.ok(Number.isInteger(stage)&&stage>=0&&stage<=4);
  const result=structuredClone(specification.base);
  const changes=specification.expand.slice(0,contracted?4:stage);
  if(contracted)changes.push(specification.contract);
  for(const delta of changes)for(const key of ['functions','tables']){
    for(const name of delta[key].removed)delete result[key][name];
    Object.assign(result[key],delta[key].changed);
  }
  return result;
}

// Independently generated from a pristine OLD -> reviewed EXPAND -> CONTRACT
// installation. This is intended schema, not release-success evidence. A
// production database must not bless its own unknown definitions at install.
export async function compatibilitySnapshot(session) {
  return session.value(`select jsonb_build_object(
    'major',current_setting('server_version_num')::integer/10000,
    'functions',(select jsonb_object_agg(p.oid::regprocedure::text,
      encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex'))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname in ('public','private')),
    'tables',(select jsonb_object_agg(n.nspname||'.'||c.relname,encode(extensions.digest(jsonb_build_object(
      'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      'constraints',(select jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated) order by k.conname::text collate "C")
        from pg_constraint k where k.conrelid=c.oid),
      'indexes',(select jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by pg_get_indexdef(i.indexrelid) collate "C") from pg_index i where i.indrelid=c.oid),
      'policies',(select jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
        (select array_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC')::text collate "C") from unnest(p.polroles) role_id left join pg_roles r on r.oid=role_id),
        pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname::text collate "C") from pg_policy p where p.polrelid=c.oid))::text,'sha256'),'hex'))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (
        n.nspname in ('public','private'))))`);
}
export async function assertCompatibility(session, root, expectedHash, stage=4) {
  const bytes=fs.readFileSync(path.join(root,'scripts/release-v5/compatibility.json'));
  assert.equal(sha256(bytes),expectedHash,'compatibility specification changed after immutable preflight');
  const expected=JSON.parse(bytes);
  const hasLedger=await session.value("select to_regclass('private.deployment_contract_executions') is not null");
  const contracted=hasLedger&&await session.value("select exists(select 1 from private.deployment_contract_executions where contract_name='a1_a4_legacy_contract_v3' and environment='production')");
  assert.deepEqual(await compatibilitySnapshot(session),compatibilityAt(expected,stage,contracted),'database differs from independently reviewed compatibility definitions');
}
