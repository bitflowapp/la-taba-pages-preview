import test from 'node:test';
import assert from 'node:assert/strict';
import { psqlRaw, psqlAsync } from '../../scripts/local-db/lib.mjs';
import { committedFixtureSql, FIXTURE_IDS } from './harness.mjs';

test('eight SQL sessions claim exactly one preference dispatch; retry after lost response cannot reclaim', async()=>{
  const template=process.env.TABA_LOCAL_DB;
  assert.match(template,/^taba_local_codex_payment_fixed$/);
  const db=`taba_local_codex_dispatch_${process.pid}`;
  psqlRaw('postgres',`create database ${db} template ${template}`);
  try{
    // Use the existing synthetic cart, but stop before provider preference creation.
    const setup=committedFixtureSql().replace('public.prepare_mercadopago_preference(', 'public.prepare_mercadopago_preference_v2(')
      .replace(/perform public\.record_mercadopago_preference_created[\s\S]*?;/,'');
    psqlRaw(db,setup);
    const input=JSON.parse(psqlRaw(db,`select jsonb_build_object('attempt',a.id,'authority',public.get_mercadopago_payment_authority_v2(i.business_id,i.environment,i.checkout_session_id,'${FIXTURE_IDS.user}',a.id)->>'authority_version') from public.payment_attempts a join public.payment_intents i on i.id=a.payment_intent_id where i.business_id='${FIXTURE_IDS.business}'`,{tuples:true}).stdout.trim());
    const sql=`select public.claim_mercadopago_preference_dispatch('${input.attempt}','${FIXTURE_IDS.user}','${input.authority}') is not null`;
    const results=await Promise.all(Array.from({length:8},()=>psqlAsync(db,sql)));
    assert.ok(results.every(r=>r.status===0),JSON.stringify(results));
    const owners=results.filter(r=>/^(t|true)$/.test(r.stdout.trim())).length;
    console.log(JSON.stringify({case:'sql-preference-race',callers:8,dispatchOwners:owners}));
    assert.equal(owners,1);
    const retry=psqlRaw(db,sql,{tuples:true}).stdout.trim();
    assert.match(retry,/^(f|false)$/);
    const privilege=psqlRaw(db,"select has_function_privilege('authenticated','public.claim_mercadopago_preference_dispatch(uuid,uuid,text)','EXECUTE')",{tuples:true}).stdout.trim();
    assert.match(privilege,/^(f|false)$/);
  }finally{psqlRaw('postgres',`drop database ${db} with (force)`);}
});
