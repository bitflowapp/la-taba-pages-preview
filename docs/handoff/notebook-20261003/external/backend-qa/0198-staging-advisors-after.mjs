import fs from 'node:fs';
import {conToken} from 'file:///D:/1212/la-taba-commerce-v3/scripts/lib/supabase-cli-token.mjs';
await conToken(async token=>{
 const response=await fetch('https://api.supabase.com/v1/projects/ukxqbgswjlibmnjemrzd/advisors/security',{headers:{Authorization:'Bearer '+token}});
 const body=await response.json();fs.writeFileSync('C:/1212/artifacts/taba-commerce-v3/staging-advisors-after.json',JSON.stringify(body,null,2));
 console.log(JSON.stringify({status:response.status,findings:(body.lints||body).length,keys:Object.keys(body)}));
});
