import { timingSafeEqual } from 'node:crypto';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { conToken } from '../lib/supabase-cli-token.mjs';
const REF='ucbtjcurawxjwjdvvcvj';
const same=(a,b)=>{const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));
 return left.length===right.length&&timingSafeEqual(left,right)};

/** Staging-only, read-only credential binding. Values never leave this process except to authenticate. */
export async function loadStagingKeys(){
 const secret=leerSecreto('STAGING SUPABASE SECRET KEY');
 const publishable=leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
 if(secret?.usuario!==REF||publishable?.usuario!==REF
  ||!secret.secreto.startsWith('sb_secret_')||!publishable.secreto.startsWith('sb_publishable_'))
  throw Error('STAGING_KEYS_NOT_BOUND');
 await conToken(async token=>{
  const response=await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,{
   headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`STAGING_KEY_READ_HTTP_${response.status}`);
  const keys=await response.json();
  if(!keys.some(k=>k.type==='secret'&&same(k.api_key,secret.secreto))
   ||!keys.some(k=>k.type==='publishable'&&same(k.api_key,publishable.secreto)))
   throw Error('STAGING_KEYS_MISMATCH');
 });
 return {secret:secret.secreto,publishable:publishable.secreto};
}
