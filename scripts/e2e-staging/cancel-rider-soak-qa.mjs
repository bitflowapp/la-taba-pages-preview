import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { leerSecreto, guardarSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';
const name='RIDER CANONICAL QA RUN 20260922';
const stored=leerSecreto(name);const state=JSON.parse(stored?.secreto||'{}');
if(!state.orderId)throw Error('QA_RUN_REQUIRED');
const {secret,publishable}=await loadStagingKeys();
const url='https://ucbtjcurawxjwjdvvcvj.supabase.co',business='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,secret,opts),staff=createClient(url,publishable,opts);
const credential=leerSecreto('STAGING BUSINESS QA 20260920');
const signed=await staff.auth.signInWithPassword({email:credential.usuario,password:credential.secreto});
if(signed.error||!signed.data.session)throw Error(`QA_STAFF_LOGIN_UNAVAILABLE:${signed.error?.code||'NO_SESSION'}`);
const rpc=async(c,fn,args)=>{const {data,error}=await c.rpc(fn,args);if(error)throw Error(`${fn}:${error.code}`);return data};
await rpc(staff,'identity_register_session',{p_business_id:business,p_client:'panel_web',
 p_device_label:'QA soak safe cancellation',p_device_key_hash:null,p_app_version:'pilot-qa'});
const getOrder=async()=>{const {data,error}=await admin.from('orders')
 .select('id,business_id,status,revision,origin,payment_method,manual_payment_status')
 .eq('id',state.orderId).single();if(error)throw Error(`ORDER_READ:${error.code}`);return data};
let order=await getOrder();
if(order.business_id!==business||order.payment_method!=='coordinate')throw Error('QA_ORDER_SCOPE_MISMATCH');
if(!['canceled','cancelled'].includes(order.status)){
 const done=await rpc(staff,'cancel_order',{p_order_id:state.orderId,p_expected_revision:order.revision,
  p_reason:'QA: Moto sin red durante soak físico',p_idempotency_key:`qa_soak_cancel_${state.orderId.replaceAll('-','')}`});
 if(!done)throw Error('QA_CANCEL_NOT_CONFIRMED');
 order=await getOrder();
}
if(!['canceled','cancelled'].includes(order.status))throw Error('QA_ORDER_NOT_TERMINAL');
if(order.manual_payment_status==='confirmed')throw Error('QA_MANUAL_PAYMENT_MUST_BE_REVERSED_FIRST');
const classification=await rpc(admin,'classify_order_as_qa',{p_order_id:state.orderId,p_reason:'rider_soak_network_failure_qa'});
order=await getOrder();if(order.origin!=='qa')throw Error('QA_CLASSIFICATION_NOT_CONFIRMED');
const {data:product,error:productError}=await admin.from('products').select('stock').eq('id',state.productId).single();
if(productError)throw Error(`PRODUCT_READ:${productError.code}`);
let expected=null;
try{const inspected=JSON.parse(readFileSync('artifacts/rider-canonical-inspect.json','utf8'));
 expected=inspected.availableProducts?.find(p=>p.id===state.productId)?.stock??null}catch{}
const report={timestamp:new Date().toISOString(),project:'ucbtjcurawxjwjdvvcvj',
 orderTerminal:'CANCELLED',qaClassified:true,manualPaymentNotConfirmed:true,
 stockAfter:Number(product.stock),stockBeforeKnown:expected!==null,
 stockRestored:expected===null?null:Number(product.stock)===Number(expected),
 soakStatus:'FAIL_NETWORK_UNAVAILABLE',noSqlStateChanges:true};
writeFileSync('artifacts/rider-pilot-soak-cancel.json',JSON.stringify(report,null,2));
delete state.tracking;delete state.deliveryCode;delete state.offer;state.sealedAt=report.timestamp;
guardarSecreto(name,'staging',JSON.stringify(state));
console.log(JSON.stringify(report));
if(report.stockRestored===false)process.exitCode=1;
