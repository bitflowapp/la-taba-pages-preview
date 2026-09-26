import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';

const mode=process.argv[2];
if(!['verify','activate','exercise','rollback'].includes(mode))throw Error('USE_VERIFY_ACTIVATE_EXERCISE_OR_ROLLBACK');
const business='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const url='https://ucbtjcurawxjwjdvvcvj.supabase.co';
const {publishable}=await loadStagingKeys();
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const actor=async name=>{
 const c=leerSecreto(name);if(!c)throw Error('QA_CREDENTIAL_REQUIRED');
 const client=createClient(url,publishable,opts);
 const signed=await client.auth.signInWithPassword({email:c.usuario,password:c.secreto});
 if(signed.error||!signed.data.session)throw Error(`QA_AUTH_UNAVAILABLE:${signed.error?.code||'NO_SESSION'}`);
 return {client,user:signed.data.user,credential:c};
};
const rpc=async(c,name,args={})=>{
 const {data,error}=await c.rpc(name,args);
 if(error)throw Error(`QA_RPC:${name}:${error.code}`);
 return data;
};
const staff=await actor('STAGING BUSINESS QA 20260920');
const a=await actor('STAGING RIDER QA 20260920');
const b=await actor('STAGING RIDER B CANONICAL QA 20260922');
const register=async(actor,client)=>rpc(actor.client,'identity_register_session',{
 p_business_id:business,p_client:client,p_device_label:'Pilot availability QA',p_device_key_hash:null,p_app_version:'pilot-qa'});
await register(staff,'panel_web');await register(a,'rider_android');await register(b,'rider_android');
const report={timestamp:new Date().toISOString(),mode,project:'ucbtjcurawxjwjdvvcvj',stagingOnly:true};
const directory=()=>rpc(staff.client,'list_business_rider_availability',{p_business_id:business});
const board=(actor)=>rpc(actor.client,'get_rider_delivery_board');
const flip=async(actor,value)=>{
 const current=await board(actor);
 const result=await rpc(actor.client,'set_rider_availability',{
  p_business_id:business,p_available:value,p_expected_version:current.availability_version,
  p_idempotency_key:`qa_availability_${randomUUID().replaceAll('-','')}`});
 if(!result.ok)throw Error(`QA_AVAILABILITY:${result.code}`);
 return result;
};
const assert=(name,ok)=>{report[name]=ok?'PASS':'FAIL';if(!ok)throw Error(`PRESENCE_GATE:${name}`)};
const anon=createClient(url,publishable,opts);
const anonRead=await anon.from('rider_availability').select('rider_user_id').limit(1);
assert('ANON_CANNOT_READ_TABLE',anonRead.error?.code==='42501');
const riderRead=await b.client.from('rider_availability').select('rider_user_id').limit(1);
assert('RIDER_CANNOT_READ_PRIVATE_TABLE',riderRead.error?.code==='42501');
const anonList=await anon.rpc('list_business_rider_availability',{p_business_id:business});
assert('ANON_CANNOT_LIST',!!anonList.error);

const initial=await directory();
assert('DIRECTORY_HAS_RIDERS',initial.riders.some(r=>r.rider_user_id===a.user.id)&&initial.riders.some(r=>r.rider_user_id===b.user.id));
if(mode==='verify'){
 report.required=initial.required===true;
 report.activeDeliveryPolicy=(await board(a)).max_active_orders;
 assert('ACTIVE_POLICY_THREE',report.activeDeliveryPolicy===3);
}
if(mode==='activate'){
 const before=await board(a),beforeB=await board(b);
 assert('QA_RIDERS_IDLE',before.orders.length===0&&beforeB.orders.length===0);
 const enabled=await rpc(staff.client,'set_business_rider_presence_policy',{p_business_id:business,p_required:true});
 assert('QA_BUSINESS_POLICY_ENABLED',enabled.ok===true&&(await directory()).required===true);
}
if(mode==='exercise'){
 assert('QA_BUSINESS_POLICY_ENABLED',initial.required===true);
 if((await board(a)).available)await flip(a,false);
 if((await board(b)).available)await flip(b,false);
 const start=await board(a);
 assert('DEFAULT_UNAVAILABLE',start.available===false);
 const available=await flip(a,true);
 const visible=(await directory()).riders.find(r=>r.rider_user_id===a.user.id);
 assert('PANEL_SEES_AVAILABLE',visible.available===true);
 const second=await actor('STAGING RIDER QA 20260920');await register(second,'rider_android');
 assert('SECOND_DEVICE_SEES_AVAILABLE',(await board(second)).available===true);
 const replay=await rpc(a.client,'set_rider_availability',{
  p_business_id:business,p_available:true,p_expected_version:available.version,
  p_idempotency_key:`qa_availability_${randomUUID().replaceAll('-','')}`});
 assert('NOOP_PRESERVES_VERSION',replay.idempotent_no_op===true&&replay.version===available.version);
 const denied=await b.client.rpc('set_rider_availability',{
  p_business_id:randomUUID(),p_available:true,p_expected_version:0,p_idempotency_key:`qa_denied_${randomUUID().replaceAll('-','')}`});
 assert('RIDER_CANNOT_CHANGE_OTHER_BUSINESS',denied.error?.code==='42501');
 await flip(second,false);
 assert('FIRST_DEVICE_SEES_UNAVAILABLE',(await board(a)).available===false);
 assert('PANEL_SEES_UNAVAILABLE',(await directory()).riders.find(r=>r.rider_user_id===a.user.id).available===false);
 await flip(b,true);
 assert('RIDER_B_DOES_NOT_MODIFY_A',(await board(a)).available===false);
 await flip(b,false);
 await a.client.auth.signOut();
 const signedAgain=await actor('STAGING RIDER QA 20260920');await register(signedAgain,'rider_android');
 assert('LOGOUT_LOGIN_CONSISTENT',(await board(signedAgain)).available===false);
 report.finalRiderA='UNAVAILABLE';report.finalRiderB='UNAVAILABLE';
}
if(mode==='rollback'){
 assert('START_REQUIRED',initial.required===true);
 const aBoard=await board(a),bBoard=await board(b);
 assert('QA_RIDERS_IDLE',aBoard.orders.length===0&&bBoard.orders.length===0
  &&aBoard.offers.length===0&&bBoard.offers.length===0);
 try{
  const off=await rpc(staff.client,'set_business_rider_presence_policy',{p_business_id:business,p_required:false});
  assert('POLICY_DISABLED',off.ok===true&&(await directory()).required===false);
  assert('OLD_BOARD_COMPATIBLE',(await board(a)).availability_required===false);
 }finally{
  await rpc(staff.client,'set_business_rider_presence_policy',{p_business_id:business,p_required:true});
 }
 assert('POLICY_RESTORED',(await directory()).required===true
  &&(await board(a)).availability_required===true);
 report.configRollback='PASS';
}
writeFileSync(`artifacts/rider-presence-${mode}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
