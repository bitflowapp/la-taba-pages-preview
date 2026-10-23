// Read-only provider evidence using the connected QA seller's existing OAuth grant.
// No credentials, encrypted material or full provider payloads leave this process.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
const ref='ixewllzzuzpqrkxzmfzx', business='7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01';
const credential=leerSecreto('RECOVERY SUPABASE SERVICE KEY');
assert.equal(credential.usuario,ref);
const db=createClient(`https://${ref}.supabase.co`,credential.secreto,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:connection,error}=await db.from('mp_seller_connections').select('environment,seller_id,application_id,status,protected_tokens').eq('business_id',business).eq('environment','test').single();
assert.ifError(error); assert.equal(connection.seller_id,'3594962708'); assert.equal(connection.application_id,'2691240967769590'); assert.equal(connection.status,'connected');
const [v,iv,ciphertext]=connection.protected_tokens.split('.'); assert.equal(v,'v1');
const key=await crypto.subtle.importKey('raw',Buffer.from(leerSecreto('RECOVERY MERCADOPAGO TOKEN ENCRYPTION KEY').secreto,'base64url'),'AES-GCM',false,['decrypt']);
const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:Buffer.from(`${ref}:test:2691240967769590:${business}:tokens`)},key,Buffer.from(ciphertext,'base64url'));
const token=JSON.parse(new TextDecoder().decode(bytes)).access_token;
assert.ok(token.startsWith('APP_USR-'));
async function get(p) {
  const r=await fetch(`https://api.mercadopago.com${p}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
  assert.equal(r.status,200,`provider read HTTP ${r.status}`);
  return r.json();
}
const seller=await get('/users/me');
assert.equal(String(seller.id),'3594962708'); assert.equal(seller.site_id,'MLA'); assert.ok(seller.tags.includes('test_user'));
const session=process.argv[2]; assert.match(session,/^[a-f0-9-]{36}$/);
const {data:intent,error:intentError}=await db.from('payment_intents').select('environment,preference_id,expected_amount,currency').eq('checkout_session_id',session).eq('business_id',business).single();
assert.ifError(intentError);assert.equal(intent.environment,'test');
const pref=await get(`/checkout/preferences/${intent.preference_id}`);
assert.equal(String(pref.collector_id),'3594962708');
assert.equal(String(pref.client_id),'2691240967769590');
const preference={id:pref.id,collector_id:pref.collector_id,client_id:pref.client_id,site_id:pref.site_id,init_host:new URL(pref.init_point).host,external_reference:pref.external_reference,expires:pref.expires,expiration_date_to:pref.expiration_date_to,binary_mode:pref.binary_mode,auto_return:pref.auto_return,notification_url:pref.notification_url,back_urls:pref.back_urls,payment_methods:pref.payment_methods,items:(pref.items||[]).map(i=>({id:i.id,quantity:i.quantity,unit_price:i.unit_price,currency_id:i.currency_id})),payer_email_present:!!pref.payer?.email};
const search=await get(`/v1/payments/search?${new URLSearchParams({external_reference:`taba2:checkout:${session}`,sort:'date_created',criteria:'desc',limit:'10'})}`);
const payments=[];
for(const found of search.results || []) {
  const p=await get(`/v1/payments/${found.id}`);
  assert.equal(String(p.collector_id),'3594962708');
  assert.equal(String(p.payer.id),'3594962710');
  payments.push({id:String(p.id),status:p.status,status_detail:p.status_detail,amount:p.transaction_amount,currency:p.currency_id,collector_id:String(p.collector_id),payer_id:String(p.payer.id),live_mode:p.live_mode,external_reference:p.external_reference,preference_id:p.metadata?.preference_id || p.preference_id || null,refunded_amount:p.transaction_amount_refunded,refunds:(p.refunds||[]).map(r=>({id:r.id,amount:r.amount,status:r.status})),date_created:p.date_created,date_approved:p.date_approved,payment_method_id:p.payment_method_id});
}
console.log(JSON.stringify({at:new Date().toISOString(),project:ref,session,seller_test_user:true,buyer_match_in_payments:payments.length?payments.every(p=>p.payer_id==='3594962710'):null,preference,provider_count:search.paging?.total,payments},null,2));
