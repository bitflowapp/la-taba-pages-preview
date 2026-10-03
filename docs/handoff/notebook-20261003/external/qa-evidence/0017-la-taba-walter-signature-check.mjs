import {conToken} from './la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const ref='ukxqbgswjlibmnjemrzd', name='taba-walter-signature-check';
await conToken(async token=>{
 const headers={Authorization:`Bearer ${token}`};
 const evidence={};
 try {
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`,{headers});
  if(!response.ok)throw Error('Staging access unavailable');
  const service=(await response.json()).find(k=>k.name==='service_role').api_key;
  const result=await fetch(`https://${ref}.supabase.co/functions/v1/${name}`,{method:'POST',headers:{Authorization:`Bearer ${service}`,apikey:service}});
  if(result.status!==200){const failure=await result.json().catch(()=>({}));evidence.probeFailure={http:result.status,code:failure.code,reason:failure.reason};}
  assert.equal(result.status,200);
  Object.assign(evidence,await result.json());
  assert.equal(evidence.passed,true);
 } finally {
  const removed=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/${name}`,{method:'DELETE',headers});
  evidence.temporaryFunctionRemoved=removed.ok;
  fs.writeFileSync('C:/1212/la-taba-walter-hmac-evidence.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
  assert.equal(removed.ok,true);
 }
});
