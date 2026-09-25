import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { borrarSecreto, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';
const project='ucbtjcurawxjwjdvvcvj',url=`https://${project}.supabase.co`;
const business='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const run='STAGING PILOT STOCK RACE 20260923';
if(leerSecreto(run))throw Error('QA_RUN_EXISTS_REVIEW_BEFORE_RETRY');
const {secret,publishable}=await loadStagingKeys();
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const customer=createClient(url,publishable,opts),staff=createClient(url,publishable,opts),admin=createClient(url,secret,opts);
const login=async(client,name)=>{
 const c=leerSecreto(name),r=await client.auth.signInWithPassword({email:c.usuario,password:c.secreto});
 if(r.error||!r.data.session)throw Error(`QA_AUTH_UNAVAILABLE:${r.error?.code||'NO_SESSION'}`);
 return r.data.user;
};
const buyer=await login(customer,'STAGING CUSTOMER QA 20260920');
await login(staff,'STAGING BUSINESS QA 20260920');
const read=async q=>{const {data,error}=await q;if(error)throw Error(`QA_READ:${error.code}`);return data};
const rpc=async(c,name,args)=>{const {data,error}=await c.rpc(name,args);if(error)throw Error(`QA_RPC:${name}:${error.code}`);return data};
await rpc(staff,'identity_register_session',{p_business_id:business,p_client:'panel_web',
 p_device_label:'Pilot stock race',p_device_key_hash:null,p_app_version:'pilot-qa'});
const addr=(await read(customer.from('customer_addresses').select('*').is('deleted_at',null)))
 .find(a=>a.location_confirmed_at&&a.latitude&&a.longitude);
if(!addr)throw Error('CONFIRMED_QA_ADDRESS_REQUIRED');
const availability=await rpc(staff,'commerce_availability',{p_business_id:business,p_channel:'delivery',p_context:{}});
const base=await read(staff.from('businesses').select('minimum_delivery_subtotal').eq('id',business).single());
const minimum=Number(availability.areas?.find(a=>a.name===addr.neighborhood)?.minimum_subtotal??base.minimum_delivery_subtotal??0);
const active=await read(staff.from('products').select('id,name,price,stock').eq('business_id',business)
 .eq('available',true).eq('is_active',true).eq('is_verified',true).eq('is_alcoholic',false).gt('stock',2));
const currentRider=JSON.parse(leerSecreto('RIDER CANONICAL QA RUN 20260922')?.secreto||'{}');
const candidate=active.map(p=>({p,quantity:Math.max(Math.floor(Number(p.stock)/2)+1,
  Math.ceil((minimum+1)/Number(p.price)))}))
 .find(x=>x.p.id!==currentRider.productId&&x.p.price>0&&x.quantity<=x.p.stock&&x.quantity<100);
if(!candidate)throw Error('STOCK_RACE_CANDIDATE_UNAVAILABLE');
const {p:product,quantity}=candidate;const stockBefore=Number(product.stock);
const payload=()=>({business_id:business,client_request_id:randomUUID(),tracking_token:randomBytes(32).toString('base64url'),
 items:[{product_id:product.id,quantity}],customer_name:'QA carrera stock',customer_phone:'2995550199',
 delivery_mode:'delivery',payment_method:'coordinate',age_confirmed:true,customer_address_id:addr.id,
 customer_street_address:`${addr.street} ${addr.street_number}`,customer_neighborhood:addr.neighborhood,
 customer_notes:'QA stock race — no despachar'});
const requests=[payload(),payload()];
guardarSecreto(run,'staging',JSON.stringify({productId:product.id,stockBefore,quantity,requestIds:requests.map(x=>x.client_request_id),orders:[]}));
const report={timestamp:new Date().toISOString(),project,stagingOnly:true,quantity,stockBefore};
let orders=[];let cleanupFailure=false;
try{
 const attempted=await Promise.all(requests.map(p=>customer.rpc('create_order_with_items',{payload:p})));
 orders=attempted.filter(r=>!r.error&&r.data?.id).map(r=>r.data);
 guardarSecreto(run,'staging',JSON.stringify({productId:product.id,stockBefore,quantity,
  requestIds:requests.map(x=>x.client_request_id),orders:orders.map(o=>o.id)}));
 const after=Number((await read(staff.from('products').select('stock').eq('id',product.id).single())).stock);
 report.accepted=orders.length;report.rejected=attempted.filter(r=>r.error).length;
 report.rejectionCodes=attempted.filter(r=>r.error).map(r=>r.error.code||'UNKNOWN');
 report.stockAfter=after;
 if(orders.length!==1||after!==stockBefore-quantity)throw Error('STOCK_ATOMICITY_NOT_CONFIRMED');
 const replay=await customer.rpc('create_order_with_items',{payload:requests[attempted.findIndex(r=>!r.error)]});
 if(replay.error||replay.data?.id!==orders[0].id)throw Error(`ORDER_IDEMPOTENCY_FAILED:${replay.error?.code||'MISMATCH'}`);
 const replayStock=Number((await read(staff.from('products').select('stock').eq('id',product.id).single())).stock);
 if(replayStock!==after)throw Error('IDEMPOTENT_REPLAY_DECREMENTED_STOCK');
 report.atomicity='PASS';report.idempotency='PASS';
}finally{
 const discovered=await admin.from('orders').select('id,client_request_id')
   .eq('customer_user_id',buyer.id).in('client_request_id',requests.map(x=>x.client_request_id));
 if(discovered.error)cleanupFailure=true;
 for(const found of discovered.data||[]){if(!orders.some(o=>o.id===found.id))orders.push({id:found.id})}
 for(const order of orders){
  try{
   const current=await read(staff.from('orders').select('revision,status').eq('id',order.id).single());
   if(!['canceled','cancelled','delivered','rejected'].includes(current.status)){
    const args={p_order_id:order.id,p_expected_revision:current.revision,
      p_reason:'QA: limpieza carrera concurrente de stock',p_idempotency_key:`qa_stock_cancel_${order.id.replaceAll('-','')}`};
    const cancelled=await rpc(staff,'cancel_order',args);
    const repeat=await rpc(staff,'cancel_order',args);
    if(!repeat.idempotent_replay)throw Error('CANCEL_IDEMPOTENCY_FAILED');
    if(!cancelled)throw Error('CANCEL_FAILED');
   }
   await rpc(admin,'classify_order_as_qa',{p_order_id:order.id,p_reason:'pilot_stock_race_qa'});
  }catch{cleanupFailure=true}
 }
 const restored=Number((await read(staff.from('products').select('stock').eq('id',product.id).single())).stock);
 report.stockRestored=restored===stockBefore;report.cleanup=cleanupFailure?'FAIL':'PASS';
 writeFileSync('artifacts/pilot-stock-concurrency.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
if(report.atomicity!=='PASS'||report.idempotency!=='PASS'||!report.stockRestored||cleanupFailure)process.exitCode=1;
else if(!borrarSecreto(run))process.exitCode=1;
