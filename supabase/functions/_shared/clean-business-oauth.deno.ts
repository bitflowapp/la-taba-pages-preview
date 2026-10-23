import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { createPreference } from './mercadopago.ts';
import { randomSecret } from './seller-oauth-crypto.ts';
import { integratorProviderResponse } from './integrator-identity-fixture.ts';
import { resetIntegratorIdentityCache } from './seller-oauth.ts';

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
const base = 'https://ukxqbgswjlibmnjemrzd.supabase.co';

const ENV = {
  SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key', SUPABASE_ANON_KEY: 'fixture-anon-key',
  MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test', MERCADOPAGO_CREDENTIAL_MODE: 'oauth', TABA_DEPLOYMENT_ENV: 'staging',
  MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd', MERCADOPAGO_OAUTH_PANEL_URL: 'https://taba2-staging.pages.dev/',
  MERCADOPAGO_CLIENT_ID: '2691240967769590', MERCADOPAGO_CLIENT_SECRET: 'fixture-client-secret',
  MERCADOPAGO_TOKEN_ENCRYPTION_KEY: randomSecret(), MERCADOPAGO_OAUTH_WEBHOOK_SECRET: 'fixture-webhook-key',
  PAYMENT_LOG_HASH_SALT: 'fixture-log-salt', TABA_CHECKOUT_BASE_URL: 'https://taba2-staging.pages.dev',
  TABA_ALLOWED_ORIGINS: 'https://taba2-staging.pages.dev',
};
function configure() {
  for (const [name,value] of Object.entries(ENV)) Deno.env.set(name,value);
  Deno.env.delete('MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID');
  resetIntegratorIdentityCache();
}

Deno.test('clean business callback, replay and tenant routing (staging test)', async () => {
  configure();
  let state: Record<string,unknown> | null = null, row: Record<string,unknown> | null = null;
  const financialCalls: string[] = [], receipts: Record<string,unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit;
    const integrator = integratorProviderResponse(input, init);
    if (integrator) return integrator;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if(url.pathname==='/auth/v1/user') return Response.json({id:owner,aud:'authenticated'});
    if(url.pathname.endsWith('/mp_connection_authorized')) {assertEquals(body.p_business_id,business);return Response.json(true);}
    if(url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({allowed:true});
    if(url.pathname.endsWith('/mp_begin_oauth')) {
      assertEquals(body.p_business_id,business);assertEquals(body.p_environment,'test');
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
      assertEquals(body.test_token,undefined);assertEquals(body.redirect_uri,base+'/functions/v1/mercadopago-oauth-callback');
      assertEquals(typeof body.code_verifier,'string');
      return Response.json({access_token:'APP_USR-new-seller-fixture',refresh_token:'fixture-refresh-token',user_id:123,expires_in:15552000,scope:'read write offline_access',live_mode:false});
    }
    if(url.pathname==='/users/me') return Response.json({id:123,site_id:'MLA',tags:['test_user']});
    if(url.origin==='https://api.mercadopago.com') {
      assertEquals(new Headers(init?.headers).get('authorization'),'Bearer APP_USR-new-seller-fixture');
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
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    const headers={authorization:`Bearer fixture.${payload}.fixture`,'content-type':'application/json'};
    const status=await connect(new Request(base+'/functions/v1/mercadopago-connect',{method:'POST',headers,body:JSON.stringify({business_id:business,action:'status'})}));
    assertEquals((await status.json()).connection.status,'disconnected');
    const started=await connect(new Request(base+'/functions/v1/mercadopago-connect',{method:'POST',headers,body:JSON.stringify({business_id:business,action:'connect'})}));
    const auth=new URL((await started.json()).authorization_url);assertEquals(auth.searchParams.get('code_challenge_method'),'S256');
    const callbackUrl=base+'/functions/v1/mercadopago-oauth-callback?state='+auth.searchParams.get('state')+'&code=fixture-code';
    const completed=await callback(new Request(callbackUrl));assertEquals(new URL(completed.headers.get('location')!).searchParams.get('mp_connection'),'connected');
    const replay=await callback(new Request(callbackUrl));assertEquals(new URL(replay.headers.get('location')!).searchParams.get('mp_connection'),'expired');
    const preparation={checkout_session_id:'fixture-session',payment_intent_id:'fixture-intent',payment_attempt_id:'fixture-attempt',attempt_status:'created',attempt_number:1,idempotency_key:'fixture-idempotency',preference_id:null,init_point:null,sandbox_init_point:null,external_reference:'fixture-new-reference',environment:'test' as const,currency:'ARS' as const,total:10,expires_at:new Date(Date.now()+600000).toISOString(),items:[{id:'fixture-product',title:'Fixture',quantity:1,currency_id:'ARS' as const,unit_price:10}],allow_offline_payment_methods:false,installments_limit:1};
    assertEquals((await createPreference(preparation,business)).preferenceId,'fixture-preference');
    const ts=String(Math.floor(Date.now()/1000));
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('fixture-webhook-key'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`id:987;request-id:fixture-request;ts:${ts};`));
    const hex=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,'0')).join('');
    const notification=await webhook(new Request(base+'/functions/v1/mercadopago-webhook?data.id=987',{method:'POST',headers:{'content-type':'application/json','x-request-id':'fixture-request','x-signature':`ts=${ts},v1=${hex}`},body:JSON.stringify({id:'fixture-event',type:'payment',data:{id:'987'},user_id:123})}));
    assertEquals(notification.status,201);assertEquals(receipts.length,1);assertEquals(receipts[0].p_business_id,business);
  } finally {globalThis.fetch=original;Deno.env.delete('MERCADOPAGO_OAUTH_ENVIRONMENT');Deno.env.delete('MERCADOPAGO_OAUTH_ONBOARDING_BUSINESS_ID');Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE');}
});

