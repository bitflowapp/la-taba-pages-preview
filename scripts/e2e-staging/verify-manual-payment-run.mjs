import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { borrarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';
const run='STAGING MANUAL PAYMENT PILOT QA 20260923';
const state=JSON.parse(leerSecreto(run)?.secreto||'{}');
if(!state.orderId)throw Error('QA_RUN_NOT_FOUND');
const url='https://ucbtjcurawxjwjdvvcvj.supabase.co';
const {secret,publishable}=await loadStagingKeys();
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,secret,options),staff=createClient(url,publishable,options);
const credentials=leerSecreto('STAGING BUSINESS QA 20260920');
const signed=await staff.auth.signInWithPassword({email:credentials.usuario,password:credentials.secreto});
if(signed.error)throw Error('QA_LOGIN_FAILED');
const read=async request=>{const {data,error}=await request;if(error)throw Error(`QA_READ:${error.code}`);return data};
let order=await read(admin.from('orders').select('id,status,origin,manual_payment_status,manual_payment_method').eq('id',state.orderId).single());
if(!['canceled','cancelled'].includes(order.status)||order.manual_payment_status!=='reversed')throw Error('QA_ORDER_NOT_CLEAN');
const stock=Number((await read(staff.from('products').select('stock').eq('id',state.productId).single())).stock);
if(stock!==Number(state.stockBefore))throw Error('QA_STOCK_NOT_RESTORED');
const events=await read(admin.from('order_events').select('id').eq('order_id',state.orderId).in('event_type',['order.manual_payment_confirmed','order.manual_payment_reversed']));
if(events.length!==2)throw Error('QA_PAYMENT_AUDIT_MISMATCH');
const intents=await read(admin.from('payment_intents').select('id').eq('order_id',state.orderId));
if(intents.length)throw Error('QA_MANUAL_ORDER_HAS_MP_INTENT');
if(order.origin!=='qa'){
 const classified=await admin.rpc('classify_order_as_qa',{p_order_id:state.orderId,p_reason:'manual_payment_pilot_qa_cleanup'});
 if(classified.error)throw Error(`QA_CLASSIFICATION_FAILED:${classified.error.code}`);
 order=await read(admin.from('orders').select('id,status,origin,manual_payment_status,manual_payment_method').eq('id',state.orderId).single());
}
if(order.origin!=='qa')throw Error('QA_CLASSIFICATION_UNVERIFIED');
const report={timestamp:new Date().toISOString(),project:'ucbtjcurawxjwjdvvcvj',
 orderState:'TERMINAL',manualPayment:'REVERSED',stockRestored:true,auditEvents:events.length,
 mpIntentAbsent:true,qaClassified:true,priorRunRecordPresent:true};
writeFileSync(`artifacts/manual-payment-pilot-${Date.now()}.json`,JSON.stringify(report,null,2));
if(process.argv.includes('--seal')&&!borrarSecreto(run))throw Error('QA_RUN_STORE_CLEANUP_FAILED');
console.log(JSON.stringify({...report,temporaryRunRecordRemoved:process.argv.includes('--seal')}));
