import {conToken} from 'file:///C:/1212/la-taba-commerce-v3/scripts/lib/supabase-cli-token.mjs';
await conToken(async token=>{
 const query="begin read only; select pg_get_functiondef('public.identity_member_role(uuid)'::regprocedure) as member_gate, pg_get_functiondef('auth.uid()'::regprocedure) as uid; commit;";
 const response=await fetch('https://api.supabase.com/v1/projects/ukxqbgswjlibmnjemrzd/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query})});const rows=await response.json();console.log(JSON.stringify(rows));
});
