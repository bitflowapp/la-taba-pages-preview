// Recover the existing QA worker key from Supabase Vault into Windows Credential Manager.
// This never rotates or changes any remote secret, and never prints key material.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withRecoveryProject } from './hosted-client.mjs';
import { leerSecreto, guardarSecreto } from '../e2e-production-sale/secretos-windows.mjs';
const target=JSON.parse(readFileSync('deploy/recovery-free-hosted.json','utf8'));
assert.equal(target.projectRef,'ixewllzzuzpqrkxzmfzx'); assert.equal(target.environment,'test');
const hash=s=>createHash('sha256').update(s).digest('hex');
await withRecoveryProject(target,async({request,query})=>{
  const rows=await query("select decrypted_secret from vault.decrypted_secrets where name='taba_payment_worker_hmac_secret'");
  assert.equal(rows.length,1);const secret=rows[0].decrypted_secret;assert.ok(secret?.length>=32);
  const edge=(await request('/secrets')).find(s=>s.name==='PAYMENT_WORKER_SECRET');
  assert.equal(hash(secret),edge?.value,'existing Vault/Edge worker keys must match');
  const old=leerSecreto('RECOVERY PAYMENT WORKER SECRET');
  const alreadyAligned=old?.usuario===target.projectRef && old?.secreto===secret;
  if(!alreadyAligned) guardarSecreto('RECOVERY PAYMENT WORKER SECRET',target.projectRef,secret);
  const saved=leerSecreto('RECOVERY PAYMENT WORKER SECRET');
  assert.equal(saved?.usuario,target.projectRef);assert.equal(saved?.secreto,secret);
  console.log(JSON.stringify({project:target.projectRef,remoteKeysAligned:true,localWasAligned:alreadyAligned,localNowAligned:true,remoteSecretsChanged:false}));
});
