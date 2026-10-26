// Read-only evidence, pinned to the authorized QA project and its two synthetic tenants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { RECOVERY_QA } from '../recovery/provision-qa-ids.mjs';
import { inspectPaymentSession } from '../recovery/qa-mp-inspection.mjs';
const ref = 'ixewllzzuzpqrkxzmfzx', application = '4861627125869370';
const target = JSON.parse(fs.readFileSync('deploy/recovery-free-hosted.json', 'utf8'));
assert.equal(target.projectRef, ref); assert.equal(target.projectName, 'la-taba-recovery-test');
assert.equal(target.environment, 'test'); assert.equal(target.commercialPaymentsEnabled, false);
assert.equal(target.mercadoPagoApplicationId, application);
const credential = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential?.usuario, ref); assert.ok(credential?.secreto);
const db = createClient(`https://${ref}.supabase.co`, credential.secreto, {auth:{persistSession:false,autoRefreshToken:false}});
async function read(query, label) {
  const {data,error} = await query;
  assert.ok(!error, `${label}: ${error?.code || ''}`);
  return data;
}
async function provider(token, path) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200,`provider read ${path.split('?')[0]} HTTP ${response.status}`);
  return response.json();
}
const connections = await read(db.from('mp_seller_connections').select('business_id,environment,application_id,seller_id,status,protected_tokens,scopes').in('business_id',Object.values(RECOVERY_QA)).eq('environment','test'),'connections');
const report = {at:new Date().toISOString(),ref,application,read_only:true,tenants:{},provider:[]};
for (const [name,businessId] of Object.entries(RECOVERY_QA)) {
  const connection = connections.find(c=>c.business_id===businessId);
  const products = await read(db.from('products').select('id,sku,price,stock,is_active').eq('business_id',businessId).order('sku'),'products');
  const sessions = await read(db.from('checkout_sessions').select('id,status,total,created_at,updated_at').eq('business_id',businessId).order('created_at',{ascending:false}).limit(15),'sessions');
  const details = [];
  for (const session of sessions) details.push(await inspectPaymentSession(db,session.id,businessId));
  report.tenants[name] = {business_id:businessId,connection:connection && {status:connection.status,seller_id:connection.seller_id,application_id:connection.application_id,scopes:connection.scopes},products,sessions:details};
  if (connection?.status !== 'connected') continue;
  assert.equal(connection.application_id,application); assert.equal(connection.environment,'test');
  assert.equal(String(connection.seller_id),'3594962708','only the preauthorized test seller');
  const encryption = leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY');
  const [version,iv,ciphertext] = connection.protected_tokens.split('.'); assert.equal(version,'v1');
  const key = await crypto.subtle.importKey('raw',Buffer.from(encryption.secreto,'base64url'),'AES-GCM',false,['decrypt']);
  const tokens = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:Buffer.from(`${ref}:test:${application}:${businessId}:tokens`)},key,Buffer.from(ciphertext,'base64url'))));
  const me = await provider(tokens.access_token,'/users/me');
  assert.equal(String(me.id),String(connection.seller_id)); assert.equal(me.site_id,'MLA'); assert.ok(me.tags.includes('test_user'));
  const search = await provider(tokens.access_token,`/v1/payments/search?${new URLSearchParams({sort:'date_created',criteria:'desc',limit:'20'})}`);
  report.provider.push({business_id:businessId,seller_id:String(me.id),seller_test_user:true,total:search.paging?.total,payments:[]});
  const evidence = report.provider.at(-1);
  for (const found of search.results || []) {
    // Only payments from this application's QA checkout references, never other account activity.
    if (!/^taba2:checkout:[a-f0-9-]{36}$/.test(found.external_reference || '')) continue;
    const payment = await provider(tokens.access_token,`/v1/payments/${found.id}`);
    assert.equal(String(payment.collector_id),String(me.id));
    if (String(payment.payer.id) !== '3594962710') continue;
    evidence.payments.push(Object.fromEntries(['id','status','status_detail','transaction_amount','currency_id','collector_id','live_mode','external_reference','transaction_amount_refunded','date_created','date_approved'].map(k=>[k,payment[k] ?? null])));
    evidence.payments.at(-1).refunds=(payment.refunds || []).map(r=>({id:r.id,status:r.status,amount:r.amount}));
    evidence.payments.at(-1).authorized_qa_buyer=true;
  }
}
console.log(JSON.stringify(report,null,2));
