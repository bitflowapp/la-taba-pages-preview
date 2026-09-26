import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';
const ref='ucbtjcurawxjwjdvvcvj',url=`https://${ref}.supabase.co`;
const business='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const {secret,publishable}=await loadStagingKeys();
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,secret,opts);
const people=[
 ['customer','STAGING CUSTOMER QA 20260920',null],
 ['owner','STAGING PILOT OWNER QA 20260923','owner'],
 ['staff','STAGING PILOT STAFF QA 20260923','staff'],
 ['admin','STAGING BUSINESS QA 20260920','admin'],
 ['rider','STAGING RIDER QA 20260920','rider'],
];
const clients={};const checks={};
const check=(name,ok)=>{checks[name]=ok?'PASS':'FAIL';if(!ok)throw Error(`AUTH_RLS:${name}`)};
for(const [name,store,role] of people){
 const credential=leerSecreto(store);if(!credential)throw Error('QA_CREDENTIAL_REQUIRED');
 const client=createClient(url,publishable,opts);
 const login=await client.auth.signInWithPassword({email:credential.usuario,password:credential.secreto});
 check(`${name}_LOGIN`,!login.error&&!!login.data.session);
 clients[name]=client;
 if(role){
  const membership=await client.from('business_members').select('role,is_active')
   .eq('business_id',business).eq('user_id',login.data.user.id).single();
  check(`${name}_MEMBERSHIP`,!membership.error&&membership.data.role===role&&membership.data.is_active===true);
  const registered=await client.rpc('identity_register_session',{p_business_id:business,
   p_client:role==='rider'?'rider_android':'panel_web',p_device_label:'Pilot auth QA',
   p_device_key_hash:null,p_app_version:'pilot-qa'});
  check(`${name}_OPERATIONAL_SESSION`,!registered.error&&registered.data?.ok===true&&registered.data.role===role);
 }
}
const anonymous=createClient(url,publishable,opts);
const anonBoard=await anonymous.rpc('get_rider_delivery_board');
check('ANON_RIDER_BOARD_DENIED',!!anonBoard.error);
const customerBoard=await clients.customer.rpc('get_rider_delivery_board');
check('CUSTOMER_RIDER_BOARD_DENIED',!!customerBoard.error);
const staffPresence=await clients.staff.rpc('list_business_rider_availability',{p_business_id:business});
check('STAFF_SEES_RIDER_AVAILABILITY',!staffPresence.error&&staffPresence.data?.required===true);
for(const role of ['customer','staff','rider']){
 const wrong=await clients[role].rpc('set_business_rider_presence_policy',{p_business_id:business,p_required:false});
 check(`${role.toUpperCase()}_CANNOT_CHANGE_POLICY`,wrong.error?.code==='42501');
}
const ownerPolicy=await clients.owner.rpc('set_business_rider_presence_policy',{p_business_id:business,p_required:true});
check('OWNER_MANAGES_OWN_POLICY',!ownerPolicy.error&&ownerPolicy.data?.ok===true&&ownerPolicy.data?.changed===false);
const qaPayment=await admin.from('orders').select('id,revision').eq('business_id',business)
 .eq('origin','qa').eq('payment_method','cash').eq('manual_payment_status','reversed')
 .order('created_at',{ascending:false}).limit(1).maybeSingle();
if(qaPayment.error||!qaPayment.data)throw Error('QA_MANUAL_PAYMENT_FIXTURE_REQUIRED');
const denied=await clients.staff.rpc('reverse_manual_order_payment',{p_order_id:qaPayment.data.id,
 p_expected_revision:qaPayment.data.revision,p_reason:'QA rol staff no devuelve dinero',p_idempotency_key:`qa_denied_${randomUUID().replaceAll('-','')}`});
check('STAFF_MANUAL_REVERSAL_DENIED',denied.error?.code==='42501');
const outsider=await clients.customer.rpc('confirm_manual_order_payment',{p_order_id:qaPayment.data.id,
 p_expected_revision:qaPayment.data.revision,p_actual_method:'cash',p_idempotency_key:`qa_denied_${randomUUID().replaceAll('-','')}`});
check('CUSTOMER_MANUAL_CONFIRM_DENIED',outsider.error?.code==='42501');
const report={timestamp:new Date().toISOString(),project:ref,stagingOnly:true,checks};
writeFileSync('artifacts/pilot-auth-rls.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
