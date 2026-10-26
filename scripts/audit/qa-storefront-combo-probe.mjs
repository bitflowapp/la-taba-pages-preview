// Read the live QA storefront with its existing synthetic buyer. No checkout or payment creation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {leerSecreto} from '../e2e-production-sale/secretos-windows.mjs';
import {passPreviewGate} from '../recovery/preview-gate-login.mjs';
const ref='ixewllzzuzpqrkxzmfzx',origin='https://recovery-20261020.taba2-staging.pages.dev';
const key=leerSecreto('RECOVERY SUPABASE ANON KEY');assert.equal(key.usuario,ref);
const login=leerSecreto('RECOVERY QA BUYER');assert.match(login.usuario,/@qa\.lataba\.invalid$/);
const client=createClient(`https://${ref}.supabase.co`,key.secreto,{auth:{persistSession:false,autoRefreshToken:false}});
const auth=await client.auth.signInWithPassword({email:login.usuario,password:login.secreto});assert.ifError(auth.error);
const browser=await chromium.launch({channel:'chromium',headless:true});
try {
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route(/^https:\/\/[^/]+\.supabase\.co\//,route=>new URL(route.request().url()).origin===`https://${ref}.supabase.co`?route.continue():route.abort());
 await passPreviewGate(context,origin,leerSecreto('RECOVERY PREVIEW ACCESS'));
 if(process.argv.includes('--local-client')) {
   // Serve one coherent client graph. Mixing a new app/repository with a
   // previously deployed shared module can fail before the catalog loads.
   await context.route(`${origin}/js/**`,route=>{
     const file=new URL(route.request().url()).pathname;
     return /^\/js\/[a-zA-Z0-9_./-]+\.js$/.test(file) && !file.includes('..')
       ? route.fulfill({status:200,contentType:'application/javascript',body:fs.readFileSync(new URL(`../..${file}`,import.meta.url))}) : route.continue();
   });
 }
 await context.addInitScript(({ref,session})=>localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify(session)),{ref,session:auth.data.session});
 const page=await context.newPage();
 const pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(String(error.message).slice(0,240)));
 if(process.argv.includes('--return-resilience')) {
   assert.ok(process.argv.includes('--local-client'),'verify the prepared correction explicitly');
   const business='7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a01',product='204f8012-9e26-482c-83f3-a3a20dee4d59';
   await context.addInitScript(({business,product})=>{
     localStorage.setItem(`taba-mercadopago-checkout-v1:${business}`,JSON.stringify({checkoutSessionId:'47d67f35-65e5-40ec-8044-7c5aa792fe21',items:[{productId:product,quantity:1}],combos:[]}));
     localStorage.setItem('la_taba_production_cart_v1',JSON.stringify({schemaVersion:2,savedAt:new Date().toISOString(),cart:[{productId:product,quantity:1}],comboSelections:[{comboId:'combo-heineken-x6',quantity:1}]}));
   },{business,product});
   let statusRequests=0,checkoutCreates=0;
   page.on('request',request=>{if(new URL(request.url()).pathname.includes('mercadopago-create-checkout-session'))checkoutCreates++;});
   await page.route('**/functions/v1/mercadopago-checkout-status',route=>++statusRequests===1?route.abort('internetdisconnected'):route.continue());
   await page.goto(`${origin}/pago/resultado/?status=rejected&payment_id=185083342105`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('[data-payment-return-title]')?.textContent==='Pedido confirmado',null,{timeout:30000});
   const cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('la_taba_production_cart_v1')));
   assert.equal(statusRequests,2);assert.equal(checkoutCreates,0);assert.deepEqual(cart.cart,[]);
   assert.deepEqual(cart.comboSelections,[{comboId:'combo-heineken-x6',quantity:1}]);
   console.log(JSON.stringify({at:new Date().toISOString(),ref,backend:'real hosted QA',frontend:'local reviewed sources via browser interception',
     injected_fault:'first status request aborted as internetdisconnected',statusRequests,checkoutCreates,confirmed:true,unpaidComboPreserved:true,manipulatedUrlIgnored:true},null,2));
 } else {
 await page.goto(`${origin}/#home`,{waitUntil:'domcontentloaded'});
 assert.equal(await page.evaluate(()=>globalThis.__LA_TABA_RUNTIME_CONFIG__?.repository?.supabaseUrl),`https://${ref}.supabase.co`);
 try { await page.locator('[data-add-product]').first().waitFor({state:'attached',timeout:20000}); }
 catch { console.log(JSON.stringify({loaded:false,pageErrors,text:(await page.locator('body').innerText()).slice(0,800)}));throw Error('QA storefront did not load'); }
 const result=await page.evaluate(async()=>{
   const {customerCombos}=await import('/js/ui.js');
   const {getState}=await import('/js/state.js');
   const repository=await import('/js/repositories/repository_factory.js');
   const availability=await repository.getOrderRepository().getMercadoPagoCheckoutAvailability();
   return {availability:{ok:availability.ok,available:availability.available},combos:customerCombos().map(c=>({id:c.comboId,price:c.promotionalPrice})),
     products:getState().products.map(p=>({id:p.id,sku:p.sku,stock:p.stock,available:p.available,price:p.price})),
     renderedCards:document.querySelectorAll('[data-combo-card]').length};
 });
 console.log(JSON.stringify({at:new Date().toISOString(),ref,read_only:true,local_client:process.argv.includes('--local-client'),...result},null,2));
 }
}finally{await browser.close();}
