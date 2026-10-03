import {chromium} from './la-taba-mercadopago-oauth/node_modules/playwright/index.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {conToken} from './la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
const business='3537d949-d76b-410d-be89-e4f447546e29',legacy='00000000-0000-4000-8000-000000000001',ref='ukxqbgswjlibmnjemrzd',base=`https://${ref}.supabase.co`;
await conToken(async token=>{
 const k=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`,{headers:{Authorization:`Bearer ${token}`}});if(!k.ok)throw Error('Missing staging access');
 const keys=await k.json(),service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
 const admin={apikey:service,Authorization:`Bearer ${service}`,'content-type':'application/json'};
 let userId,session,browser;const evidence={};
 try {
  const password=randomBytes(32).toString('base64url'),email=`walter-panel-smoke-${randomUUID()}@example.invalid`;
  const created=await fetch(base+'/auth/v1/admin/users',{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:'Prueba de panel staging'}})});if(!created.ok)throw Error('Could not create QA identity');userId=(await created.json()).id;
  const member=await fetch(base+'/rest/v1/business_members',{method:'POST',headers:admin,body:JSON.stringify({business_id:business,user_id:userId,role:'owner',is_active:true})});if(!member.ok)throw Error('Could not authorize QA identity');
  const login=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email,password})});if(!login.ok)throw Error('QA login failed');session=await login.json();
  const userHeaders={apikey:anon,Authorization:`Bearer ${session.access_token}`,'content-type':'application/json'};
  const registered=await fetch(base+'/rest/v1/rpc/identity_register_session',{method:'POST',headers:userHeaders,body:JSON.stringify({p_business_id:business,p_client:'panel_web',p_device_label:'Clean staging UI verification'})});if(!registered.ok||(await registered.json()).ok!==true)throw Error('QA session registration failed');
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'allow'});
  await context.addInitScript(({session,ref,legacy})=>{
   localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify(session));
   localStorage.setItem('activeBusinessId',legacy);localStorage.setItem('businessId',legacy);
   localStorage.setItem('taba-pwa-install-dismissed','1');
  },{session,ref,legacy});
  const page=await context.newPage();let connectBusiness=null;const legacyRequests=[],statusResults=[];
  page.on('request',request=>{if(request.url().startsWith(base)&&decodeURIComponent(request.url()+(request.postData()||'')).includes(legacy))legacyRequests.push(new URL(request.url()).pathname);});
  page.on('response',async response=>{if(response.url()===base+'/functions/v1/mercadopago-connect'){const request=response.request();if(request.postDataJSON()?.action==='status'){const body=await response.json().catch(()=>({}));statusResults.push({http:response.status(),status:body.connection?.status});}}});
  await page.route(base+'/functions/v1/mercadopago-connect',async route=>{
   const body=route.request().postDataJSON();
   if(body.action!=='connect')return route.continue();
   connectBusiness=body.business_id;
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,authorization_url:'https://auth.mercadopago.com.ar/authorization?client_id=2691240967769590&state=fixture-routing-only'})});
  });
  await page.route('https://auth.mercadopago.com.ar/authorization?**',route=>route.fulfill({contentType:'text/html',body:'<h1>Destino OAuth verificado</h1>'}));
  const statusResponse = page.waitForResponse(response => response.url() === base+'/functions/v1/mercadopago-connect' && response.request().postDataJSON()?.action === 'status', {timeout:45000});
  await page.goto('https://taba2-staging.pages.dev/?mp_connection=cancelled#business',{waitUntil:'domcontentloaded',timeout:45000});
  const panel=page.locator('[data-business-ops-center="payments-setup"]');await panel.waitFor({state:'visible',timeout:45000});
  const button=panel.getByRole('button',{name:'Conectar Mercado Pago',exact:true});await button.waitFor({state:'visible',timeout:15000});
  const text=await panel.innerText();assert.ok(text.includes('Conectá tu cuenta para recibir pagos online.'));assert.ok(!text.includes(legacy));assert.ok(!text.includes('seller_change_requires_migration'));
  evidence.runtimeBusiness=await page.evaluate(()=>globalThis.__LA_TABA_RUNTIME_CONFIG__.repository.businessId);assert.equal(evidence.runtimeBusiness,business);
  await page.screenshot({path:'C:/1212/la-taba-walter-panel.png',fullPage:true});
  const realStatusResponse=await statusResponse;const realStatus=await realStatusResponse.json();
  evidence.realStatus={http:realStatusResponse.status(),status:realStatus.connection?.status,error:realStatus.error};
  assert.equal(realStatusResponse.status(),200);assert.equal(realStatus.connection?.status,'disconnected');
  await button.click();await page.waitForURL('https://auth.mercadopago.com.ar/**',{timeout:15000});
  assert.equal(connectBusiness,business);assert.equal(legacyRequests.length,0);assert.ok(statusResults.some(r=>r.http===200&&r.status==='disconnected'));
  Object.assign(evidence,{connectBusiness,legacyRequests:legacyRequests.length,realStatusResults:statusResults,connectInterceptedToKeepBusinessClean:true,oauthProviderSimulated:true,passed:true});
 } finally {
  if(browser)await browser.close();
  if(session)await fetch(base+'/auth/v1/logout',{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${session.access_token}`}});
  if(userId){const removed=await fetch(base+'/auth/v1/admin/users/'+userId,{method:'DELETE',headers:admin});evidence.qaIdentityRemoved=removed.ok;}
  fs.writeFileSync('C:/1212/la-taba-walter-live-browser-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }
});
