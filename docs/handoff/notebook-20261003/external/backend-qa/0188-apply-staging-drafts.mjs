import fs from 'node:fs';
import assert from 'node:assert/strict';
import {conToken} from 'file:///D:/1212/la-taba-commerce-v3/scripts/lib/supabase-cli-token.mjs';
const ref='ukxqbgswjlibmnjemrzd';
const sql=fs.readFileSync('D:/1212/la-taba-commerce-v3/supabase/migrations/20260913011340_commerce_v3_product_draft_details.sql','utf8');
const lit=s=>"'"+s.replaceAll("'","''")+"'";
await conToken(async token=>{
const query=async sql=>{const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d};
const before=await query("begin read only; select exists(select 1 from supabase_migrations.schema_migrations where version='20260913011340') as applied; commit;");assert.equal(before[0].applied,false,'Migration already applied; inspect instead of rerunning');
const result=await query(`begin; ${sql}\n insert into supabase_migrations.schema_migrations(version,name,statements) values ('20260913011340','commerce_v3_product_draft_details',array[${lit(sql)}]); notify pgrst,'reload schema'; commit;`);
console.log('STAGING_MIGRATION_APPLIED',JSON.stringify(result));
const verify=await query("begin read only; select jsonb_build_object('migration',(select version from supabase_migrations.schema_migrations where version='20260913011340'),'rls',(select relrowsecurity from pg_class where oid='public.catalog_product_drafts'::regclass),'payment_settings',(select jsonb_agg(jsonb_build_object('enabled',enabled,'environment',environment)) from public.business_payment_settings)) as verified; commit;");
console.log(JSON.stringify(verify));
});
