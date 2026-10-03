import {conToken} from './la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
import fs from 'node:fs';
await conToken(async token=>{
 const ref='ukxqbgswjlibmnjemrzd';
 const sql="select timestamp,event_message from function_edge_logs order by timestamp desc limit 8";
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`,{headers:{Authorization:`Bearer ${token}`}});
 if(!response.ok)throw Error('Log query HTTP '+response.status);
 const data=await response.json();
 const safe=JSON.stringify(data).replace(/Bearer\s+[^\s"\\]+/g,'Bearer REDACTED').replace(/\beyJ[A-Za-z0-9_.-]+/g,'REDACTED').replace(/APP_USR-[A-Za-z0-9_-]+/g,'REDACTED');
 fs.writeFileSync('C:/1212/la-taba-walter-logs.json',safe);
 console.log(safe);
});
