import fs from 'node:fs';
import { conToken } from 'file:///C:/1212/la-taba-commerce-v3/scripts/lib/supabase-cli-token.mjs';
const business='00000000-0000-4000-8000-000000000001';
await conToken(async token=>{
 const query=`begin read only; select jsonb_build_object('products',(select jsonb_agg(to_jsonb(p)) from public.products p where business_id='${business}' and available and is_active and is_verified and price>0 and stock>0 and not is_alcoholic),'assets',(select jsonb_agg(to_jsonb(a)) from public.catalog_assets a where id in(select catalog_asset_id from public.products where business_id='${business}' and available and is_active and is_verified and price>0 and stock>0 and not is_alcoholic))) as catalog; commit;`;
 const response=await fetch('https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query})});
 if(!response.ok)throw Error('Read-only source catalog query failed: '+response.status);
 const rows=await response.json();const source=rows[0]?.catalog;if(!source?.products?.length)throw Error('No verified catalog source');
 fs.writeFileSync('C:/1212/artifacts/taba-commerce-v3/verified-source-catalog.json',JSON.stringify(source));
 console.log(JSON.stringify({products:source.products.length,assets:source.assets?.length,productColumns:Object.keys(source.products[0]),assetColumns:Object.keys(source.assets?.[0]||{})}));
});
