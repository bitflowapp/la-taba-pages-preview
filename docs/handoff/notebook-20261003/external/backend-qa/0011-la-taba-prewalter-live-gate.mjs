import {chromium} from './la-taba-mercadopago-oauth/node_modules/playwright/index.mjs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {conToken} from './la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
import {query} from './la-taba-mp-cutover-db.mjs';
const business='3537d949-d76b-410d-be89-e4f447546e29',legacy='00000000-0000-4000-8000-000000000001',ref='ukxqbgswjlibmnjemrzd',base=`https://${ref}.supabase.co`;
const evidence={business};
try { await conToken(async token=>{
 const [before]=await query(`select (select count(*) from public.mp_seller_connections where business_id='${business}') connections,(select count(*) from public.mp_oauth_states where business_id='${business}') states,(select count(*) from public.payment_intents where business_id='${business}') payments`);
 assert.ok(Object.values(before).every(v=>Number(v)===0));
 const k=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(k.status,200);
 const keys=await k.json(),service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
 const admin={apikey:service,Authorization:`Bearer ${service}`,'content-type':'application/json'};
 let userId,session,browser,generation,stateHash;
 try {
  const password=randomBytes(32).toString('base64url'),email=`walter-panel-smoke-${randomUUID()}@example.invalid`;
  const created=await fetch(base+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:'Verificación temporal de TABA'}})});assert.equal(created.status,200);userId=(await created.json()).id;
  const member=await fetch(base+'/rest/v1/business_members',{method:'POST',headers:admin,body:JSON.stringify({business_id:business,user_id:userId,role:'owner',is_active:true})});assert.ok(member.ok);
  const login=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.ok(login.ok);session=await login.json();
  const userHeaders={apikey:anon,Authorization:`Bearer ${session.access_token}`,'content-type':'application/json'};
  const registered=await fetch(base+'/rest/v1/rpc/identity_register_session',{method:'POST',headers:userHeaders,body:JSON.stringify({p_business_id:business,p_client:'panel_web',p_device_label:'Pre-Walter gate'})});assert.equal((await registered.json()).ok,true);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'allow'});
  await context.addInitScript(({session,ref,legacy})=>{localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify(session));localStorage.setItem('activeBusinessId',legacy);localStorage.setItem('businessId',legacy);localStorage.setItem('taba-pwa-install-dismissed','1');},{session,ref,legacy});
  const page=await context.newPage(),legacyRequests=[];
  page.on('request',request=>{if(request.url().startsWith(base)&&decodeURIComponent(request.url()+(request.postData()||'')).includes(legacy))legacyRequests.push(new URL(request.url()).pathname);});
  const responseFor=action=>page.waitForResponse(r=>r.url()===base+'/functions/v1/mercadopago-connect'&&r.request().postDataJSON()?.action===action,{timeout:45000});
  const statusResponse=responseFor('status');
  // Open the actual published panel. No Mercado Pago connection is simulated.
  await page.goto('https://taba2-staging.pages.dev/?mp_connection=cancelled#business',{waitUntil:'domcontentloaded',timeout:45000});
  const panel=page.locator('[data-business-ops-center="payments-setup"]');await panel.waitFor({state:'visible',timeout:45000});
  const status=await statusResponse,statusBody=await status.json();assert.equal(status.status(),200);assert.deepEqual(statusBody.connection,{status:'disconnected',seller_id:null,connected_at:null});
  await page.waitForFunction(()=>document.querySelector('[data-business-ops-center="payments-setup"]')?.innerText.includes('No conectado'));
  const cardText=await panel.innerText();assert.ok(!/Marco|LUNA|Cuenta:/i.test(cardText));assert.ok(cardText.includes('Conectá tu cuenta para recibir pagos online.'));
  assert.equal(await page.evaluate(()=>globalThis.__LA_TABA_RUNTIME_CONFIG__.repository.businessId),business);
  evidence.panel={status:'disconnected',sellerId:null,noPlatformOwnerShown:true};
  await page.screenshot({path:'C:/1212/la-taba-prewalter-panel.png',fullPage:true});
  let capturedConnect;
  let resolveConnect;
  const realConnect=new Promise(resolve=>{resolveConnect=resolve;});
  await page.route(base+'/functions/v1/mercadopago-connect',async route=>{
   if(route.request().postDataJSON()?.action!=='connect')return route.continue();
   const upstream=await route.fetch();
   capturedConnect={status:upstream.status(),body:await upstream.json(),business:route.request().postDataJSON().business_id};
   resolveConnect();
   await route.fulfill({response:upstream});
  });
  // Stop browser navigation at the provider; verify its real public redirect separately.
  await page.route('https://auth.mercadopago.com.ar/authorization?**',route=>route.fulfill({contentType:'text/html',body:'<h1>Autorización no completada</h1>'}));
  await panel.getByRole('button',{name:'Conectar Mercado Pago',exact:true}).click();
  await realConnect;const result=capturedConnect.body;assert.equal(capturedConnect.status,200);assert.equal(capturedConnect.business,business);
  const authorization=new URL(result.authorization_url);assert.equal(authorization.origin,'https://auth.mercadopago.com.ar');
  assert.equal(authorization.searchParams.get('client_id'),'2691240967769590');assert.equal(authorization.searchParams.get('redirect_uri'),base+'/functions/v1/mercadopago-oauth-callback');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.equal(authorization.searchParams.get('scope'),'read write offline_access');
  stateHash=createHash('sha256').update(authorization.searchParams.get('state')).digest('base64url');
  const [state]=await query(`select business_id,user_id,environment,generation,(protected_verifier is not null) verifier_protected from public.mp_oauth_states where state_hash='${stateHash}'`);
  assert.equal(state.business_id,business);assert.equal(state.user_id,userId);assert.equal(state.environment,'production');assert.equal(state.verifier_protected,true);generation=state.generation;
  const provider=await fetch(authorization,{redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([302,303].includes(provider.status));
  const providerLocation=new URL(provider.headers.get('location'),authorization);assert.ok(['www.mercadopago.com.ar','www.mercadolibre.com'].includes(providerLocation.hostname));
  const callback=new URL(base+'/functions/v1/mercadopago-oauth-callback');callback.searchParams.set('state',authorization.searchParams.get('state'));callback.searchParams.set('error','access_denied');
  const cancelled=await fetch(callback,{redirect:'manual'});assert.equal(cancelled.status,303);assert.equal(new URL(cancelled.headers.get('location')).searchParams.get('mp_connection'),'cancelled');
  const replay=await fetch(callback,{redirect:'manual'});assert.equal(replay.status,303);assert.equal(new URL(replay.headers.get('location')).searchParams.get('mp_connection'),'error');
  assert.equal(legacyRequests.length,0);
  Object.assign(evidence,{connectHttp:200,stateBoundToWalter:true,pkce:'S256',scopes:'read write offline_access',providerHttp:provider.status,providerLoginOrigin:providerLocation.origin,consentCompleted:false,cancelHttp:303,replayBlocked:true,legacyRequests:0,passed:true});
 } catch(error) {
  evidence.initialFailure=String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,220);
  throw error;
 } finally {
  if(browser)await browser.close();
  if(userId&&!generation){const [owned]=await query(`select state_hash,generation from public.mp_oauth_states where user_id='${userId}' and business_id='${business}'`);generation=owned?.generation;stateHash=owned?.state_hash;}
  if(generation&&stateHash){
   // Remove only the empty row created by this attempt. Never remove a bound seller.
   const cleanup=await query(`begin; delete from public.mp_oauth_states where state_hash='${stateHash}' and business_id='${business}' and user_id='${userId}'; delete from public.mp_seller_connections where business_id='${business}' and environment='production' and generation='${generation}' and seller_id is null and protected_tokens is null and status='disconnected' and not exists(select 1 from public.payment_intents where business_id='${business}') and not exists(select 1 from public.mp_oauth_states where business_id='${business}'); commit;`);
   evidence.emptyAttemptCleaned=true;
  }
  if(session)await fetch(base+'/auth/v1/logout',{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${session.access_token}`}});
  if(userId){const removed=await fetch(base+'/auth/v1/admin/users/'+userId,{method:'DELETE',headers:admin});evidence.temporaryTabaIdentityRemoved=removed.ok;assert.ok(removed.ok);}
  const [after]=await query(`select (select count(*) from public.mp_seller_connections where business_id='${business}') connections,(select count(*) from public.mp_oauth_states where business_id='${business}') states,(select count(*) from public.payment_intents where business_id='${business}') payments`);
  evidence.finalState=after;assert.ok(Object.values(after).every(v=>Number(v)===0));
 }
}); } catch(error){evidence.passed=false;evidence.failure=String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,220);process.exitCode=1;}
fs.writeFileSync('C:/1212/la-taba-prewalter-live-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
