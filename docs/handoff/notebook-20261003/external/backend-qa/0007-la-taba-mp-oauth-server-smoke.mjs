import {randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {conToken} from 'file:///C:/1212/la-taba-mercadopago-oauth/scripts/lib/supabase-cli-token.mjs';
const ref='ukxqbgswjlibmnjemrzd', base=`https://${ref}.supabase.co`;
const business='00000000-0000-4000-8000-000000000001';
await conToken(async managementToken=>{
 const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`,{headers:{Authorization:`Bearer ${managementToken}`}});
 if(!keysResponse.ok)throw Error('Unable to access staging test');
 const keys=await keysResponse.json(),service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
 const admin={apikey:service,Authorization:`Bearer ${service}`,'content-type':'application/json'};
 let userId;
 const evidence={};
 try {
  const password=randomBytes(32).toString('base64url'),email=`taba-oauth-smoke-${randomUUID()}@example.invalid`;
  const created=await fetch(`${base}/auth/v1/admin/users`,{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:'TABA staging OAuth automated test'}})});
  if(!created.ok)throw Error('Unable to create isolated staging identity');
  userId=(await created.json()).id;
  const member=await fetch(`${base}/rest/v1/business_members`,{method:'POST',headers:admin,body:JSON.stringify({business_id:business,user_id:userId,role:'owner',is_active:true})});
  if(!member.ok)throw Error('Unable to authorize isolated staging identity');
  const login=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email,password})});
  evidence.loginHttp=login.status;
  if(!login.ok)throw Error('Staging login failed');
  const session=await login.json();
  const headers={apikey:anon,Authorization:`Bearer ${session.access_token}`,'content-type':'application/json',Origin:'https://taba2-staging.pages.dev'};
  const registered=await fetch(`${base}/rest/v1/rpc/identity_register_session`,{method:'POST',headers,body:JSON.stringify({p_business_id:business,p_client:'panel_web',p_device_label:'Automated OAuth staging smoke'})});
  const registration=await registered.json();evidence.sessionRegistered=registered.ok&&registration.ok===true;
  if(!evidence.sessionRegistered)throw Error('Staging session registration failed');
  const connect=await fetch(`${base}/functions/v1/mercadopago-connect`,{method:'POST',headers,body:JSON.stringify({business_id:business,action:'connect'})});
  evidence.connectHttp=connect.status;
  const result=await connect.json();if(!result.authorization_url)throw Error('OAuth start failed');
  const authorization=new URL(result.authorization_url);
  evidence.pkceS256=authorization.searchParams.get('code_challenge_method')==='S256';
  evidence.scopesCorrect=authorization.searchParams.get('scope')==='read write offline_access';
  evidence.callbackCorrect=authorization.searchParams.get('redirect_uri')===`${base}/functions/v1/mercadopago-oauth-callback`;
  const provider=await fetch(authorization,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  evidence.providerHttp=provider.status;
  evidence.providerLocationOrigin=provider.headers.get('location')?new URL(provider.headers.get('location'),authorization).origin:null;
  const callback=new URL(`${base}/functions/v1/mercadopago-oauth-callback`);
  callback.searchParams.set('state',authorization.searchParams.get('state'));
  callback.searchParams.set('error','access_denied');
  const cancelled=await fetch(callback,{redirect:'manual'});
  evidence.cancelHttp=cancelled.status;
  evidence.cancelResult=new URL(cancelled.headers.get('location')).searchParams.get('mp_connection');
  const replay=await fetch(callback,{redirect:'manual'});
  evidence.replayHttp=replay.status;
  evidence.replayResult=new URL(replay.headers.get('location')).searchParams.get('mp_connection');
  const signedOut=await fetch(`${base}/auth/v1/logout`,{method:'POST',headers});
  evidence.logoutHttp=signedOut.status;
 } finally {
  if(userId){
   const stateCleanup=await fetch(`${base}/rest/v1/mp_oauth_states?user_id=eq.${userId}`,{method:'DELETE',headers:admin});
   const membershipCleanup=await fetch(`${base}/rest/v1/business_members?user_id=eq.${userId}`,{method:'DELETE',headers:admin});
   const identityCleanup=await fetch(`${base}/auth/v1/admin/users/${userId}`,{method:'DELETE',headers:admin});
   evidence.testIdentityRemoved=stateCleanup.ok&&membershipCleanup.ok&&identityCleanup.ok;
  }
  fs.writeFileSync('C:/1212/la-taba-mp-oauth-server-evidence.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
 }
});
