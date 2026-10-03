import {conToken} from './la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
import fs from 'node:fs';
await conToken(async token => {
 const ref='ukxqbgswjlibmnjemrzd';
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:`select b.id,b.name,s.environment,s.enabled,s.collector_id, (select count(*) from public.payment_intents i where i.business_id=b.id) as historical_intents, (select count(*) from public.mp_seller_connections c where c.business_id=b.id and c.status='connected') as connected_sellers, (select count(*) from auth.users where email like 'taba-oauth-smoke-%@example.invalid') as remaining_qa_users from public.businesses b left join public.business_payment_settings s on s.business_id=b.id where b.id='00000000-0000-4000-8000-000000000001'`})});
 if(!response.ok)throw Error(`State verification HTTP ${response.status}`);
 const result=await response.json();
 fs.writeFileSync('C:/1212/la-taba-mp-final-state.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
});
