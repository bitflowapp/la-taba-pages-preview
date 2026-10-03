import {conToken} from 'file:///C:/1212/la-taba-commerce-v3/scripts/lib/supabase-cli-token.mjs';
import fs from 'node:fs';
await conToken(async token=>{
 const query=`begin read only; select jsonb_build_object('migrations',(select count(*) from supabase_migrations.schema_migrations),'latest',(select max(version) from supabase_migrations.schema_migrations),'drafts',to_regclass('public.catalog_product_drafts'),'draft_rls',(select relrowsecurity from pg_class where oid='public.catalog_product_drafts'::regclass),'payment_settings',(select jsonb_agg(jsonb_build_object('enabled',enabled,'environment',environment)) from public.business_payment_settings)) as audit; commit;`;
 const response=await fetch('https://api.supabase.com/v1/projects/ukxqbgswjlibmnjemrzd/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query})});
 const result=await response.json();fs.writeFileSync('C:/1212/artifacts/taba-commerce-v3/staging-before.json',JSON.stringify(result,null,2));console.log('STAGING_READONLY',response.status,JSON.stringify(result));
});
