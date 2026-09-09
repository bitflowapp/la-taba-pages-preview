// Independent adversarial harness: actual Git handlers, actual PostgreSQL RPCs.
// Provider transport is synthetic and cannot reach the network. No app helper
// or test assertion is used to decide which SQL mutations should be rejected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const container=process.argv[2];
if(process.env.TABA_LOCAL_PAYMENT_DB!=='1'||!/^taba-a1-a4-local-[\w-]+$/.test(container||''))throw Error('Disposable local DB required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');
assert.equal(info.Mounts.some(m=>m.Type==='bind'),false);
const args=['exec','-i',container,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('docker',args,{input:'set search_path=public,extensions;\n'+q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const quote=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const call=(name,p)=>JSON.parse(sql(`select to_jsonb(public.${name}(${Object.entries(p).map(([k,v])=>k+' => '+quote(v)).join(',')}))`));
const uid=randomUUID(),bid=randomUUID(),product=randomUUID(),asset=randomUUID();
const sellerId=String(100000000+Math.floor(Math.random()*800000000));
let fixture=fs.readFileSync('supabase/tests/mercadopago_checkout_pro.local.sql','utf8');
fixture=fixture.slice(0,fixture.indexOf('  v_prepare := public.prepare_mercadopago_preference'))+'\nend; $$; commit;';
for(const [old,v] of [['10000000-0000-4000-8000-000000000001',uid],['20000000-0000-4000-8000-000000000001',bid],['30000000-0000-4000-8000-000000000001',product],['40000000-0000-4000-8000-000000000001',asset]])fixture=fixture.replaceAll(old,v);
fixture=fixture.replaceAll('mp-lifecycle-fixture','mp-v2-'+bid).replaceAll('mp-checkout-test@example.invalid',uid+'@example.invalid');
sql(fixture);
const {sid,iid}=JSON.parse(sql(`select json_build_object('sid',cs.id,'iid',pi.id) from checkout_sessions cs join payment_intents pi on pi.checkout_session_id=cs.id where cs.business_id=${quote(bid)}`));
const env=new Map(Object.entries({
 SUPABASE_URL:'https://wwcpogltfgzgkrlilbcd.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',
 MERCADOPAGO_ENVIRONMENT:'production',MERCADOPAGO_OAUTH_ENVIRONMENT:'production',MERCADOPAGO_CREDENTIAL_MODE:'oauth',
 MERCADOPAGO_PRODUCTION_REVIEW_STATUS:'approved',MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION:'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE',
 TABA_DEPLOYMENT_ENV:'production',MERCADOPAGO_OAUTH_PROJECT_REF:'wwcpogltfgzgkrlilbcd',MERCADOPAGO_CLIENT_ID:'7677852968049976',
 MERCADOPAGO_OAUTH_PANEL_URL:'https://la-taba.pages.dev/',TABA_CHECKOUT_BASE_URL:'https://la-taba.pages.dev',TABA_ALLOWED_ORIGINS:'https://la-taba.pages.dev',
 PAYMENT_LOG_HASH_SALT:'fixture-salt',MERCADOPAGO_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64url'),
}));
let handler,route,mutation,stage,aid,encrypted,rotated,phase='old',revision='a56a9c5',providerPosts=0,financialPosts=0;
let pause,arrived,release;
let mutationError;
const client={auth:{getUser:async()=>({data:{user:{id:uid}},error:null})},
 from(table){assert.ok(['businesses','business_payment_settings','mp_seller_connections','payment_intents'].includes(table)); const filters=[];
 const q={select(){return q;},eq(k,v){assert.match(k,/^\w+$/);filters.push(k+'='+quote(v));return q;},
 async maybeSingle(){return {data:JSON.parse(sql(`select coalesce((select to_jsonb(t) from ${table} t where ${filters.join(' and ')}),'null'::jsonb)`)),error:null};},async single(){return q.maybeSingle();}};return q;},
 async rpc(name,p){
  assert.match(name,/^(prepare_payment_refund|prepare_mercadopago_preference|record_mercadopago_preference|get_mercadopago_payment_authority|consume_payment_rate_limit)/);
  if(name==='consume_payment_rate_limit')return {data:{allowed:true},error:null};
  try {return {data:call(name,p),error:null};}catch(e){return {data:null,error:{message:'fixture SQL rejected',detail:e.stderr?.toString()}};}
 }
};
function mutate(){
 if(mutation==='cancel')sql(`update payment_attempts set status='cancelled' where id=${quote(aid)}`);
 if(mutation==='supersede'||mutation==='concurrent'){
  sql(`update payment_intents set internal_status='failed' where id=${quote(iid)}`);
  call(phase==='old'?'prepare_mercadopago_preference':'prepare_mercadopago_preference_v2',{p_checkout_session_id:sid,p_customer_id:uid,p_new_attempt:true});
 }
 if(mutation==='preference')sql(`update payment_attempts set preference_id='changed' where id=${quote(aid)}`);
 if(mutation==='url')sql(`update payment_attempts set init_point='https://www.mercadopago.com.ar/changed' where id=${quote(aid)}`);
 if(mutation==='id'||mutation==='same-seller-other-attempt')sql(`update payment_attempts set id=${quote(randomUUID())} where id=${quote(aid)}`);
 if(mutation==='aba')sql(`update payment_attempts set status='cancelled' where id=${quote(aid)}; update payment_attempts set status='created' where id=${quote(aid)}`);
 if(mutation==='disable')sql(`update business_payment_settings set enabled=false where business_id=${quote(bid)}`);
 if(mutation==='close')sql(`update businesses set status='closed',ordering_enabled=false where id=${quote(bid)}`);
 if(mutation==='credential')sql(`update mp_seller_connections set protected_tokens=${quote(rotated)} where business_id=${quote(bid)}`);
}
async function provider(input,init){
 const u=new URL(String(input));assert.equal(u.origin,'https://api.mercadopago.com');
 if(init?.method==='POST' && u.pathname.includes('/refunds'))financialPosts++;
 assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-verified-token');
 if(u.pathname==='/users/me'){
  if(stage==='identity')try {mutate();} catch(e) {mutationError=e;throw e;}
  if(pause){arrived();await pause;}
  return Response.json({id:Number(sellerId),site_id:'MLA',tags:['normal']});
 }
 if(u.pathname==='/checkout/preferences/search'){
  const elements=route==='recovered'?[{id:'fixture-'+aid,external_reference:'taba2:checkout:'+sid}]:[];
  return Response.json({elements,paging:{total:elements.length,limit:10,offset:0}});
 }
 if(u.pathname.startsWith('/checkout/preferences')){
  if(init?.method==='POST')providerPosts++;
  if(stage==='persist')try {mutate();} catch(e) {mutationError=e;throw e;}
  return Response.json({id:'fixture-'+aid,init_point:'https://www.mercadopago.com.ar/fixture-'+aid,
   collector_id:sellerId,external_reference:'taba2:checkout:'+sid,metadata:{payment_attempt_id:aid,checkout_session_id:sid}});
 }
 throw Error('Unmocked I/O prohibited');
}
async function load(ref,entry='supabase/functions/mercadopago-create-preference/index.ts'){
 const cache=new Map();const context=vm.createContext({URL,URLSearchParams,Headers,Request,Response,TextEncoder,TextDecoder,crypto:globalThis.crypto,
 AbortSignal,AbortController,Uint8Array,setTimeout,clearTimeout,btoa,atob,console:{info(){}},Deno:{env:{get:k=>env.get(k)},serve:fn=>{handler=fn;}},fetch:provider});
 function module(file){if(cache.has(file))return cache.get(file);const source=file.startsWith('npm:')?'':ref?execFileSync('git',['show',ref+':'+path.relative(process.cwd(),file).replaceAll('\\','/')],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
 const m=file.startsWith('npm:')?new vm.SyntheticModule(['createClient'],function(){this.setExport('createClient',()=>client);},{context,identifier:file}):new vm.SourceTextModule(stripTypeScriptTypes(source,{mode:'transform'}),{context,identifier:file});cache.set(file,m);return m;}
 const m=module(path.resolve(entry));await m.link((s,p)=>module(s.startsWith('npm:')?s:path.resolve(path.dirname(p.identifier),s)));await m.evaluate();
 const oauth=cache.get(path.resolve('supabase/functions/_shared/seller-oauth.ts'))?.namespace;
 if(oauth){encrypted=await oauth.protect({access_token:'fixture-verified-token'},bid);rotated=await oauth.protect({access_token:'fixture-rotated-token'},bid);}
 return m.namespace;
}
const snapshotArgs=()=>({p_business_id:bid,p_environment:'production',p_checkout_session_id:sid,p_customer_id:uid,p_payment_attempt_id:aid});
function reset(){
 // Fixture rewind only. Every tested handler/RPC/race below runs with triggers ON.
 sql(`begin; set local session_replication_role=replica;
 delete from payment_attempts where payment_intent_id=${quote(iid)};
 update businesses set status='open',ordering_enabled=true where id=${quote(bid)};
 update checkout_sessions set status='ready_for_payment',expires_at=now()+interval '1 hour' where id=${quote(sid)};
 update inventory_reservations set status='active',expires_at=now()+interval '1 hour' where checkout_session_id=${quote(sid)};
 update payment_intents set environment='production',internal_status='created',preference_id=null,provider_payment_id=null where id=${quote(iid)};
 update business_payment_settings set enabled=true,environment='production',production_review_status='approved',collector_id=${quote(sellerId)},application_id='7677852968049976' where business_id=${quote(bid)};
 insert into mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
 values(${quote(bid)},'production',${quote(sellerId)},'7677852968049976','connected',${quote(encrypted)},now()+interval '2 days')
 on conflict(business_id,environment) do update set protected_tokens=excluded.protected_tokens; commit;`);
 const prep=call(phase==='old'?'prepare_mercadopago_preference':'prepare_mercadopago_preference_v2',{p_checkout_session_id:sid,p_customer_id:uid,p_new_attempt:false});aid=prep.payment_attempt_id;
 if(route.startsWith('stored')){
 const p={p_payment_attempt_id:aid,p_preference_id:'fixture-'+aid,p_init_point:'https://www.mercadopago.com.ar/fixture-'+aid,p_sandbox_init_point:null,p_response_hash:'a'.repeat(64),p_provider_request_id:null};
 if(phase==='old')call('record_mercadopago_preference_created',p);
 else call('record_mercadopago_preference_created_v2',{...snapshotArgs(),p_expected_authority:call('get_mercadopago_payment_authority_v2',snapshotArgs()).authority_version,...p});
 if(route==='stored_legacy')sql(`update payment_attempts set seller_generation=null,seller_id=null where id=${quote(aid)};
   update payment_intents set current_payment_attempt_id=null where id=${quote(iid)}`);
 }
}
const request=()=>new Request('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-create-preference',{method:'POST',headers:{authorization:'Bearer fixture-user','content-type':'application/json'},body:JSON.stringify({checkout_session_id:sid})});
async function verifyRetiredRefundHandlers(){
 for(const ref of ['a56a9c5','e3b16ad']){
  await load(ref,'supabase/functions/mercadopago-refund/index.ts');
  const response=await handler(new Request('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-refund',{
   method:'POST',headers:{authorization:'Bearer fixture-user','content-type':'application/json'},
   body:JSON.stringify({payment_intent_id:iid,idempotency_key:randomUUID(),amount:100,confirmation:'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND'})}));
  assert.equal(response.status,409);assert.equal((await response.json()).code,'REFUND_NOT_AVAILABLE');
 }
 assert.equal(financialPosts,0);console.log('OLD_REFUND_HANDLERS_CONTRACT: NO_PROVIDER_POST');
}
if(process.argv.includes('--current-contract')){
 phase='contract';revision='working-tree';await load(null);await currentSuite();
 console.log('CURRENT_CONTRACT_REPLAY: PASS');process.exit(0);
}
if(process.argv.includes('--retired-contract')){
 phase='contract';await verifyRetiredRefundHandlers();console.log('OLD_EDGE_CONTRACT_DB: FAIL_CLOSED');process.exit(0);
}
async function run(expected){mutationError=null;const response=await handler(request());const body=await response.json();if(mutationError)throw mutationError;assert.equal(Boolean(body.init_point),expected,JSON.stringify({phase,revision,route,mutation,stage,body}));console.log(JSON.stringify({phase,revision,route,mutation,stage,urlReleased:Boolean(body.init_point),status:response.status}));}
// Full old DB functionality; original candidate positively reproduces the hole.
await load('a56a9c5');
for(route of ['stored','recovered','new']){mutation='none';stage='identity';reset();await run(true);}
console.log('OLD_EDGE_OLD_DB: PASS');
sql(execFileSync('git',['show','a56a9c5:supabase/tests/mercadopago_checkout_pro.local.sql'],{encoding:'utf8'}));
console.log('OLD_EDGE_OLD_DB_FINANCIAL_LIFECYCLE: PASS');
const legacyRefundRecorderBefore=sql("select encode(digest(pg_get_functiondef('public.record_payment_refund_response(uuid,text,text,numeric,text)'::regprocedure),'sha256'),'hex')");
await load(null);mutation='none';route='stored';reset();await run(false);
console.log('NEW_EDGE_OLD_DB: FAIL_CLOSED');
for(const p of ['20260908164550_current_payment_authority_and_refund_identity.sql','20260908190758_a1_attempt_authority_expand_v2.sql','20260909011239_a1_a4_durable_contract_control_v3.sql'])sql(fs.readFileSync('supabase/migrations/'+p,'utf8'));
assert.equal(sql("select encode(digest(pg_get_functiondef('public.record_payment_refund_response(uuid,text,text,numeric,text)'::regprocedure),'sha256'),'hex')"),legacyRefundRecorderBefore);
console.log('LEGACY_REFUND_RECORDER_PRESERVED_DURING_EXPAND: PASS');
console.log(execFileSync(process.execPath,['scripts/verify-a1-v2-sql.mjs',container],{encoding:'utf8',env:process.env}));
phase='expand';revision='e3b16ad';await load(revision);
for(route of ['stored','recovered','new'])for(mutation of ['none','cancel','preference','url','id']){stage='identity';reset();await run(true);}
console.log('PREVIOUS_PATCH_RESIDUAL: REPRODUCED');
// a56's URL route retains functionality under EXPAND; refund safety separately below.
revision='a56a9c5';await load(revision);
for(route of ['stored','recovered','new']){mutation='none';reset();await run(true);}
console.log('OLD_EDGE_EXPAND_DB_CHECKOUT: PASS');
revision='working-tree';await load(null);
async function currentSuite(){
 for(route of ['stored','stored_legacy','recovered','new'])for(mutation of ['none','cancel','supersede','preference','url','id','same-seller-other-attempt','aba','disable','close','credential']){stage='identity';reset();await run(mutation==='none');}
 for(route of ['recovered','new'])for(mutation of ['cancel','supersede','preference','url','credential','disable','close']){stage='persist';reset();await run(false);}
 // True overlapping handlers: A waits on provider; committed B becomes current.
 route='stored';mutation='none';stage='identity';reset();
 let reached;const waiting=new Promise(r=>{reached=r;});pause=new Promise(r=>{release=r;});arrived=reached;
 const first=handler(request());await waiting;mutation='concurrent';mutate();mutation='none';
 const firstRelease=release;pause=null;route='new';aid=sql(`select id from payment_attempts where payment_intent_id=${quote(iid)} order by attempt_number desc limit 1`);
 const second=await handler(request());const secondBody=await second.json();assert.ok(secondBody.init_point,JSON.stringify(secondBody));firstRelease();
 const stale=await (await first).json();assert.equal(Boolean(stale.init_point),false);
 console.log(phase+': CONCURRENT_A_REJECTED_B_RELEASED');
}
await currentSuite();console.log('NEW_EDGE_EXPAND_DB: PASS');
// A4 V2 SQL boundary: unknown identity cannot approve; known ID exactly once.
const rid=randomUUID(),key=randomUUID();
sql(`update payment_intents set provider_payment_id='90001' where id=${quote(iid)};
 insert into payment_refunds(id,payment_intent_id,idempotency_key,amount,status) values(${[rid,iid,key].map(quote).join(',')},100,'ambiguous');`);
const refund={p_refund_id:rid,p_provider_refund_id:'99000001',p_status:'approved',p_amount:100,p_response_hash:'a'.repeat(64)};
assert.throws(()=>call('record_payment_refund_response_v2',refund));
assert.equal(sql(`select status from payment_refunds where id=${quote(rid)}`),'ambiguous');
call('record_payment_refund_identity',{p_refund_id:rid,p_payment_intent_id:iid,p_provider_payment_id:'90001',p_idempotency_key:key,p_provider_refund_id:'99000001'});
call('record_payment_refund_response_v2',refund);
const parallelSql=q=>new Promise((resolve,reject)=>{const p=spawn('docker',args);let err='';p.stderr.on('data',c=>err+=c);p.on('close',c=>c?reject(Error(err)):resolve());p.stdin.end(q);});
await Promise.all(Array.from({length:8},(_,i)=>parallelSql(`select public.record_payment_refund_response_v2(${[rid,'99000001','approved',100,String(i+1).repeat(64)].map(quote).join(',')});`)));
assert.equal(sql(`select count(*) from payment_events where details->>'refund_id'=${quote(rid)} and event_type='payment.refund_approved'`),'1');
console.log('A4_V2_UNBOUND_FAIL_CLOSED; TERMINAL_REPLAY_COMPATIBLE; CONCURRENT_EXACTLY_ONCE: PASS');
const correlation=await load(null,'supabase/functions/_shared/refund-correlation.ts');
const now=Date.now(), requestedAt=new Date(now).toISOString();
const known={amount:100,providerRefundId:'99000001',paymentId:'90001',requestedAt};
for(const date of [undefined,new Date(now-60000).toISOString(),new Date(now+60000).toISOString()]) {
 const resource={id:'99000001',payment_id:'90001',amount:100,status:'approved',date_created:date};
 assert.equal(correlation.correlateProviderRefund([resource],known,new Set(),now).kind,'ambiguous');
 assert.equal(correlation.correlateProviderRefund([resource],{...known,providerRefundId:null},new Set(),now).kind,'ambiguous');
}
assert.equal(correlation.correlateProviderRefund([{id:'99000001',payment_id:'90001',amount:100,status:'approved',date_created:requestedAt}],known,new Set(),now).kind,'matched');
console.log('A4_INDEPENDENT_MISSING_PRE_REQUEST_FUTURE_UNKNOWN_AND_KNOWN: PASS');
console.log('INDEPENDENT_V2_EXPAND_REPRODUCTIONS: PASS');