// 2026-10-23: QA linked test seller 3594962708 through application 2691240967769590, which belongs to the real
// account 721168650. The link looked healthy, and every payment failed at the provider (2034 Invalid users involved).
function integratorHarness(ownerIsTestUser: () => boolean) {
  let state: Record<string,unknown> | null = null;
  const counts = { begin: 0, linked: 0, codeExchanges: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), init = options as RequestInit;
    const integrator = integratorProviderResponse(input, init, ownerIsTestUser());
    if (integrator) return integrator;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if(url.pathname==='/auth/v1/user') return Response.json({id:owner,aud:'authenticated'});
    if(url.pathname.endsWith('/mp_connection_authorized')) return Response.json(true);
    if(url.pathname.endsWith('/consume_payment_rate_limit')) return Response.json({allowed:true});
    if(url.pathname.endsWith('/mp_begin_oauth')) {
      counts.begin++;
      state={...body,business_id:body.p_business_id,user_id:body.p_user_id,generation:'generation',protected_verifier:body.p_protected_verifier};
      return Response.json('generation');
    }
    if(url.pathname.endsWith('/mp_consume_oauth')) {const consumed=state;state=null;return Response.json(consumed?[consumed]:[]);}
    if(url.pathname.endsWith('/mp_finish_oauth')) {counts.linked++;return Response.json(true);}
    if(url.pathname.endsWith('/mp_seller_connections')) return Response.json(null);
    if(url.pathname==='/oauth/token') {counts.codeExchanges++;return Response.json({message:'must not be called'},{status:500});}
    throw Error('Unexpected request in integrator environment test: '+url.pathname);
  };
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
  const headers={authorization:`Bearer fixture.${payload}.fixture`,'content-type':'application/json'};
  const start = () => connect(new Request(base+'/functions/v1/mercadopago-connect',{method:'POST',headers,body:JSON.stringify({business_id:business,action:'connect'})}));
  return { counts, start, restore: () => { globalThis.fetch = original; Deno.env.delete('MERCADOPAGO_OAUTH_ENVIRONMENT'); Deno.env.delete('MERCADOPAGO_CREDENTIAL_MODE'); } };
}

Deno.test('connecting is refused BEFORE the seller consents when the integrator belongs to the other environment', async () => {
  configure();
  const h = integratorHarness(() => false); // a REAL owner in the test environment
  try {
    const started = await h.start();
    assertEquals(started.status, 409);
    assertEquals((await started.json()).code, 'INTEGRATOR_ENVIRONMENT_MISMATCH');
    assertEquals(h.counts.begin, 0, 'no authorization state is created, so no URL can be opened');
  } finally { h.restore(); }
});

Deno.test('an unreadable integrator owner makes connecting a retry, never a silent pass', async () => {
  configure();
  const h = integratorHarness(() => true);
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => new URL(String(input)).pathname === '/oauth/token' && JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}')).grant_type === 'client_credentials'
    ? Promise.resolve(Response.json({ message: 'down' }, { status: 503 })) : original(input, init);
  try {
    const started = await h.start();
    assertEquals(started.status, 503);
    assertEquals((await started.json()).code, 'SELLER_VERIFICATION_UNAVAILABLE');
    assertEquals(h.counts.begin, 0);
  } finally { globalThis.fetch = original; h.restore(); }
});

Deno.test('the callback also refuses to link when the integrator changed after the link was started', async () => {
  configure();
  let ownerIsTestUser = true;
  const h = integratorHarness(() => ownerIsTestUser);
  try {
    const started = await h.start();
    assertEquals(started.status, 200);
    const auth=new URL((await started.json()).authorization_url);
    ownerIsTestUser = false; resetIntegratorIdentityCache();
    const completed=await callback(new Request(base+'/functions/v1/mercadopago-oauth-callback?state='+auth.searchParams.get('state')+'&code=fixture-code'));
    assertEquals(new URL(completed.headers.get('location')!).searchParams.get('mp_connection'),'error');
    assertEquals(h.counts.linked,0,'no link is saved');
    assertEquals(h.counts.codeExchanges,0,'the authorization code is not even exchanged');
  } finally { h.restore(); }
});
