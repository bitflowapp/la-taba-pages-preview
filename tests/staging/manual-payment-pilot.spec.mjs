import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { operationKey } from '../../js/core/idempotency-key.js';
import { guardarSecreto, leerSecreto } from '../../scripts/e2e-production-sale/secretos-windows.mjs';

const ref='ucbtjcurawxjwjdvvcvj';
const businessId='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const run='STAGING MANUAL PAYMENT PILOT QA 20260923';
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_PUBLISHABLE_KEY;
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const client=()=>createClient(url,key,options);
const sql=async promise=>{const {data,error}=await promise;if(error)throw new Error(`QA_READ:${error.code}`);return data};
const rpc=async(c,name,args)=>{const {data,error}=await c.rpc(name,args);if(error)throw new Error(`QA_RPC:${name}:${error.code}`);return data};

async function login(client,email,password){
 const {data,error}=await client.auth.signInWithPassword({email,password});
 expect(error?.code||'').toBe('');expect(data.session?.user?.id).toBeTruthy();return data.session;
}
async function runtime(context,session){
 await context.addInitScript(({url,key,businessId,ref,session})=>{
  globalThis.__LA_TABA_RUNTIME_CONFIG__={mode:'production',repository:{provider:'supabase',deploymentEnvironment:'staging',supabaseUrl:url,publishableKey:key,businessId,pollMs:1000}};
  localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify(session));
 },{url,key,businessId,ref,session});
}

