import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const container=process.argv[2];
if(process.env.TABA_LOCAL_PAYMENT_DB!=='1'||!/^taba-a1-a4-local-[\w-]+$/.test(container||''))throw Error('Disposable local DB required');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(info.Mounts.some(m=>m.Type==='bind'),false);
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:'set search_path=public,extensions;\n'+q,encoding:'utf8',stdio:['pipe','pipe','pipe']});
for(const name of ['mercadopago_checkout_pro.local.sql','mercadopago_seller_oauth.local.sql','mercadopago_clean_business.local.sql','production_least_privilege_test.sql']){
 const output=sql(fs.readFileSync('supabase/tests/'+name,'utf8'));assert.doesNotMatch(output,/^not ok\b/m);console.log(name+'\n'+output);
}
const functions=[
 'get_mercadopago_payment_authority_v2(uuid,text,uuid,uuid,uuid)',
 'get_mercadopago_payment_authority_base_v2(uuid,text,uuid,uuid)',
 'record_mercadopago_preference_created_v2(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text)',
 'prepare_mercadopago_preference_v2(uuid,uuid,boolean)',
 'record_payment_refund_identity(uuid,uuid,text,uuid,text)',
 'record_payment_refund_response_v2(uuid,text,text,numeric,text)',
 'claim_payment_outbox_v2(text,integer,integer)',
];
for(const f of functions){
 assert.equal(sql(`select has_function_privilege('anon','public.${f}','EXECUTE') or has_function_privilege('authenticated','public.${f}','EXECUTE')`).trim(),'f');
 assert.equal(sql(`select has_function_privilege('service_role','public.${f}','EXECUTE')`).trim(),'t');
}
assert.equal(sql("select has_function_privilege('anon','public.prepare_payment_refund_v2(uuid,numeric,uuid,text)','EXECUTE')").trim(),'f');
assert.equal(sql("select has_function_privilege('authenticated','public.prepare_payment_refund_v2(uuid,numeric,uuid,text)','EXECUTE')").trim(),'t');
console.log('V2_RPC_PRIVILEGES: PASS (anon/authenticated denied; service_role granted)');
