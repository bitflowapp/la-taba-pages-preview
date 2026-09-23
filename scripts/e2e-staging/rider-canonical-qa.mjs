import {createClient} from '@supabase/supabase-js';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {loadStagingKeys} from './qa-staging-keys.mjs';
import {leerSecreto,guardarSecreto,generarContrasena} from '../e2e-production-sale/secretos-windows.mjs';
const URL='https://ucbtjcurawxjwjdvvcvj.supabase.co';
const BUSINESS='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const RUN='RIDER CANONICAL QA RUN 20260922';
const mode=process.argv[2]||'inspect';
if(!['inspect','prepare','prepare-next','resume','input','login-input','observe','browser-input','security','capacity','capacity-resume','cleanup','cleanup-aux','seal'].includes(mode))throw Error('UNKNOWN_QA_MODE');
// Feeding app-private QA input needs local Credential Manager only. A temporary
// Auth/network outage must not block a physical test that will authenticate on Moto.
if(mode==='input'||mode==='login-input'){
 const credential=leerSecreto('STAGING RIDER QA 20260920');
 if(!credential?.usuario||!credential?.secreto)throw Error('QA_CREDENTIAL_UNAVAILABLE');
 const state=mode==='input'?JSON.parse(leerSecreto(RUN)?.secreto||'{}'):{};
 if(mode==='input'&&(!state.publicCode||!state.deliveryCode))throw Error('QA_ORDER_INPUT_MISSING');
 const input={email:credential.usuario,password:credential.secreto,
  waitForObservers:process.argv.includes('--observers'),
  ...(state.publicCode?{publicCode:state.publicCode,deliveryCode:state.deliveryCode}:{})};
 const result=spawnSync('adb',['-s','ZY32LHS6PS','shell','run-as','com.lataba.rider.qa','sh','-c',
  "'mkdir -p files && cat > files/qa-input.json'"],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error('DEVICE_PRIVATE_INPUT_FAILED');
 const report={timestamp:new Date().toISOString(),mode,stagingOnly:true,privateDeviceInput:'READY',networkAuth:'NOT_REQUIRED'};
 writeFileSync(`artifacts/rider-canonical-${mode}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));process.exit(0);
}
const options={auth:{persistSession:false,autoRefreshToken:false}};
const {secret,publishable}=await loadStagingKeys();
const admin=createClient(URL,secret,options);
const actor=async name=>{
 const c=leerSecreto(name); if(!c?.secreto)throw Error('QA_CREDENTIAL_UNAVAILABLE');
 const client=createClient(URL,publishable,options);
 const signed=await client.auth.signInWithPassword({email:c.usuario,password:c.secreto});
 if(signed.error)throw Error('QA_LOGIN_FAILED');
 return {client,user:signed.data.user,credential:c};
};
const customer=await actor('STAGING CUSTOMER QA 20260920');
const staff=await actor('STAGING BUSINESS QA 20260920');
const rider=await actor('STAGING RIDER QA 20260920');
async function rpc(client,name,params={}){const r=await client.rpc(name,params);if(r.error)throw Error(`${name}:${r.error.code}:${r.error.message}`);return r.data}
for(const [a,client] of [[staff,'panel_web'],[rider,'rider_android']])await rpc(a.client,'identity_register_session',{p_business_id:BUSINESS,p_client:client,p_device_label:'Canonical Android QA',p_device_key_hash:null,p_app_version:'0.1.0'});
const report={timestamp:new Date().toISOString(),mode,stagingOnly:true,auth:'PASS'};
const board=await rpc(rider.client,'get_rider_delivery_board');
report.activeDeliveryPolicy=board.max_active_orders;report.activeOrders=board.orders.length;report.offers=board.offers.length;
if(board.max_active_orders!==3)throw Error('POLICY_MISMATCH');
const read=async q=>{const r=await q;if(r.error)throw Error(`READ:${r.error.code}`);return r.data};
async function ensureAvailable(actor){
 const current=await rpc(actor.client,'get_rider_delivery_board');
 if(current.available)return;
 const changed=await rpc(actor.client,'set_rider_availability',{p_business_id:BUSINESS,p_available:true,
  p_expected_version:current.availability_version,p_idempotency_key:`qa_availability_${randomUUID().replaceAll('-','')}`});
 if(!changed.ok || !(await rpc(actor.client,'get_rider_delivery_board')).available)throw Error('RIDER_AVAILABILITY_NOT_CONFIRMED');
}
async function clearAvailability(actor){
 const current=await rpc(actor.client,'get_rider_delivery_board');
 if(!current.available)return;
 const changed=await rpc(actor.client,'set_rider_availability',{p_business_id:BUSINESS,p_available:false,
  p_expected_version:current.availability_version,p_idempotency_key:`qa_availability_${randomUUID().replaceAll('-','')}`});
 if(!changed.ok)throw Error('RIDER_AVAILABILITY_CLEAR_FAILED');
}
if(mode==='inspect'){
 const addresses=await read(customer.client.from('customer_addresses').select('id,latitude,longitude,location_confirmed_at').is('deleted_at',null));
 const products=await read(staff.client.from('products').select('id,name,stock,is_active').eq('business_id',BUSINESS).eq('is_active',true).gt('stock',0).limit(4));
 report.savedAddressCount=addresses.length;report.confirmedAddresses=addresses.filter(a=>a.location_confirmed_at&&a.latitude&&a.longitude).length;report.availableProducts=products.map(p=>({id:p.id,name:p.name,stock:p.stock}));
}
if(mode==='prepare'||mode==='prepare-next'){
 if(leerSecreto(RUN)){
  if(mode!=='prepare-next')throw Error('QA_RUN_ALREADY_EXISTS_INSPECT_DO_NOT_DUPLICATE');
  const previous=JSON.parse(leerSecreto(RUN).secreto);
  const terminal=await read(admin.from('orders').select('status').eq('id',previous.orderId).single());
  if(terminal.status!=='delivered')throw Error('PREVIOUS_RUN_NOT_DELIVERED');
  guardarSecreto(`${RUN} PREVIOUS`,'staging',JSON.stringify(previous));
 }
 const address=(await read(customer.client.from('customer_addresses').select('*').is('deleted_at',null))).find(a=>a.location_confirmed_at&&a.latitude&&a.longitude);
 if(!address)throw Error('CONFIRMED_QA_ADDRESS_REQUIRED');
 const availability=await rpc(staff.client,'commerce_availability',{p_business_id:BUSINESS,p_channel:'delivery',p_context:{}});
 const business=await read(staff.client.from('businesses').select('minimum_delivery_subtotal').eq('id',BUSINESS).single());
 const area=availability.areas?.find(a=>a.name===address.neighborhood)||availability.areas?.[0];
 const minimum=Number(area?.minimum_subtotal??business.minimum_delivery_subtotal??0);
 const candidates=(await read(staff.client.from('products').select('id,name,price,stock').eq('business_id',BUSINESS).eq('is_active',true).eq('available',true).eq('is_verified',true).eq('is_alcoholic',false).gt('stock',0))).map(p=>({product:p,quantity:Math.max(1,Math.ceil((minimum+1)/Number(p.price)))})).filter(c=>c.product.stock>=c.quantity);
 const {product,quantity}=candidates[0]||{};
 if(!product)throw Error('QA_PRODUCT_REQUIRED');
 const tracking=randomBytes(32).toString('base64url');
 const payload={business_id:BUSINESS,client_request_id:randomUUID(),tracking_token:tracking,items:[{product_id:product.id,quantity}],customer_name:'Rider Android QA',customer_phone:'2995550199',delivery_mode:'delivery',payment_method:'coordinate',age_confirmed:true,customer_address_id:address.id,customer_street_address:`${address.street} ${address.street_number}`,customer_neighborhood:address.neighborhood,customer_notes:'QA Android canonico — no despachar pedido real'};
 const order=await rpc(customer.client,'create_order_with_items',{payload});
 const state={orderId:order.id,publicCode:order.public_code,tracking,productId:product.id,quantity,riderId:rider.user.id,createdAt:report.timestamp};
 guardarSecreto(RUN,'staging',JSON.stringify(state));
 report.orderCreated=true;
}
if(mode==='prepare'||mode==='prepare-next'||mode==='resume'){
 const state=JSON.parse(leerSecreto(RUN)?.secreto||'{}');if(!state.orderId)throw Error('NO_RUN');
 const order={id:state.orderId};
 let current=await read(staff.client.from('orders').select('id,status,revision').eq('id',order.id).single());
 for(const status of ['accepted','preparing','ready']){
  if(['pending','accepted','preparing','ready'].indexOf(current.status)>=['pending','accepted','preparing','ready'].indexOf(status))continue;
  await rpc(staff.client,'transition_order',{p_order_id:order.id,p_expected_revision:current.revision,p_new_status:status,p_idempotency_key:randomUUID()});
  current=await read(staff.client.from('orders').select('id,status,revision').eq('id',order.id).single());
 }
 await ensureAvailable(rider);
 const offer=await rpc(staff.client,'offer_order_to_rider',{p_order_id:order.id,p_expected_status:'ready',p_expected_rider_user_id:null,p_new_rider_user_id:rider.user.id});
 if(!offer.ok)throw Error(`QA_OFFER_NOT_CONFIRMED:${offer.code}`);
 const code=await rpc(customer.client,'issue_order_delivery_code',{p_order_id:order.id,p_tracking_token:state.tracking});
 state.deliveryCode=code.delivery_code; state.offer=offer;guardarSecreto(RUN,'staging',JSON.stringify(state));
 report.orderCreated=true;report.offerCreated=true;
}
if(mode==='cleanup'){
 const state=JSON.parse(leerSecreto(RUN)?.secreto||'{}');if(!state.orderId)throw Error('NO_RUN');
 const order=await read(staff.client.from('orders').select('status').eq('id',state.orderId).single());
 if(order.status!=='delivered')throw Error('CLEANUP_REQUIRES_DELIVERED');
 await rpc(admin,'classify_order_as_qa',{p_order_id:state.orderId,p_reason:'rider_android_canonical_physical_qa'});
 await rpc(staff.client,'apply_inventory_movement',{p_business_id:BUSINESS,p_product_id:state.productId,p_barcode_id:null,p_movement_type:'manual_adjustment',p_package_quantity:state.quantity,p_direction:1,p_reference_type:'qa_integrated_delivery',p_reference_id:state.orderId,p_reason:'Reposición posterior al E2E Rider Android QA',p_idempotency_key:`qa_restore_${state.orderId.replaceAll('-','')}`});
 report.qaClassified=true;report.stockRestored=true;
 await clearAvailability(rider);
}
if(mode==='security'){
 const state=JSON.parse(leerSecreto(RUN)?.secreto||'{}');if(!state.orderId)throw Error('NO_RUN');
 const name='STAGING RIDER B CANONICAL QA 20260922';
 if(!leerSecreto(name)){
  const email=`qa.rider.b.canonical.${Date.now()}@lataba.example`,password=generarContrasena();
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Rider B Canonical QA'}});
  if(created.error)throw Error('QA_RIDER_B_CREATE_FAILED');
  guardarSecreto(name,email,password);
 }
 const other=await actor(name);
 const membership=await read(admin.from('business_members').select('role,is_active').eq('business_id',BUSINESS).eq('user_id',other.user.id).maybeSingle());
 if(membership&&membership.role!=='rider')throw Error('QA_ROLE_MISMATCH');
 if(!membership)await read(admin.from('business_members').insert({business_id:BUSINESS,user_id:other.user.id,role:'rider',is_active:true}));
 await read(admin.from('identity_user_security').upsert({business_id:BUSINESS,user_id:other.user.id},{onConflict:'business_id,user_id'}));
 await rpc(other.client,'identity_register_session',{p_business_id:BUSINESS,p_client:'rider_android',p_device_label:'Rider B canonical QA',p_device_key_hash:null,p_app_version:'0.1.0'});
 report.security={};
 const check=(name,pass)=>{report.security[name]=pass?'PASS':'FAIL';if(!pass)throw Error(`SECURITY_FAILED:${name}`)};
 const otherOrders=await read(other.client.from('orders').select('id').eq('id',state.orderId));
 check('otherRiderCannotReadOrder',otherOrders.length===0);
 const ownBoard=await rpc(other.client,'get_rider_delivery_board');check('boardIsScoped',!ownBoard.orders.some(o=>o.id===state.orderId));
 const privatePayload=await other.client.rpc('rider_active_delivery_payload',{p_order_id:state.orderId});check('internalPayloadNotCallable',privatePayload.error?.code==='42501');
 const locations=await other.client.from('rider_locations').select('id').eq('order_id',state.orderId);check('otherRiderCannotReadGps',locations.error?.code==='42501'||(!locations.error&&locations.data.length===0));
 const business=await read(staff.client.from('businesses').select('name').eq('id',BUSINESS).single());
 const businessWrite=await rider.client.from('businesses').update({name:business.name}).eq('id',BUSINESS).select('id');
 check('riderCannotModifyBusiness',!!businessWrite.error||businessWrite.data?.length===0);
 const product=await read(staff.client.from('products').select('price').eq('id',state.productId).single());
 const priceWrite=await rider.client.from('products').update({price:product.price}).eq('id',state.productId).select('id');
 check('riderCannotSetPrice',!!priceWrite.error||priceWrite.data?.length===0);
 const capacity=JSON.parse(leerSecreto('RIDER CANONICAL QA CAPACITY 20260922')?.secreto||'{"orders":[]}');
 if(capacity.orders.length){
  const bOrder=await read(staff.client.from('orders').select('id,customer_name').in('id',capacity.orders.map(o=>o.id)).eq('assigned_rider_user_id',other.user.id).limit(1).maybeSingle());
  if(bOrder){
   const writeOther=await rider.client.from('orders').update({customer_name:bOrder.customer_name}).eq('id',bOrder.id).select('id');
   check('riderACannotModifyBOrder',writeOther.error?.code==='42501'||(!writeOther.error&&writeOther.data.length===0));
  }
 }
 const order=await read(staff.client.from('orders').select('revision,status').eq('id',state.orderId).single());
 const stolen=await other.client.rpc('claim_delivery_order',{p_business_id:BUSINESS,p_public_code:state.publicCode,p_expected_revision:order.revision,p_idempotency_key:randomUUID()});
 check('otherRiderCannotStealOrder',!!stolen.error||stolen.data?.ok===false);
 const finish=await other.client.rpc('confirm_delivery_code',{p_order_id:state.orderId,p_expected_revision:order.revision,p_delivery_code:'0000',p_idempotency_key:randomUUID()});
 check('otherRiderCannotComplete',!!finish.error||finish.data?.ok===false);
 const customerBoard=await customer.client.rpc('get_rider_delivery_board');check('customerCannotUseRiderBoard',!!customerBoard.error);
 const after=await read(staff.client.from('orders').select('status,assigned_rider_user_id').eq('id',state.orderId).single());
 check('orderUnchanged',after.status===order.status&&after.assigned_rider_user_id===rider.user.id);
}
if(mode==='capacity'||mode==='capacity-resume'||mode==='cleanup-aux'){
 const ledgerName='RIDER CANONICAL QA CAPACITY 20260922';
 const check=(name,pass)=>{report[name]=pass?'PASS':'FAIL';writeFileSync(`artifacts/rider-canonical-${mode}.json`,JSON.stringify(report,null,2));if(!pass)throw Error(`CONTRACT_FAILED:${name}`)};
 let ledger=JSON.parse(leerSecreto(ledgerName)?.secreto||'{"orders":[]}');
 const save=()=>guardarSecreto(ledgerName,'staging',JSON.stringify(ledger));
 const other=await actor('STAGING RIDER B CANONICAL QA 20260922');
 await rpc(other.client,'identity_register_session',{p_business_id:BUSINESS,p_client:'rider_android',p_device_label:'Rider B canonical QA',p_device_key_hash:null,p_app_version:'0.1.0'});
 if(mode==='capacity'){
  if(ledger.orders.length)throw Error('CAPACITY_RUN_EXISTS_DO_NOT_DUPLICATE');
  if(board.orders.length)throw Error('CAPACITY_REQUIRES_IDLE_QA_RIDER');
  const sample=JSON.parse(leerSecreto(RUN).secreto);
  const address=(await read(customer.client.from('customer_addresses').select('*').is('deleted_at',null))).find(a=>a.location_confirmed_at&&a.latitude&&a.longitude);
  ledger.productId=sample.productId;ledger.stockBefore=(await read(staff.client.from('products').select('stock').eq('id',sample.productId).single())).stock;
  for(let i=0;i<4;i++){
   const order=await rpc(customer.client,'create_order_with_items',{payload:{business_id:BUSINESS,client_request_id:randomUUID(),tracking_token:randomBytes(32).toString('base64url'),items:[{product_id:sample.productId,quantity:sample.quantity}],customer_name:'QA Rider capacidad',customer_phone:'2995550199',delivery_mode:'delivery',payment_method:'coordinate',age_confirmed:true,customer_address_id:address.id,customer_street_address:`${address.street} ${address.street_number}`,customer_neighborhood:address.neighborhood,customer_notes:'QA canonical capacity — no despachar'}});
   ledger.orders.push({id:order.id,publicCode:order.public_code});save();
   let current=order;
   for(const status of ['accepted','preparing','ready']){
    await rpc(staff.client,'transition_order',{p_order_id:order.id,p_expected_revision:current.revision,p_new_status:status,p_idempotency_key:randomUUID()});
    current=await read(staff.client.from('orders').select('revision,status').eq('id',order.id).single());
   }
   await ensureAvailable(rider);
   const offered=await rpc(staff.client,'offer_order_to_rider',{p_order_id:order.id,p_expected_status:'ready',p_expected_rider_user_id:null,p_new_rider_user_id:rider.user.id});
   if(!offered.ok)throw Error(`QA_CAPACITY_OFFER_NOT_CONFIRMED:${offered.code}`);
  }
  const offered=await rpc(rider.client,'get_rider_delivery_board');
  const offers=ledger.orders.map(o=>offered.offers.find(f=>f.order_id===o.id||f.public_code===o.publicCode));
  check('queue',offers.every(Boolean));
  const accept=(o,key=randomUUID())=>rpc(rider.client,'accept_rider_order_offer',{p_offer_id:o.offer_id,p_expected_version:o.version,p_idempotency_key:key});
  const key=randomUUID();const duplicates=await Promise.all([accept(offers[0],key),accept(offers[0],key)]);
  check('duplicateAccept',duplicates.every(r=>r.ok)&&duplicates.filter(r=>!r.idempotent_no_op).length===1);
  const race=await Promise.all(offers.slice(1).map(o=>accept(o)));
  check('atomicCapacity',race.filter(r=>r.ok&&!r.idempotent_no_op).length===2&&race.filter(r=>r.code==='at_capacity').length===1);
  const full=await rpc(rider.client,'get_rider_delivery_board');check('exactlyThreeActive',full.orders.length===3&&full.at_capacity===true&&full.max_active_orders===3);
  // The server intentionally hides offers when at capacity. Preserve the initial offer.
  ledger.pending=offers.slice(1)[race.findIndex(r=>r.code==='at_capacity')];ledger.capacityEvidence={...report};save();
 }
 if(mode==='capacity'||mode==='capacity-resume'){
  const full=await rpc(rider.client,'get_rider_delivery_board');check('exactlyThreeActive',full.orders.length===3&&full.at_capacity===true&&full.max_active_orders===3);
  if(!ledger.pending){
   const row=await read(admin.from('rider_order_offers').select('id,version,order_id').in('order_id',ledger.orders.map(o=>o.id)).eq('rider_user_id',rider.user.id).eq('status','pending').single());
   ledger.pending={offer_id:row.id,version:row.version,public_code:ledger.orders.find(o=>o.id===row.order_id).publicCode};save();
  }
  const pending=ledger.pending;
  const foreign=await other.client.rpc('accept_rider_order_offer',{p_offer_id:pending.offer_id,p_expected_version:pending.version,p_idempotency_key:randomUUID()});
  check('foreignOfferDenied',foreign.error?.code==='P0002');
  const rejected=await rpc(rider.client,'reject_rider_order_offer',{p_offer_id:pending.offer_id,p_expected_version:pending.version,p_reason_code:null,p_idempotency_key:randomUUID()});check('reject',rejected.ok===true);
  const pendingOrder=ledger.orders.find(o=>o.publicCode===pending.public_code);
  await ensureAvailable(other);
  const bOffered=await rpc(staff.client,'offer_order_to_rider',{p_order_id:pendingOrder.id,p_expected_status:'ready',p_expected_rider_user_id:null,p_new_rider_user_id:other.user.id});
  if(!bOffered.ok)throw Error(`QA_RIDER_B_OFFER_NOT_CONFIRMED:${bOffered.code}`);
  const bBoard=await rpc(other.client,'get_rider_delivery_board');const bOffer=bBoard.offers.find(o=>o.public_code===pendingOrder.publicCode);
  const bAccepted=await rpc(other.client,'accept_rider_order_offer',{p_offer_id:bOffer.offer_id,p_expected_version:bOffer.version,p_idempotency_key:randomUUID()});check('secondRiderAccepted',bAccepted.ok===true);
  check('riderACannotReadB',(await read(rider.client.from('orders').select('id').eq('id',pendingOrder.id))).length===0);
  const aOrder=full.orders[0];check('riderBCannotReadA',(await read(other.client.from('orders').select('id').eq('id',aOrder.id))).length===0);
  const premature=await rider.client.rpc('confirm_delivery_code',{p_order_id:aOrder.id,p_expected_revision:aOrder.revision,p_delivery_code:'0000',p_idempotency_key:randomUUID()});
  check('prematureCompletionDenied',!!premature.error||premature.data?.ok===false);
  ledger.verified=true;save();report.cleanupRequired=true;
 }else{
  for(const order of ledger.orders){
   const current=await read(staff.client.from('orders').select('status,revision').eq('id',order.id).single());
   if(!['canceled','cancelled','rejected','delivered'].includes(current.status))await rpc(staff.client,'cancel_order',{p_order_id:order.id,p_expected_revision:current.revision,p_reason:'QA canonical capacity cleanup — no despacho',p_idempotency_key:`qa_cancel_${order.id.replaceAll('-','')}`});
   await rpc(admin,'classify_order_as_qa',{p_order_id:order.id,p_reason:'rider_canonical_capacity_security_qa'});
  }
  const after=(await read(staff.client.from('products').select('stock').eq('id',ledger.productId).single())).stock;
  check('cancellationRestoredStock',Number(after)===Number(ledger.stockBefore));
  check('riderBoardTerminalRemoved',(await rpc(rider.client,'get_rider_delivery_board')).orders.length===0);
  check('secondRiderBoardTerminalRemoved',(await rpc(other.client,'get_rider_delivery_board')).orders.length===0);
  ledger.cleaned=true;save();
  await clearAvailability(rider);await clearAvailability(other);
 }
}
if(mode==='observe'){
 const state=JSON.parse(leerSecreto(RUN)?.secreto||'{}');if(!state.orderId)throw Error('NO_RUN');
 const order=await read(staff.client.from('orders').select('status,revision,assigned_rider_user_id').eq('id',state.orderId).single());
 const tracker=createClient(URL,publishable,{...options,global:{headers:{'x-order-token':state.tracking}}});
 const tracking=await rpc(tracker,'get_public_order_tracking',{p_public_id:state.publicCode});
 report.orderStatus=order.status;report.assignmentMatches=order.assigned_rider_user_id===rider.user.id;report.customerStatus=tracking?.status;report.customerGpsPresent=!!(tracking?.rider_location||tracking?.location);report.gpsCapturedAt=tracking?.rider_location?.captured_at;report.trackingFieldNames=Object.keys(tracking||{});
}
if(mode==='browser-input'){
 const state=JSON.parse(leerSecreto(RUN)?.secreto||'{}');if(!state.orderId)throw Error('NO_RUN');
 const runtime={mode:'production',repository:{provider:'supabase',deploymentEnvironment:'staging',supabaseUrl:URL,publishableKey:publishable,businessId:BUSINESS,pollMs:1000}};
 for(const [session,actor] of [['rider-panel',staff],['rider-customer',customer]]){
  const auth=(await actor.client.auth.getSession()).data.session;
  const script=`(()=>{if(location.origin!=='http://127.0.0.1:39092')throw Error('ORIGIN_GUARD');localStorage.setItem('RIDER_QA_RUNTIME',${JSON.stringify(JSON.stringify(runtime))});localStorage.setItem('sb-ucbtjcurawxjwjdvvcvj-auth-token',${JSON.stringify(JSON.stringify(auth))});localStorage.setItem('TABA_INSTALL_PROMPT_V1',JSON.stringify({dismissedAt:Date.now()}));${session==='rider-customer'?`localStorage.setItem('taba-order-access-v1:${BUSINESS}:last',${JSON.stringify(JSON.stringify({orderId:state.orderId,publicCode:state.publicCode,trackingToken:state.tracking}))});`:''}return true})()`;
  const result=spawnSync('cmd.exe',['/d','/s','/c',`npx --no-install agent-browser --session ${session} eval --stdin`],{input:script,encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error('BROWSER_PRIVATE_INPUT_FAILED');
 }
 report.browserSessionInput='READY';
}
if(mode==='seal'){
 if(board.orders.length||board.offers.length)throw Error('QA_RIDER_NOT_IDLE');
 for(const name of [RUN,`${RUN} PREVIOUS`]){
  const stored=leerSecreto(name);if(!stored)continue;
  const state=JSON.parse(stored.secreto);
  const terminal=await read(staff.client.from('orders').select('status').eq('id',state.orderId).single());
  if(terminal.status!=='delivered')throw Error('SEAL_REQUIRES_TERMINAL');
  delete state.tracking;delete state.deliveryCode;delete state.offer;state.sealedAt=report.timestamp;
  guardarSecreto(name,'staging',JSON.stringify(state));
 }
 const proof=spawnSync('adb',['-s','ZY32LHS6PS','shell','run-as','com.lataba.rider.qa','cat','files/qa-resilience-result.json'],{encoding:'utf8',windowsHide:true});
 if(proof.status!==0)throw Error('RESILIENCE_PROOF_MISSING');
 const safe=JSON.parse(proof.stdout);writeFileSync('artifacts/rider-canonical-resilience.json',JSON.stringify(safe,null,2));
 report.ephemeralDeliverySecretsRemoved=true;report.qaCredentialsRemainInCredentialManager=true;
}
writeFileSync(`artifacts/rider-canonical-${mode}.json`,JSON.stringify(report,null,2));
writeFileSync(`artifacts/rider-canonical-${mode}-${Date.now()}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
