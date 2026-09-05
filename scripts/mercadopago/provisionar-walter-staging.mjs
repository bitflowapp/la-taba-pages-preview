// Staging-only, transactional clone of commercial configuration. Never copies financial rows.
import { conToken } from '../lib/supabase-cli-token.mjs';
import fs from 'node:fs';

const ref = 'ukxqbgswjlibmnjemrzd';
const legacy = '00000000-0000-4000-8000-000000000001';
const slug = 'taba-walter-staging';
const apply = process.argv.includes('--apply');
await conToken(async token => {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const project = await fetch(`https://api.supabase.com/v1/projects/${ref}`, { headers });
  if (!project.ok || (await project.json()).id !== ref) throw Error('Staging project not verified');
  async function query(sql) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers, body: JSON.stringify({ query: sql }),
    });
    if (!response.ok) throw Error(`Staging provisioning HTTP ${response.status}: ${(await response.text()).slice(0,500)}`);
    return response.json();
  }
  const existing = await query(`select id from public.businesses where slug='${slug}'`);
  if (existing.length) { console.log(JSON.stringify({ business_id: existing[0].id, created: false })); return; }
  const schema = await query(`select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('businesses','catalog_assets','products','product_combos','product_combo_components','product_combo_substitutions','business_service_hours','business_service_exceptions','delivery_zones') order by ordinal_position`);
  const columns = (table, excluded) => schema.filter(c => c.table_name === table && !excluded.includes(c.column_name)).map(c => c.column_name);
  const ordinary = ['business_service_hours','business_service_exceptions','delivery_zones'];
  const sql = [`begin;`, `select pg_advisory_xact_lock(hashtext('taba-walter-staging-provisioning'));`,
    `do $$ begin if exists(select 1 from public.businesses where slug='${slug}') then raise exception 'already_provisioned'; end if; end $$;`,
    `create temp table new_business(id uuid) on commit drop;`];
  const commercial = columns('businesses', ['id','name','slug','created_at','updated_at']);
  sql.push(`with created as (insert into public.businesses(name,slug,${commercial.join(',')}) select 'TABA Walter Staging','${slug}',${commercial.join(',')} from public.businesses where id='${legacy}' returning id) insert into new_business select id from created;`);
  sql.push(`do $$ begin if (select count(*) from new_business)<>1 then raise exception 'source_business_missing'; end if; end $$;`);
  for (const [table, map, parent] of [
    ['catalog_assets','asset_map',null], ['products','product_map',null], ['product_combos','combo_map',null],
    ['product_combo_components','component_map','combo_id'], ['product_combo_substitutions','substitution_map','component_id'],
  ]) {
    const condition = parent === 'combo_id' ? 's.combo_id in (select old_id from combo_map)' : parent === 'component_id' ? 's.component_id in (select old_id from component_map) and s.product_id in (select old_id from product_map)' : `s.business_id='${legacy}'` + (table === 'products' ? ' and s.is_active and s.is_verified' : table === 'product_combos' ? " and s.is_active and s.approval_status='APROBADO_COMERCIAL' and not exists(select 1 from public.product_combo_components cc where cc.combo_id=s.id and cc.product_id not in (select old_id from product_map))" : '');
    sql.push(`create temp table ${map}(old_id uuid primary key,new_id uuid not null default gen_random_uuid()) on commit drop; insert into ${map}(old_id) select s.id from public.${table} s where ${condition};`);
    const cols = columns(table, ['id','created_at','updated_at']);
    const expressions = cols.map(c => c === 'business_id' ? '(select id from new_business)' :
      c === 'catalog_asset_id' ? '(select new_id from asset_map where old_id=s.catalog_asset_id)' :
      c === 'product_id' ? '(select new_id from product_map where old_id=s.product_id)' :
      c === 'component_id' ? '(select new_id from component_map where old_id=s.component_id)' :
      c === 'combo_id' && table === 'product_combo_components' ? '(select new_id from combo_map where old_id=s.combo_id)' : `s.${c}`);
    sql.push(`insert into public.${table}(id,${cols.join(',')}) select m.new_id,${expressions.join(',')} from public.${table} s join ${map} m on m.old_id=s.id;`);
  }
  for (const table of ordinary) {
    const cols = columns(table, ['id','created_at','updated_at']);
    sql.push(`insert into public.${table}(${cols.join(',')}) select ${cols.map(c=>c==='business_id'?'(select id from new_business)':`s.${c}`).join(',')} from public.${table} s where s.business_id='${legacy}';`);
  }
  // Pickup coordinates are commercial configuration, without rider presence history.
  sql.push(`insert into private.rider_map_business_locations(business_id,latitude,longitude,source,accuracy_m,confidence,human_verified,source_note) select (select id from new_business),latitude,longitude,source,accuracy_m,confidence,human_verified,source_note from private.rider_map_business_locations where business_id='${legacy}';`);
  // Retain the current panel's active owner/admin access; no historical sessions or invitations.
  sql.push(`insert into public.business_members(business_id,user_id,role,is_active) select (select id from new_business),user_id,role,true from public.business_members where business_id='${legacy}' and is_active and role in ('owner','admin');`);
  // No payment settings or OAuth row: absence is the existing disconnected state.
  sql.push(`select id as business_id,${apply} as created from new_business;`, apply ? 'commit;' : 'rollback;');
  if (process.env.TABA_PROVISION_SQL_OUTPUT) fs.writeFileSync(process.env.TABA_PROVISION_SQL_OUTPUT, sql.join('\n'));
  const result = await query(sql.join('\n'));
  console.log(JSON.stringify({ project_ref: ref, applied: apply, result }));
});