test('pedido cash desde cliente → panel pendiente → pago manual y devolución auditados → stock restaurado',async({browser})=>{
 expect(url).toBe(`https://${ref}.supabase.co`);
 const stored=leerSecreto(run);expect(stored,'No repetir una corrida con pedido QA sin revisar').toBeNull();
 const customer=client(),staff=client(),rider=client();
 const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
 const customerSession=await login(customer,process.env.SUPABASE_CUSTOMER_EMAIL,process.env.SUPABASE_CUSTOMER_PASSWORD);
 const staffSession=await login(staff,process.env.SUPABASE_STAFF_EMAIL,process.env.SUPABASE_STAFF_PASSWORD);
 await login(rider,process.env.SUPABASE_RIDER_EMAIL,process.env.SUPABASE_RIDER_PASSWORD);
 const role=await sql(staff.from('business_members').select('role,is_active').eq('business_id',businessId).eq('user_id',staffSession.user.id).single());
 expect(role).toMatchObject({role:'admin',is_active:true});
 await rpc(staff,'identity_register_session',{p_business_id:businessId,p_client:'panel_web',p_device_label:'QA manual payment',p_device_key_hash:null,p_app_version:'pilot-qa'});
 await rpc(rider,'identity_register_session',{p_business_id:businessId,p_client:'rider_android',p_device_label:'QA manual negative',p_device_key_hash:null,p_app_version:'pilot-qa'});
 const address=(await sql(customer.from('customer_addresses').select('id,neighborhood,latitude,longitude,location_confirmed_at').is('deleted_at',null)))
   .find(a=>a.location_confirmed_at&&a.latitude&&a.longitude);
 expect(address,'La cuenta QA necesita dirección ya confirmada').toBeTruthy();
 const business=await sql(staff.from('businesses').select('minimum_delivery_subtotal').eq('id',businessId).single());
 const availability=await rpc(staff,'commerce_availability',{p_business_id:businessId,p_channel:'delivery',p_context:{}});
 const area=availability.areas?.find(a=>a.name===address.neighborhood)||availability.areas?.find(a=>a.name);
 expect(area).toBeTruthy();
 const minimum=Number(area.minimum_subtotal??business.minimum_delivery_subtotal??0);
 const products=await sql(staff.from('products').select('id,name,price,stock').eq('business_id',businessId)
   .eq('is_active',true).eq('available',true).eq('is_verified',true).eq('is_alcoholic',false).gt('stock',0).order('price',{ascending:false}));
 const candidate=products.map(product=>({product,quantity:Math.max(1,Math.ceil((minimum+1)/Number(product.price)))}))
   .find(x=>x.product.price>0&&x.product.stock>=x.quantity);
 expect(candidate).toBeTruthy();
 const {product,quantity}=candidate;
 const stockBefore=Number(product.stock);
 const startedAt=new Date().toISOString();
 const customerContext=await browser.newContext({serviceWorkers:'block'}),panelContext=await browser.newContext({serviceWorkers:'block'});
 await runtime(customerContext,customerSession);await runtime(panelContext,staffSession);
 const storefront=await customerContext.newPage();const panel=await panelContext.newPage();
 let order=null,cleaned=false;
 try{
  await storefront.goto('/#catalog');
  const add=storefront.locator(`[data-product-grid] [data-add-product="${product.id}"]:visible`).first();
  await expect(add).toBeVisible();await add.click();
  const increment=storefront.locator(`[data-cart-inc="${product.id}"]:visible`).first();
  for(let i=1;i<quantity;i++)await increment.click();
  await storefront.locator('[data-open-cart]:visible').first().click();
  await expect(storefront.locator('[data-checkout-form]')).toBeVisible();
  await storefront.getByLabel('Delivery').check();
  await expect(storefront.locator('[data-profile-checkout] .profile-address-card.is-selected')).toHaveCount(1);
  await storefront.getByLabel('Forma de pago').selectOption('cash');
  await expect(storefront.getByText('El cobro queda pendiente hasta que el negocio registre el dinero recibido.')).toBeVisible();
  await storefront.getByRole('button',{name:/Confirmar pedido/i}).click();
  await expect(storefront.locator('[data-tracking-title]')).toHaveText('Tu pedido fue confirmado',{timeout:35000});

  await expect.poll(async()=>{
   const rows=await sql(staff.from('orders').select('id,public_code,status,revision,manual_payment_status,payment_method')
     .eq('business_id',businessId).eq('customer_user_id',customerSession.user.id)
     .gt('created_at',startedAt).order('created_at',{ascending:false}).limit(1));
   order=rows[0]||null;return order?.id||'';
  }).not.toBe('');
  expect(order).toMatchObject({payment_method:'cash',manual_payment_status:'pending'});
  guardarSecreto(run,'staging',JSON.stringify({orderId:order.id,productId:product.id,quantity,stockBefore}));
  expect(Number((await sql(staff.from('products').select('stock').eq('id',product.id).single())).stock)).toBe(stockBefore-quantity);

  await panel.goto('/#business');
  await expect(panel.locator('[data-production-orders-view]:visible').first()).toBeVisible();
  await panel.locator('[data-production-orders-view]:visible').first().click();
  const businessCard=panel.locator(`[data-order-card="${order.public_code}"]`);
  await expect(businessCard.locator('[data-manual-payment-status]')).toHaveAttribute('data-manual-payment-status','pending');
  await panel.locator('[data-business-ops-view="payments"]:visible').first().click();
  const manual=panel.locator(`[data-manual-payment-card="${order.id}"]`);
  await expect(manual.locator('[data-manual-payment-status]')).toHaveAttribute('data-manual-payment-status','pending');
  const confirmKey=operationKey('manual-confirm',order.id,order.revision,'cash');
  panel.once('dialog',dialog=>dialog.accept());
  await manual.locator('[data-manual-payment-confirm][data-manual-payment-method="cash"]').click();
  await expect(manual.locator('[data-manual-payment-status]')).toHaveAttribute('data-manual-payment-status','confirmed');
  const paid=await sql(staff.from('orders').select('revision,manual_payment_status,manual_payment_method,manual_payment_confirmed_at').eq('id',order.id).single());
  expect(paid.manual_payment_status).toBe('confirmed');expect(paid.manual_payment_method).toBe('cash');expect(paid.manual_payment_confirmed_at).toBeTruthy();
  const replay=await rpc(staff,'confirm_manual_order_payment',{p_order_id:order.id,p_expected_revision:order.revision,p_actual_method:'cash',p_idempotency_key:confirmKey});
  expect(replay.idempotent_replay).toBe(true);
  for(const outsider of [customer,rider]){
   const denied=await outsider.rpc('confirm_manual_order_payment',{p_order_id:order.id,p_expected_revision:paid.revision,p_actual_method:'cash',p_idempotency_key:randomUUID()});
   expect(denied.error?.code).toBe('42501');
  }
  const beforeReverse=await staff.rpc('cancel_order',{p_order_id:order.id,p_expected_revision:paid.revision,p_reason:'QA cancelación antes de devolución',p_idempotency_key:randomUUID()});
  expect(beforeReverse.error?.code).toBe('55000');
  const events=await sql(admin.from('order_events').select('id').eq('order_id',order.id).eq('event_type','order.manual_payment_confirmed'));
  expect(events).toHaveLength(1);
  const intents=await sql(admin.from('payment_intents').select('id').eq('order_id',order.id));expect(intents).toHaveLength(0);
  const receipts=await sql(admin.from('business_command_receipts').select('id').eq('order_id',order.id).eq('command_type','confirm_manual_order_payment'));
  expect(receipts).toHaveLength(1);

  panel.on('dialog',dialog=>dialog.type()==='prompt'
    ? dialog.accept('QA: devolución manual registrada sin dinero real') : dialog.accept());
  await manual.locator('[data-manual-payment-reverse]').click();
  await expect(manual.locator('[data-manual-payment-status]')).toHaveAttribute('data-manual-payment-status','reversed');
  const reversed=await sql(staff.from('orders').select('revision,manual_payment_status,manual_payment_reversed_at').eq('id',order.id).single());
  expect(reversed.manual_payment_status).toBe('reversed');expect(reversed.manual_payment_reversed_at).toBeTruthy();
  const cancelArgs={p_order_id:order.id,p_expected_revision:reversed.revision,p_reason:'QA piloto: cancelar tras devolución',p_idempotency_key:randomUUID()};
  await rpc(staff,'cancel_order',cancelArgs);
  const cancelReplay=await rpc(staff,'cancel_order',cancelArgs);expect(cancelReplay.idempotent_replay).toBe(true);
  expect(['canceled','cancelled']).toContain((await sql(staff.from('orders').select('status').eq('id',order.id).single())).status);
  expect(Number((await sql(staff.from('products').select('stock').eq('id',product.id).single())).stock)).toBe(stockBefore);
  await rpc(admin,'classify_order_as_qa',{p_order_id:order.id,p_reason:'manual_payment_pilot_qa'});cleaned=true;
 }finally{
  await customerContext.close();await panelContext.close();
  if(order&&!cleaned){
   const current=await sql(staff.from('orders').select('status,revision,manual_payment_status').eq('id',order.id).single());
   if(current.manual_payment_status==='confirmed')await staff.rpc('reverse_manual_order_payment',{p_order_id:order.id,p_expected_revision:current.revision,p_reason:'QA cleanup: devolución registrada sin dinero real',p_idempotency_key:randomUUID()});
   const latest=await sql(staff.from('orders').select('status,revision').eq('id',order.id).single());
   if(!['canceled','delivered','rejected'].includes(latest.status))await staff.rpc('cancel_order',{p_order_id:order.id,p_expected_revision:latest.revision,p_reason:'QA cleanup después de prueba manual',p_idempotency_key:randomUUID()});
   await admin.rpc('classify_order_as_qa',{p_order_id:order.id,p_reason:'manual_payment_pilot_qa_cleanup'});
  }
 }
});
