import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.19';
import { createPreference } from './mercadopago.ts';
import { randomSecret } from './seller-oauth-crypto.ts';

const handlers: Array<(r: Request) => Promise<Response>> = [];
const serve = Deno.serve;
Deno.serve = ((handler: unknown) => { handlers.push(handler as typeof handlers[number]); return {}; }) as typeof Deno.serve;
try {
  await import('../mercadopago-connect/index.ts');
  await import('../mercadopago-oauth-callback/index.ts');
  await import('../mercadopago-webhook/index.ts');
} finally { Deno.serve = serve; }
const [connect, callback, webhook] = handlers;
const business = '93000000-0000-4000-8000-000000000001';
const owner = '93000000-0000-4000-8000-000000000002';
const base = 'https://clean-oauth.supabase.co';

for (const realConsent of [false, true]) Deno.test(`clean business callback, replay and tenant routing (${realConsent ? 'isolated real consent' : 'test checkout'})`, async () => {
  for (const [name,value] of Object.entries({
    SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key', SUPABASE_ANON_KEY: 'fixture-anon-key',
    MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_CREDENTIAL_MODE: 'oauth', TABA_DEPLOYMENT_ENV: 'staging',
    MERCADOPAGO_OAUTH_PROJECT_REF: 'clean-oauth', MERCADOPAGO_OAUTH_PANEL_URL: 'https://staging.example.invalid/',
    MERCADOPAGO_CLIENT_ID: '456', MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
    MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: 'fixture-webhook-key',
    PAYMENT_LOG_HASH_SALT: 'fixture-log-salt', TABA_CHECKOUT_BASE_URL: 'https://staging.example.invalid',
    TABA_ALLOWED_ORIGINS: 'https://staging.example.invalid',
  })) Deno.env.set(name,value);
  Deno.env.delete('MERCADOPAGO_OAUTH_ENVIRONMENT'); Deno.env.delete('MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID');
  if(realConsent){Deno.env.set('MERCADOPAGO_OAUTH_ENVIRONMENT','production');Deno.env.set('MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID',business);}
  let state: Record<string,unknown> | null = null, row: Record<string,unknown> | null = null;
  const financialCalls: string[] = [], receipts: Record<string,unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if(url.pathname==='/auth/v1/user') return Response.json({id:owner,aud:'authenticated'});
    if(url.pathname.endsWith('/mp_connection_authorized')) {assertEquals(body.p_business_id,business);return Response.json(true);}
    if(url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({allowed:true});
    if(url.pathname.endsWith('/mp_begin_oauth')) {
      assertEquals(body.p_business_id,business);assertEquals(body.p_environment,realConsent?'production':'test');
      state={...body,business_id:body.p_business_id,user_id:body.p_user_id,generation:'generation',protected_verifier:body.p_protected_verifier};
      return Response.json('generation');
    }
    if(url.pathname.endsWith('/mp_consume_oauth')) {const consumed=state;state=null;return Response.json(consumed?[consumed]:[]);}
    if(url.pathname.endsWith('/mp_finish_oauth')) {
      assertEquals(body.p_business_id,business);assertEquals(body.p_seller_id,'123');
      row={business_id:business,seller_id:body.p_seller_id,application_id:body.p_application_id,environment:body.p_environment,status:'connected',protected_tokens:body.p_protected_tokens,expires_at:body.p_expires_at,refresh_owner:null};
      return Response.json(true);
    }
    if(url.pathname.endsWith('/mp_seller_connections')) return Response.json(row);
    if(url.pathname.endsWith('/payment_intents')) {assertEquals(url.searchParams.get('external_reference'),'eq.fixture-new-reference');return Response.json({business_id:business,environment:'test'});}
    if(url.pathname.endsWith('/mp_record_seller_webhook')) {assertEquals(body.p_business_id,business);receipts.push(body);return Response.json({receipt_id:'fixture',queued:true});}
    if(url.pathname==='/oauth/token') {
      assertEquals(body.test_token,!realConsent);assertEquals(body.redirect_uri,base+'/functions/v1/mercadopago-oauth-callback');
      assertEquals(typeof body.code_verifier,'string');
      return Response.json({access_token:'fixture-new-seller-token',refresh_token:'fixture-refresh-token',user_id:123,expires_in:15552000,scope:'read write offline_access',live_mode:realConsent});
    }
    if(url.pathname==='/users/me') return Response.json({id:123,site_id:'MLA',tags:realConsent?['normal']:['test_user']});
    if(url.origin==='https://api.mercadopago.com') {
      assertEquals(new Headers(init?.headers).get('authorization'),'Bearer fixture-new-seller-token');
      financialCalls.push(url.pathname);
      if(url.pathname==='/checkout/preferences') {
        assertEquals(body.external_reference,'fixture-new-reference');assertEquals(body.notification_url,base+'/functions/v1/mercadopago-webhook');
        return Response.json({id:'fixture-preference',init_point:'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=fixture'}, {status:201});
      }
      if(url.pathname==='/v1/payments/987') return Response.json({id:987,collector_id:123,live_mode:false,external_reference:'fixture-new-reference'});
    }
    throw Error('Unexpected request in clean business test: '+url.pathname);
  };
  try {
    const headers={authorization:'Bearer fixture-session','content-type':'application/json'};
    const status=await connect(new Request(base+'/functions/v1/mercadopago-connect',{method:'POST',headers,body:JSON.stringify({business_id:business,action:'status'})}));
    assertEquals((await status.json()).connection.status,'disconnected');
    const started=await connect(new Request(base+'/functions/v1/mercadopago-connect',{method:'POST',headers,body:JSON.stringify({business_id:business,action:'connect'})}));
    const auth=new URL((await started.json()).authorization_url);assertEquals(auth.searchParams.get('code_challenge_method'),'S256');
    const callbackUrl=base+'/functions/v1/mercadopago-oauth-callback?state='+auth.searchParams.get('state')+'&code=fixture-code';
    const completed=await callback(new Request(callbackUrl));assertEquals(new URL(completed.headers.get('location')!).searchParams.get('mp_connection'),'connected');
    const replay=await callback(new Request(callbackUrl));assertEquals(new URL(replay.headers.get('location')!).searchParams.get('mp_connection'),'error');
    const preparation={checkout_session_id:'fixture-session',payment_intent_id:'fixture-intent',payment_attempt_id:'fixture-attempt',attempt_status:'created',attempt_number:1,idempotency_key:'fixture-idempotency',preference_id:null,init_point:null,sandbox_init_point:null,external_reference:'fixture-new-reference',environment:'test' as const,currency:'ARS' as const,total:10,expires_at:new Date(Date.now()+600000).toISOString(),items:[{id:'fixture-product',title:'Fixture',quantity:1,currency_id:'ARS' as const,unit_price:10}],allow_offline_payment_methods:false,installments_limit:1};
    if(realConsent) {await assertRejects(()=>createPreference(preparation,business));assertEquals(financialCalls.length,0);return;}
    assertEquals((await createPreference(preparation,business)).preferenceId,'fixture-preference');
    const ts=String(Math.floor(Date.now()/1000));
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('fixture-webhook-key'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`id:987;request-id:fixture-request;ts:${ts};`));
    const hex=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,'0')).join('');
    const notification=await webhook(new Request(base+'/functions/v1/mercadopago-webhook?data.id=987',{method:'POST',headers:{'content-type':'application/json','x-request-id':'fixture-request','x-signature':`ts=${ts},v1=${hex}`},body:JSON.stringify({id:'fixture-event',type:'payment',data:{id:'987'},user_id:123})}));
    assertEquals(notification.status,201);assertEquals(receipts.length,1);assertEquals(receipts[0].p_business_id,business);
  } finally {globalThis.fetch=original;Deno.env.delete('MERCADOPAGO_OAUTH_ENVIRONMENT');Deno.env.delete('MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID');Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE');}
});
