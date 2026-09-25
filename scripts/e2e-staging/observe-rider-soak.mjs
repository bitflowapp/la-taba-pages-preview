import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
const run=JSON.parse(leerSecreto('RIDER CANONICAL QA RUN 20260922')?.secreto||'{}');
if(!run.orderId||!run.publicCode||!run.tracking)throw Error('QA_ORDER_ACCESS_REQUIRED');
const ref='ucbtjcurawxjwjdvvcvj',business='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const publishable=leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
if(publishable?.usuario!==ref)throw Error('STAGING_PUBLIC_KEY_REQUIRED');
const url=`https://${ref}.supabase.co`;
const actor=async name=>{
 const credentials=leerSecreto(name);
 const client=createClient(url,publishable.secreto,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=await client.auth.signInWithPassword({email:credentials.usuario,password:credentials.secreto});
 if(auth.error||!auth.data.session)throw Error(`QA_LOGIN_UNAVAILABLE:${auth.error?.code||'NO_SESSION'}`);
 return {client,session:auth.data.session};
};
const staff=await actor('STAGING BUSINESS QA 20260920');
const registered=await staff.client.rpc('identity_register_session',{p_business_id:business,p_client:'panel_web',
 p_device_label:'Pilot browser observer',p_device_key_hash:null,p_app_version:'pilot-qa'});
if(registered.error)throw Error(`PANEL_SESSION:${registered.error.code}`);
const browser=await chromium.launch({headless:true});
const report={timestamp:new Date().toISOString(),project:ref,stagingOnly:true};
try{
 const panelContext=await browser.newContext({serviceWorkers:'block'});
 await panelContext.addInitScript(({ref,session})=>localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify(session)),
  {ref,session:staff.session});
 const panel=await panelContext.newPage();await panel.goto('http://127.0.0.1:39092/#business');
 await panel.locator('[data-production-orders-view]:visible').first().waitFor({timeout:45000});
 await panel.locator('[data-production-orders-view]:visible').first().click();
 const card=panel.locator(`[data-order-card="${run.publicCode}"]`);
 await card.waitFor({timeout:45000});
 report.panelAssigned=await card.locator('[data-order-custody]').count()===1;
 report.panelOnTheWay=(await card.innerText()).includes('está en camino');
 const roster=panel.locator('[data-panel-region="rider-presence"]');
 await roster.waitFor({timeout:30000});
 report.panelAvailable=await roster.locator('summary').innerText().then(s=>s.includes('1 disponibles'));

 const customerContext=await browser.newContext({serviceWorkers:'block'});
 await customerContext.addInitScript(({business,access})=>{
  sessionStorage.setItem(`taba-order-access-v1:${business}:last`,JSON.stringify(access));
 },{business,access:{orderId:run.orderId,publicCode:run.publicCode,trackingToken:run.tracking}});
 const storefront=await customerContext.newPage();await storefront.goto('http://127.0.0.1:39092/#tracking');
 await storefront.locator('[data-tracking-status="on_the_way"]').waitFor({timeout:45000});
 report.customerOnTheWay=true;
 report.customerGpsMarker=await storefront.locator('.lt-rider-marker').count()===1;
 await customerContext.close();await panelContext.close();
}finally{await browser.close()}
writeFileSync('artifacts/rider-pilot-web-observation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!Object.entries(report).filter(([k])=>k.startsWith('panel')||k.startsWith('customer')).every(([,v])=>v===true))process.exitCode=1;
