import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';
const ref='ucbtjcurawxjwjdvvcvj',url=`https://${ref}.supabase.co`;
const business='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const state=JSON.parse(leerSecreto('RIDER CANONICAL QA RUN 20260922')?.secreto||'{}');
if(!state.orderId||!state.productId||!Number.isInteger(state.quantity))throw Error('QA_RUN_REQUIRED');
const baseline=JSON.parse(readFileSync('artifacts/rider-canonical-inspect.json','utf8'))
 .availableProducts?.find(p=>p.id===state.productId)?.stock;
if(!Number.isInteger(Number(baseline)))throw Error('QA_STOCK_BASELINE_UNKNOWN');
const {secret,publishable}=await loadStagingKeys();
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,secret,opts),staff=createClient(url,publishable,opts);
const row=await admin.from('orders').select('business_id,origin,status,payment_method')
 .eq('id',state.orderId).single();
if(row.error||row.data.business_id!==business||row.data.origin!=='qa'
 ||!['canceled','cancelled'].includes(row.data.status)||row.data.payment_method!=='coordinate')
 throw Error('QA_TERMINAL_ORDER_SCOPE_REQUIRED');
const credential=leerSecreto('STAGING BUSINESS QA 20260920');
const signed=await staff.auth.signInWithPassword({email:credential.usuario,password:credential.secreto});
if(signed.error||!signed.data.session)throw Error(`QA_STAFF_AUTH_UNAVAILABLE:${signed.error?.code||'NO_SESSION'}`);
const registration=await staff.rpc('identity_register_session',{p_business_id:business,p_client:'panel_web',
 p_device_label:'QA returned stock',p_device_key_hash:null,p_app_version:'pilot-qa'});
if(registration.error||registration.data?.ok!==true)throw Error('QA_STAFF_SESSION_REQUIRED');
const stock=async()=>{
 const q=await admin.from('products').select('stock').eq('id',state.productId).single();
 if(q.error)throw Error(`STOCK_READ:${q.error.code}`);return Number(q.data.stock);
};
const before=await stock();
if(before!==Number(baseline)&&before!==Number(baseline)-state.quantity)
 throw Error('QA_STOCK_CHANGED_OUTSIDE_THIS_RUN');
let applied=false;
if(before!==Number(baseline)){
 const args={p_business_id:business,p_product_id:state.productId,p_barcode_id:null,
  p_movement_type:'manual_adjustment',p_package_quantity:state.quantity,p_direction:1,
  p_reference_type:'qa_soak_return',p_reference_id:state.orderId,
  p_reason:'QA: mercadería no salió físicamente; devolución tras soak sin red',
  p_idempotency_key:`qa_soak_restore_${state.orderId.replaceAll('-','')}`};
 const first=await staff.rpc('apply_inventory_movement',args);
 if(first.error||first.data?.ok===false)throw Error(`QA_STOCK_RETURN_FAILED:${first.error?.code||first.data?.code}`);
 applied=true;
 const second=await staff.rpc('apply_inventory_movement',args);
 if(second.error||second.data?.ok===false)throw Error(`QA_STOCK_RETURN_REPLAY_FAILED:${second.error?.code||second.data?.code}`);
}
const after=await stock();
const report={timestamp:new Date().toISOString(),project:ref,qaOnly:true,
 orderTerminal:'CANCELLED',goodsPhysicallyMoved:false,stockBaseline:Number(baseline),
 stockBefore:before,stockAfter:after,movementApplied:applied,
 exactOnceReturn:after===Number(baseline),normalInventoryRpc:true};
writeFileSync('artifacts/rider-pilot-soak-stock-return.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!report.exactOnceReturn)process.exitCode=1;
