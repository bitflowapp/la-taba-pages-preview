import {withRecoveryProject} from './hosted-client.mjs';
import fs from 'node:fs';import {createClient} from '@supabase/supabase-js';
import {leerSecreto} from '../e2e-production-sale/secretos-windows.mjs';
const value=name=>process.argv[process.argv.indexOf(name)+1];
if(!['--target','--evidence-directory','--run-tests'].every(a=>process.argv.includes(a)))throw Error('Requires --run-tests --target --evidence-directory');
const dir=value('--evidence-directory');fs.mkdirSync(dir,{recursive:true});const target=JSON.parse(fs.readFileSync(value('--target')));
await withRecoveryProject(target,async()=>{});const base='https://'+target.projectRef+'.supabase.co';const publicCredential=leerSecreto('RECOVERY SUPABASE ANON KEY');const serviceCredential=leerSecreto('RECOVERY SUPABASE SERVICE KEY');
if(publicCredential?.usuario!==target.projectRef||serviceCredential?.usuario!==target.projectRef)throw Error('Credential project binding mismatch');
const pub=publicCredential.secreto;const secret=serviceCredential.secreto;
const proof={at:new Date().toISOString(),projectRef:target.projectRef,checks:[],providerTransactionsExecuted:false};const record=(name,pass,details={})=>{proof.checks.push({name,passed:pass,...details});console.log(proof.checks.at(-1));fs.writeFileSync(dir+'/hosted-api-tests.json',JSON.stringify(proof,null,2));};
const client=createClient(base,pub,{auth:{persistSession:false,autoRefreshToken:false}});const service=createClient(base,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await client.auth.signInAnonymously({options:{data:{recovery_qa:true}}});if(error||!data.session)throw Error('Anonymous auth failed');const user=data.user.id;record('Auth anonymous sign-in',true,{syntheticIdentity:true});
try{
const refresh=await client.auth.refreshSession();record('Auth token refresh',!refresh.error&&!!refresh.data.session);
const access=refresh.data.session.access_token;
const request=async(path,body,auth,origin=target.checkoutOrigin)=>{const r=await fetch(base+path,{method:'POST',headers:{apikey:pub,'Content-Type':'application/json',origin,...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await r.json().catch(()=>({}));return {status:r.status,code:data.code||data.error||data.message};};
let r=await request('/functions/v1/mercadopago-create-checkout-session',{},null);record('Checkout rejects missing authentication',r.status===401,r);
r=await request('/functions/v1/mercadopago-create-checkout-session',{},access,'https://example.invalid');record('Checkout rejects foreign origin',r.status===403,r);
r=await request('/functions/v1/mercadopago-create-checkout-session',{business_id:'00000000-0000-4000-8000-000000000001',client_request_id:'qa-hosted-unavailable',items:[],payment_method:'mercadopago'},access);record('Disconnected seller cannot reserve stock',r.status===409&&r.code==='PAYMENTS_NOT_ENABLED',r);
r=await request('/functions/v1/mercadopago-connect',{business_id:'00000000-0000-4000-8000-000000000001',action:'connect'},access);record('Guest cannot authorize seller OAuth',r.status===403,r);
for(const name of ['mercadopago-cancel-payment','mercadopago-refund']){r=await request('/functions/v1/'+name,{},null);record(name+' rejects unauthenticated caller',r.status===401,r);}
r=await request('/functions/v1/mercadopago-webhook',{type:'payment',data:{id:'00000000000'}},null);record('Unsigned webhook is not accepted',r.status>=400,r);
for(const table of ['payment_intents','mp_seller_connections','mp_oauth_states']){const r=await fetch(base+'/rest/v1/'+table+'?select=*',{headers:{apikey:pub,Authorization:'Bearer '+access}});record('RLS / grants deny guest '+table,r.status===401||r.status===403,{httpStatus:r.status})}
const sub=service.channel('recovery-hosted-verification').on('postgres_changes',{event:'UPDATE',schema:'public',table:'businesses',filter:'id=eq.00000000-0000-4000-8000-000000000001'},payload=>{if(payload.new?.ordering_enabled===false)resolveEvent(true)});
let resolveEvent;const event=new Promise(resolve=>{resolveEvent=resolve});
const status=await new Promise(resolve=>{const timer=setTimeout(()=>resolve('TIMEOUT'),20000);sub.subscribe(s=>{if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(s)){clearTimeout(timer);resolve(s)}})});record('Realtime authenticated subscription',status==='SUBSCRIBED',{status});
if(status==='SUBSCRIBED'){await service.from('businesses').update({ordering_enabled:false,updated_at:new Date().toISOString()}).eq('id','00000000-0000-4000-8000-000000000001');const timer=setTimeout(()=>resolveEvent(false),15000);const received=await event;clearTimeout(timer);record('Realtime delivers database change',received)}await service.removeChannel(sub);
const object='recovery-qa-'+Date.now()+'.pdf';const uploaded=await service.storage.from('fiscal-documents').upload(object,new Blob(['%PDF-1.4 recovery QA only'],{type:'application/pdf'}));record('Storage service upload to private bucket',!uploaded.error);
if(!uploaded.error){const r=await fetch(base+'/storage/v1/object/public/fiscal-documents/'+object);record('Storage private document cannot be fetched publicly',r.status!==200,{httpStatus:r.status});const removed=await service.storage.from('fiscal-documents').remove([object]);record('Storage QA object cleanup',!removed.error)}
}finally{await client.auth.signOut({scope:'global'});const deleted=await service.auth.admin.deleteUser(user);record('Synthetic Auth identity cleanup',!deleted.error);}
if(proof.checks.some(t=>!t.passed))process.exitCode=1;
