// Bounded negative requests and one signed replay, using only existing authorized QA identities/payments.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {leerSecreto} from '../e2e-production-sale/secretos-windows.mjs';
const ref='ixewllzzuzpqrkxzmfzx', business='7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01';
const target=JSON.parse(fs.readFileSync('deploy/recovery-free-hosted.json','utf8'));
assert.equal(target.projectRef,ref);assert.equal(target.environment,'test');assert.equal(target.mercadoPagoApplicationId,'4861627125869370');
const secret=name=>{const c=leerSecreto(name);assert.equal(c?.usuario,ref);return c.secreto;};
const url=`https://${ref}.supabase.co`,anon=secret('RECOVERY SUPABASE ANON KEY');
const admin=createClient(url,secret('RECOVERY SUPABASE SERVICE KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const buyer=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const login=leerSecreto('RECOVERY QA BUYER');assert.match(login.usuario,/@qa\.lataba\.invalid$/);
const signed=await buyer.auth.signInWithPassword({email:login.usuario,password:login.secreto});assert.ifError(signed.error);
async function read(q){const {data,error}=await q;assert.ok(!error,`QA read ${error?.code||''}`);return data;}
const products=await read(admin.from('products').select('id,sku,stock').eq('business_id',business).order('sku'));
const product=products.find(p=>p.sku==='QA-REC-001'),last=products.find(p=>p.sku==='QA-REC-003');
assert.equal(last.stock,1);
const report={at:new Date().toISOString(),ref,synthetic:true,provider_payments_created:0,negative_requests:[]};
async function invoke(name,body){
 const r=await fetch(`${url}/functions/v1/${name}`,{method:'POST',headers:{authorization:`Bearer ${signed.data.session.access_token}`,apikey:anon,origin:target.checkoutOrigin,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 return {http:r.status,body:await r.json()};
}
const base=()=>({business_id:business,client_request_id:randomUUID(),items:[{product_id:product.id,quantity:1}],fulfillment_type:'pickup',contact:{name:'QA Auditor Codex',phone:'2995550811'},address:{},age_confirmed:false,payment_method:'mercadopago'});
for(const [name,change] of [
 ['price manipulation',{total:1}],['negative quantity',{items:[{product_id:product.id,quantity:-1}]}],
 ['fractional quantity',{items:[{product_id:product.id,quantity:1.5}]}],
 ['foreign merchant',{business_id:'7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a02'}],
 ['insufficient stock',{items:[{product_id:last.id,quantity:2}]}],
]){
 const result=await invoke('mercadopago-create-checkout-session',{...base(),...change});
 report.negative_requests.push({name,http:result.http,code:result.body.code,refused:result.http>=400});
 assert.ok(result.http>=400,`${name} unexpectedly accepted`);
}
const foreign=await invoke('mercadopago-checkout-status',{checkout_session_id:'627c27ae-64eb-4763-a6a9-fee9ed399b5c'});
report.negative_requests.push({name:'other customer checkout',http:foreign.http,code:foreign.body.code,refused:foreign.http>=400});
assert.ok(foreign.http>=400);
const after=await read(admin.from('products').select('id,sku,stock').eq('business_id',business).order('sku'));
assert.deepEqual(after,products,'negative requests must not reserve stock');
report.stock_unchanged=true;
// The payment is real QA, but these two deliveries are explicitly an auditor-generated signed replay.
const payment='185029125913',requestId=randomUUID(),ts=String(Math.floor(Date.now()/1000));
const webhookSecret=leerSecreto('RECOVERY MP TESTAPP WEBHOOK SECRET');
assert.equal(String(webhookSecret.usuario),'4861627125869370');
const v1=createHmac('sha256',webhookSecret.secreto).update(`id:${payment};request-id:${requestId};ts:${ts};`).digest('hex');
const event={id:randomUUID(),type:'payment',action:'payment.updated',data:{id:payment},user_id:3594962708,live_mode:true};
report.signed_replay=[];
for(let i=0;i<2;i++){
 const response=await fetch(`${url}/functions/v1/mercadopago-webhook?data.id=${payment}&type=payment`,{method:'POST',headers:{'content-type':'application/json','x-request-id':requestId,'x-signature':`ts=${ts},v1=${v1}`},body:JSON.stringify(event),signal:AbortSignal.timeout(30000)});
 const result=await response.json();
 report.signed_replay.push({http:response.status,receipt_id:result.receipt_id,duplicate:result.duplicate,queued:result.queued});
 assert.equal(response.status,201);
}
assert.equal(report.signed_replay[0].receipt_id,report.signed_replay[1].receipt_id);
assert.equal(report.signed_replay[1].duplicate,true);
report.payment_replayed=payment;
console.log(JSON.stringify(report,null,2));
