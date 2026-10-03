import {conToken} from './la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
export const ref='ukxqbgswjlibmnjemrzd';
export async function query(sql){return conToken(async token=>{
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:sql})});
 if(!response.ok)throw Error(`Staging query HTTP ${response.status}: ${(await response.text()).slice(0,350)}`);
 return response.json();
});}
