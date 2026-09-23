import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';

const accounts = ['STAGING CUSTOMER QA 20260920','STAGING BUSINESS QA 20260920','STAGING RIDER QA 20260920']
  .map(leerSecreto);
if(accounts.some(a=>!a?.usuario||!a?.secreto))throw Error('QA_ACCOUNTS_REQUIRED');
const { secret, publishable } = await loadStagingKeys();
const dir=mkdtempSync(path.join(tmpdir(),'taba-manual-qa-'));
try{
 const cli=fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js',import.meta.url));
 const config=fileURLToPath(new URL('../../playwright.staging-manual-payment.config.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[cli,'test','--config',config],{
  cwd:fileURLToPath(new URL('../..',import.meta.url)),stdio:'inherit',windowsHide:true,
  env:{...process.env,TABA_MANUAL_QA_OUTPUT:dir,
   SUPABASE_URL:'https://ucbtjcurawxjwjdvvcvj.supabase.co',SUPABASE_PUBLISHABLE_KEY:publishable,
   SUPABASE_SERVICE_ROLE_KEY:secret,SUPABASE_BUSINESS_ID:'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0',
   SUPABASE_CUSTOMER_EMAIL:accounts[0].usuario,SUPABASE_CUSTOMER_PASSWORD:accounts[0].secreto,
   SUPABASE_STAFF_EMAIL:accounts[1].usuario,SUPABASE_STAFF_PASSWORD:accounts[1].secreto,
   SUPABASE_RIDER_EMAIL:accounts[2].usuario,SUPABASE_RIDER_PASSWORD:accounts[2].secreto},
 });
 process.exitCode=result.status??1;
}finally{
 const resolved=path.resolve(dir),scope=path.resolve(tmpdir())+path.sep;
 if(!resolved.startsWith(scope)||!path.basename(resolved).startsWith('taba-manual-qa-'))
  throw new Error('TEMP_CLEANUP_TARGET_INVALID');
 rmSync(resolved,{recursive:true,force:true});
}
