// Real concurrent SQL proof that the CAS-to-post-write transition cannot adopt
// a different business/settings/credential authority while its locks are held.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const c=process.argv[2];
if(process.env.TABA_LOCAL_PAYMENT_DB!=='1'||!/^taba-a1-a4-local-[\w-]+$/.test(c||''))throw Error('Disposable local DB required');
const info=JSON.parse(execFileSync('docker',['inspect',c],{encoding:'utf8'}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(info.Mounts.some(m=>m.Type==='bind'),false);
const args=['exec','-i',c,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('docker',args,{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
// Apply the current recorder definition to the already-built isolated schema.
// This permits a focused replay after adding locking without resetting data.
const migration=fs.readFileSync('supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql','utf8');
const start=migration.indexOf('create function public.record_mercadopago_preference_created_v2(');
sql(migration.slice(start,migration.indexOf('end; $$;',start)+8).replace('create function','create or replace function'));
const fixture=JSON.parse(sql(`select json_build_object('bid',pi.business_id,'sid',cs.id,'uid',cs.customer_id,'aid',a.id)
 from public.payment_attempts a join public.payment_intents pi on pi.id=a.payment_intent_id
 join public.checkout_sessions cs on cs.id=pi.checkout_session_id
 where a.status='created' and pi.current_payment_attempt_id=a.id and pi.internal_status='preference_created'
 order by a.created_at desc limit 1`));
assert.ok(fixture);
const {bid,sid,uid,aid}=fixture;
const snapshot=`public.get_mercadopago_payment_authority_v2('${bid}','production','${sid}','${uid}','${aid}')`;
let announce;const ready=new Promise(r=>{announce=r;});
const holder=spawn('docker',args);let err='';holder.stderr.on('data',c=>err+=c);
holder.stdout.on('data',c=>{if(String(c).includes('LOCK_HELD'))announce();});
const finished=new Promise((resolve,reject)=>{holder.on('close',c=>c?reject(Error(err)):resolve());});
holder.stdin.end(`begin;
 select public.record_mercadopago_preference_created_v2('${bid}','production','${sid}','${uid}','${aid}',
 (${snapshot})->>'authority_version',a.preference_id,a.init_point,a.sandbox_init_point,a.response_hash,a.provider_request_id)->>'authority_version'
 from public.payment_attempts a where id='${aid}';
 select 'LOCK_HELD'; select pg_sleep(8); commit;`);
await Promise.race([ready,finished.then(()=>{throw Error('Recorder did not hold locks');})]);
const update=q=>new Promise((resolve,reject)=>{
 const p=spawn('docker',args);let error='';p.stderr.on('data',c=>error+=c);p.stdout.resume();
 p.on('close',code=>{try {assert.notEqual(code,0);assert.match(error,/lock timeout/);resolve();}catch(e){reject(e);}});
 p.stdin.end("set lock_timeout='200ms';\n"+q);
});
await Promise.all([
 update(`update public.businesses set status=status where id='${bid}'`),
 update(`update public.business_payment_settings set enabled=enabled where business_id='${bid}'`),
 update(`update public.mp_seller_connections set protected_tokens=protected_tokens where business_id='${bid}' and environment='production'`),
]);
await finished;
console.log('CAS_TRANSITION_BUSINESS_SETTINGS_CREDENTIAL_LOCKS: PASS (3 independent writers blocked)');

// P3 regression: OAuth/disconnect acquires seller then settings. The recorder
// must use that same order. Holding seller first while the recorder starts must
// let the holder acquire settings and commit; the old inverted order deadlocks.
const authority=sql(`select (${snapshot})->>'authority_version'`);
let sellerAnnounce;const sellerReady=new Promise(r=>{sellerAnnounce=r;});
const oauthHolder=spawn('docker',args);let oauthError='';oauthHolder.stderr.on('data',c=>oauthError+=c);
oauthHolder.stdout.on('data',c=>{if(String(c).includes('SELLER_HELD'))sellerAnnounce();});
const oauthFinished=new Promise((resolve,reject)=>oauthHolder.on('close',code=>code?reject(Error(oauthError)):resolve()));
oauthHolder.stdin.end(`begin;
 select 1 from public.mp_seller_connections where business_id='${bid}' and environment='production' for update;
 select 'SELLER_HELD'; select pg_sleep(1);
 select 1 from public.business_payment_settings where business_id='${bid}' and provider='mercadopago' for update;
 commit;`);
await Promise.race([sellerReady,oauthFinished.then(()=>{throw Error('OAuth-order holder ended early');})]);
const recorder=spawn('docker',args);let recorderError='';recorder.stderr.on('data',c=>recorderError+=c);recorder.stdout.resume();
const recorderFinished=new Promise((resolve,reject)=>recorder.on('close',code=>code?reject(Error(recorderError)):resolve()));
recorder.stdin.end(`set lock_timeout='4s';
 select public.record_mercadopago_preference_created_v2('${bid}','production','${sid}','${uid}','${aid}',
 '${authority}',a.preference_id,a.init_point,a.sandbox_init_point,a.response_hash,a.provider_request_id)
 from public.payment_attempts a where id='${aid}';`);
await Promise.all([oauthFinished,recorderFinished]);
console.log('SELLER_SETTINGS_LOCK_ORDER: PASS (seller -> settings, no deadlock)');
