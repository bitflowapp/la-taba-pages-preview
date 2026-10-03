import {conToken} from 'file:///C:/1212/la-taba-commerce-v3/scripts/lib/supabase-cli-token.mjs';
await conToken(async token=>{
 const query=`begin read only; select (select count(*) from supabase_migrations.schema_migrations) as migrations, (select max(version) from supabase_migrations.schema_migrations) as latest, to_regclass('public.catalog_product_drafts')::text as drafts; select enabled, environment from public.business_payment_settings; commit;`;
 const response=await fetch('https://api.supabase.com/v1/projects/ukxqbgswjlibmnjemrzd/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query})});
 console.log('STAGING_READONLY',response.status,await response.text());
});
