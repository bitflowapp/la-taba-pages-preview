import {chromium} from 'file:///D:/1212/la-taba-commerce-v3/node_modules/playwright/index.mjs';
import {installBrowserStubs,gotoDemoReset,seedCheckoutProfile,DEFAULT_CHECKOUT_ADDRESSES} from 'file:///D:/1212/la-taba-commerce-v3/tests/e2e/helpers.mjs';
import fs from 'node:fs';
const browser=await chromium.launch();const report=[];
try{for(const [version,port] of [['before',18268],['after',18269]])for(const scenario of ['new','returning','repeat']){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',geolocation:{latitude:-38.9460616,longitude:-68.0533209,accuracy:8},permissions:['geolocation']});const page=await context.newPage();await installBrowserStubs(page);await gotoDemoReset(page,`http://127.0.0.1:${port}/?demo=1&reset=1`);
 await seedCheckoutProfile(page,scenario==='new'?{name:'',phone:'',addresses:[],namespace:'metrics-new'}:{addresses:DEFAULT_CHECKOUT_ADDRESSES});
 const p=await page.evaluate(async()=>{const {getState}=await import('/js/state.js');const {getBusinessConfig}=await import('/js/core/business-config-store.js');const {isProductOrderable}=await import('/js/core/catalog-store.js');const p=getState().products.find(p=>!p.alcoholic&&isProductOrderable(p)&&p.stock>=Math.ceil(getBusinessConfig().minDeliveryOrder/p.price));return {id:p.id,name:p.name,brand:p.brand,price:p.price,qty:Math.max(1,Math.ceil(getBusinessConfig().minDeliveryOrder/p.price))}});
 const actions=[];const click=async(selector,label)=>{actions.push(label);await page.locator(selector).first().click()};const fill=async(selector,value,label)=>{const l=page.locator(selector).first();if(!(await l.evaluate(el=>el===document.activeElement)))actions.push(label);await l.fill(value)};
 if(scenario==='repeat'){
  await page.evaluate(async p=>{const {recordCustomerOrder}=await import('/js/core/customer-history.js');recordCustomerOrder({id:'LT-METRICS',createdAt:new Date().toISOString(),status:'delivered',deliveryMode:'delivery',total:p.price*p.qty,items:[{productId:p.id,name:p.name,unitPrice:p.price,quantity:p.qty}]});(await import('/js/ui.js')).renderCustomerHome()},p);
  await click('[data-customer-actions] [data-repeat-order]','repetir');
 }else{
  await fill('[data-view="home"] [data-search-input]',p.brand||p.name,'buscar');await click(`[data-product-grid] [data-add-product="${p.id}"]`,'agregar');
  for(let i=1;i<p.qty;i++){await page.waitForTimeout(150);await click(`[data-product-grid] [data-cart-inc="${p.id}"]`,'sumar');}
  await click('[data-open-cart] >> visible=true','carrito');
 }
 if(scenario==='new'){
  await click('[data-home-address]','direccion');
  for(const [name,value] of [['captureCustomerName','Prueba Cliente'],['captureCustomerPhone','2990000123'],['captureAddressStreet','Mendoza'],['captureAddressNumber','827']])await fill(`[data-address-capture="sheet"] [name="${name}"]`,value,name);
  await click('[data-address-capture="sheet"] [data-profile-action="use-location"]','GPS');await click('[data-address-capture="sheet"] [data-profile-action="confirm-location"]','confirmar punto');await click('[data-address-capture="sheet"] [data-profile-action="save-address"]','guardar direccion');await page.locator('[data-address-sheet]').waitFor({state:'hidden'});
 }
 actions.push('confirmacion final');
 report.push({version,scenario,quantity:p.qty,approximateTaps:actions.length,actions,checkoutVisible:await page.locator('[data-checkout-submit]').isVisible()});await context.close();
}}finally{await browser.close();fs.writeFileSync('C:/1212/artifacts/taba-commerce-v3/ux-metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
