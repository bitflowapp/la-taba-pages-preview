import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { generarContrasena, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';
const ref='ucbtjcurawxjwjdvvcvj',url=`https://${ref}.supabase.co`;
const business='a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const {secret,publishable}=await loadStagingKeys();
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const accounts=[
 {role:'owner',email:'owner.pilot.20260923@qa.lataba.invalid',name:'STAGING PILOT OWNER QA 20260923'},
 {role:'staff',email:'staff.pilot.20260923@qa.lataba.invalid',name:'STAGING PILOT STAFF QA 20260923'},
];
const existing=await admin.auth.admin.listUsers({page:1,perPage:1000});
if(existing.error)throw Error(`QA_USERS_READ:${existing.error.code}`);
const result=[];
for(const account of accounts){
 let user=existing.data.users.find(u=>u.email===account.email);
 if(user&&!user.user_metadata?.taba_pilot_qa)throw Error('QA_ACCOUNT_NAME_COLLISION');
 let credential=leerSecreto(account.name);
 if(!user){
  const password=generarContrasena(32);
  const created=await admin.auth.admin.createUser({email:account.email,password,email_confirm:true,
   user_metadata:{taba_pilot_qa:true,taba_actor:'business',display_name:`QA ${account.role}`}});
  if(created.error||!created.data.user)throw Error(`QA_USER_CREATE:${created.error?.code}`);
  user=created.data.user;guardarSecreto(account.name,account.email,password);
  credential=leerSecreto(account.name);
 }
 if(!credential?.secreto||credential.usuario!==account.email)throw Error('QA_CREDENTIAL_STORE_MISSING');
 const member=await admin.from('business_members').select('role,is_active')
  .eq('business_id',business).eq('user_id',user.id).maybeSingle();
 if(member.error)throw Error(`QA_MEMBER_READ:${member.error.code}`);
 if(member.data&&member.data.role!==account.role)throw Error('QA_MEMBER_ROLE_COLLISION');
 if(!member.data){
  const inserted=await admin.from('business_members').insert({business_id:business,user_id:user.id,role:account.role,is_active:true});
  if(inserted.error)throw Error(`QA_MEMBER_CREATE:${inserted.error.code}`);
 }else if(member.data.is_active!==true){
  const enabled=await admin.from('business_members').update({is_active:true}).eq('business_id',business).eq('user_id',user.id);
  if(enabled.error)throw Error(`QA_MEMBER_ENABLE:${enabled.error.code}`);
 }
 const security=await admin.from('identity_user_security').upsert({business_id:business,user_id:user.id},
  {onConflict:'business_id,user_id'});
 if(security.error)throw Error(`QA_SECURITY_PROVISION:${security.error.code}`);
 const client=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await client.auth.signInWithPassword({email:account.email,password:credential.secreto});
 if(login.error||!login.data.session)throw Error(`QA_LOGIN:${account.role}:${login.error?.code||'NO_SESSION'}`);
 const registration=await client.rpc('identity_register_session',{p_business_id:business,p_client:'panel_web',
  p_device_label:`Pilot QA ${account.role}`,p_device_key_hash:null,p_app_version:'pilot-qa'});
 if(registration.error||registration.data?.ok!==true||registration.data.role!==account.role)
  throw Error(`QA_PANEL_ROLE:${account.role}:${registration.error?.code||'MISMATCH'}`);
 result.push({role:account.role,accountCreated:true,login:'PASS',membership:'PASS'});
}
const report={timestamp:new Date().toISOString(),project:ref,businessType:'QA',result};
writeFileSync('artifacts/pilot-qa-role-provisioning.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
