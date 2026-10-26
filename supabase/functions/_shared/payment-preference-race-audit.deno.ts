// Executes the actual Edge handler. All HTTP is replaced; --deny-net enforces isolation.
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { protect, resetIntegratorIdentityCache } from './seller-oauth.ts';
import { sha256Hex } from './payment-runtime.ts';
import { integratorProviderResponse } from './integrator-identity-fixture.ts';
let handle: (r: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((fn: typeof handle) => { handle=fn; return {}; }) as typeof Deno.serve;
try { await import('../mercadopago-create-preference/index.ts'); } finally { Deno.serve=serve; }

Deno.test('independent audit: concurrent preference requests dispatch at most one provider POST', async () => {
  resetIntegratorIdentityCache();
  const b='94000000-0000-4000-8000-000000000001',u='94000000-0000-4000-8000-000000000002';
  const s='94000000-0000-4000-8000-000000000003',i='94000000-0000-4000-8000-000000000004';
  for (const [name,value] of Object.entries({
    SUPABASE_URL:'https://wwcpogltfgzgkrlilbcd.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_ANON_KEY:'fixture-anon',
    MERCADOPAGO_ENVIRONMENT:'production',MERCADOPAGO_OAUTH_ENVIRONMENT:'production',MERCADOPAGO_CREDENTIAL_MODE:'oauth',
    MERCADOPAGO_PRODUCTION_REVIEW_STATUS:'approved',MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION:'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE',
    TABA_DEPLOYMENT_ENV:'production',MERCADOPAGO_OAUTH_PROJECT_REF:'wwcpogltfgzgkrlilbcd',MERCADOPAGO_OAUTH_PANEL_URL:'https://la-taba.pages.dev/',
    TABA_CHECKOUT_BASE_URL:'https://la-taba.pages.dev',TABA_ALLOWED_ORIGINS:'https://la-taba.pages.dev',MERCADOPAGO_CLIENT_ID:'7677852968049976',
    MERCADOPAGO_CLIENT_SECRET:'fixture-secret',PAYMENT_LOG_HASH_SALT:'fixture-salt',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY:'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  })) Deno.env.set(name,value);
  const expiry=new Date(Date.now()+600000).toISOString();
  const seller={business_id:b,environment:'production',status:'connected',seller_id:'123456789',application_id:'7677852968049976',
    protected_tokens:await protect({access_token:'APP_USR-audit-fixture'},b),expires_at:new Date(Date.now()+172800000).toISOString(),generation:'fixture-generation',refresh_owner:null};
  const preparation={checkout_session_id:s,payment_intent_id:i,payment_attempt_id:i,attempt_number:1,idempotency_key:i,
    preference_id:null,init_point:null,sandbox_init_point:null,attempt_status:'prepared',external_reference:'fixture-reference',
    environment:'production',currency:'ARS',total:100,expires_at:expiry,items:[{id:'product',title:'Synthetic',quantity:1,currency_id:'ARS',unit_price:100}],allow_offline_payment_methods:false};
  const attempt={id:i,payment_intent_id:i,attempt_type:'preference',attempt_number:1,idempotency_key:i,status:'prepared',
    preference_id:null as string|null,init_point:null as string|null,authority_revision:1,seller_generation:seller.generation,seller_id:seller.seller_id};
  const intent={id:i,business_id:b,checkout_session_id:s,current_payment_attempt_id:i,internal_status:'preference_creating',preference_id:null as string|null};
  const snapshot=async()=>{
    const data=structuredClone({seller,attempt,intent,
      business:{id:b,is_active:true,status:'open',ordering_enabled:true,ordering_verified:true},
      settings:{business_id:b,provider:'mercadopago',enabled:true,environment:'production',checkout_mode:'checkout_pro',currency:'ARS',reserve_stock:true,production_review_status:'approved',collector_id:seller.seller_id,application_id:seller.application_id},
      checkout:{id:s,customer_id:u,business_id:b,payment_intent_id:i,environment:'production',status:'ready_for_payment',expires_at:expiry,reservation_valid:true,business_open:true}});
    return {...data,authority_version:await sha256Hex(JSON.stringify(data))};
  };
  let searches=0,posts=0,claimed=false;
  let release!:()=>void;
  const bothSearches=new Promise<void>(resolve=>release=resolve);
  const original=globalThis.fetch;
  globalThis.fetch=async(input,rawOptions)=>{
    const options=rawOptions as RequestInit | undefined;
    const url=new URL(String(input)),body=options?.body?JSON.parse(String(options.body)):{};
    if(url.pathname==='/auth/v1/user')return Response.json({id:u});
    if(url.pathname.endsWith('/consume_payment_rate_limit'))return Response.json({allowed:true});
    if(url.pathname.endsWith('/prepare_mercadopago_preference_v2'))return Response.json(preparation);
    if(url.pathname.endsWith('/payment_intents'))return Response.json({business_id:b,environment:'production'});
    if(url.pathname.endsWith('/mp_seller_connections'))return Response.json(seller);
    if(url.pathname.endsWith('/get_mercadopago_payment_authority_v2'))return Response.json(await snapshot());
    if(url.pathname.endsWith('/claim_mercadopago_preference_dispatch')){
      if(claimed)return Response.json(null);
      claimed=true;attempt.status='request_sent';attempt.authority_revision++;
      return Response.json(await snapshot());
    }
    if(url.pathname.endsWith('/record_mercadopago_preference_created_v2')){
      if(attempt.status==='created')return Response.json({message:'authority changed'},{status:409});
      attempt.status='created';attempt.preference_id=body.p_preference_id;attempt.init_point=body.p_init_point;
      intent.preference_id=body.p_preference_id;attempt.authority_revision++;
      return Response.json(await snapshot());
    }
    const integrator=integratorProviderResponse(input,options,false);if(integrator)return integrator;
    if(url.pathname==='/users/me')return Response.json({id:123456789,site_id:'MLA',tags:['normal']});
    if(url.pathname==='/checkout/preferences/search'){
      searches++;if(searches===2)release();await bothSearches;
      return Response.json({elements:[],total:0});
    }
    if(url.pathname==='/checkout/preferences'&&options?.method==='POST'){
      posts++;
      return Response.json({id:`synthetic-${posts}`,init_point:`https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=synthetic-${posts}`});
    }
    throw Error('Unexpected isolated request '+url.pathname);
  };
  try{
    const request=()=>new Request('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-create-preference',{
      method:'POST',headers:{authorization:'Bearer fixture-customer','content-type':'application/json'},body:JSON.stringify({checkout_session_id:s})});
    const responses=await Promise.all([handle(request()),handle(request())]);
    console.log(JSON.stringify({case:'concurrent-preference',providerPosts:posts,responseStatuses:responses.map(r=>r.status)}));
    assertEquals(posts,1,'local transaction safety must not depend on undocumented provider preference idempotency');
  }finally{release();globalThis.fetch=original;}
});
