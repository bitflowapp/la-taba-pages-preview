import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {query,ref} from './la-taba-mp-cutover-db.mjs';
import {conToken} from './la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
const legacy='00000000-0000-4000-8000-000000000001',walter='3537d949-d76b-410d-be89-e4f447546e29';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const audit=JSON.parse(fs.readFileSync('C:/1212/la-taba-mp-cutover-audit.json'));
const classification=JSON.parse(fs.readFileSync('C:/1212/la-taba-mp-cutover-classification.json'));
const evidence={observedAt:new Date().toISOString(),project:ref};
const attempts=await query(`select id,business_id,environment,external_reference,preference_id,provider_payment_id,provider_merchant_order_id,provider_status,provider_status_detail,internal_status,currency,expected_amount,paid_amount,live_mode,preference_created_at,approved_at,refunded_amount,provider_event_at,created_at,updated_at,security_review_reason from public.payment_intents where business_id='${legacy}' order by created_at,id`);
const events=await query(`select e.payment_intent_id,e.event_type,e.provider_status,e.provider_status_detail,e.provider_occurred_at,e.server_recorded_at,e.details from public.payment_events e join public.payment_intents i on i.id=e.payment_intent_id where i.business_id='${legacy}' order by e.server_recorded_at`);
assert.equal(attempts.length,94);assert.equal(hash(attempts),hash(audit.attempts));
const sorted=v=>v.map(r=>JSON.stringify(r)).sort();assert.equal(hash(sorted(events)),hash(sorted(audit.events)));
assert.deepEqual(classification.summary.counts,{TEST:73,PRODUCTION:0,UNKNOWN:21});
evidence.legacy={intents:attempts.length,events:events.length,intentsHash:hash(attempts),eventsUnchanged:true,originalClassificationUnchanged:classification.summary.counts};
const [clean]=await query(`select b.id,b.slug,
 (select count(*) from public.mp_seller_connections where business_id=b.id) seller_connections,
 (select count(*) from public.payment_intents where business_id=b.id) payment_intents,
 (select count(*) from public.payment_attempts a join public.payment_intents i on i.id=a.payment_intent_id where i.business_id=b.id) payment_attempts,
 (select count(*) from public.payment_intents where business_id=b.id and preference_id is not null) preferences,
 (select count(*) from public.payment_intents where business_id=b.id and provider_payment_id is not null) payments,
 (select count(*) from public.mp_oauth_states where business_id=b.id) oauth_states,
 (select count(*) from public.checkout_sessions where business_id=b.id) checkout_sessions,
 (select count(*) from public.orders where business_id=b.id) orders,
 (select count(*) from public.business_payment_settings where business_id=b.id) payment_settings,
 (select count(*) from public.products where business_id=b.id and is_active and is_verified) products,
 (select count(*) from public.product_combos where business_id=b.id and is_active) active_combos,
 (select count(*) from public.business_members where business_id=b.id and is_active) members,
 (select count(*) from private.rider_map_business_locations where business_id=b.id) pickup_config,
 (select count(*) from auth.users where email like 'walter-panel-smoke-%@example.invalid') temporary_qa_users
 from public.businesses b where b.id='${walter}'`);
for(const k of ['seller_connections','payment_intents','payment_attempts','preferences','payments','oauth_states','checkout_sessions','orders','payment_settings','temporary_qa_users'])assert.equal(Number(clean[k]),0,k);
assert.equal(Number(clean.products),8);assert.equal(Number(clean.active_combos),3);assert.equal(Number(clean.members),2);assert.equal(Number(clean.pickup_config),1);
evidence.walter={...clean,status:'disconnected',unknown:0};
const [guard]=await query(`select
 position('c.seller_id<>p_seller_id' in pg_get_functiondef('public.mp_finish_oauth(uuid,text,uuid,text,text,text,text,timestamptz)'::regprocedure))>0 seller_change_protection,
 has_function_privilege('anon','public.mp_finish_oauth(uuid,text,uuid,text,text,text,text,timestamptz)','execute') anon_execute,
 has_function_privilege('authenticated','public.mp_finish_oauth(uuid,text,uuid,text,text,text,text,timestamptz)','execute') authenticated_execute,
 has_function_privilege('service_role','public.mp_finish_oauth(uuid,text,uuid,text,text,text,text,timestamptz)','execute') service_execute`);
assert.deepEqual(guard,{seller_change_protection:true,anon_execute:false,authenticated_execute:false,service_execute:true});evidence.databaseGuard=guard;
await conToken(async token=>{
 const headers={Authorization:`Bearer ${token}`};
 const secretResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`,{headers});assert.equal(secretResponse.status,200);
 const secrets=await secretResponse.json();
 const required=['MERCADOPAGO_CLIENT_ID','MERCADOPAGO_CLIENT_SECRET','MERCADOPAGO_OAUTH_WEBHOOK_SECRET','MERCADOPAGO_TOKEN_ENCRYPTION_KEY'];
 evidence.secrets=Object.fromEntries(required.map(name=>[name,secrets.some(s=>s.name===name)?'CONFIGURED':'MISSING']));
 assert.ok(Object.values(evidence.secrets).every(v=>v==='CONFIGURED'));
 for(const [name,value] of Object.entries({MERCADOPAGO_ENVIRONMENT:'test',MERCADOPAGO_OAUTH_ENVIRONMENT:'production',MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID:walter,TABA_DEPLOYMENT_ENV:'staging',MERCADOPAGO_CREDENTIAL_MODE:'oauth'}))assert.ok(secrets.some(s=>s.name===name&&s.value===createHash('sha256').update(value).digest('hex')),name);
 evidence.configuration={oauth:'production',paymentEnvironment:'test',scopedBusiness:walter,realCharges:false};
 const functionsResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`,{headers});assert.equal(functionsResponse.status,200);
 const functions=await functionsResponse.json();
 evidence.functions=functions.map(({slug,status,version,verify_jwt})=>({slug,status,version,verify_jwt}));
 assert.ok(!functions.some(f=>f.slug==='taba-walter-signature-check'));
 for(const slug of ['mercadopago-connect','mercadopago-oauth-callback','mercadopago-webhook','mercadopago-create-preference','mercadopago-payment-worker'])assert.ok(functions.some(f=>f.slug===slug&&f.status==='ACTIVE'&&f.verify_jwt===false));
 for(const slug of ['mercadopago-refund','mercadopago-cancel-payment'])assert.ok(functions.some(f=>f.slug===slug&&f.status==='ACTIVE'&&f.verify_jwt===true));
});
const callback=await fetch(`https://${ref}.supabase.co/functions/v1/mercadopago-oauth-callback`,{redirect:'manual'});
evidence.callback={status:callback.status,location:callback.headers.get('location')};assert.equal(callback.status,303);assert.equal(new URL(evidence.callback.location).hostname,'taba2-staging.pages.dev');
const runtime=await fetch('https://taba2-staging.pages.dev/runtime-config.js?tenant=walter-staging');const runtimeText=await runtime.text();
assert.ok(runtime.ok&&runtimeText.includes(walter)&&!runtimeText.includes(legacy));assert.ok(runtime.headers.get('cache-control').includes('no-store'));
evidence.publicRuntime={status:runtime.status,newBusiness:true,legacyBusiness:false,cacheControl:runtime.headers.get('cache-control')};
evidence.passed=true;
fs.writeFileSync('C:/1212/la-taba-walter-final-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
