import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { psqlRaw } from '../../scripts/local-db/lib.mjs';
import { drillRun, fixtureSql, cleanupSql, withDrillFixture, saveRun } from '../../scripts/recovery/qa-drill-fixture.mjs';
const db=process.env.TABA_LOCAL_DB || 'taba_local_base';
const query=async sql=>psqlRaw(db,sql);
const scalar=sql=>psqlRaw(db,sql,{tuples:true}).stdout.trim();

test('simultaneous independent fixtures; interrupted run cleanup is repeatable and preserves the other run', () => {
  const a=drillRun('recovery'),b=drillRun('late-changes');
  try {
    psqlRaw(db,fixtureSql(a)); psqlRaw(db,fixtureSql(b));
    assert.equal(scalar(`select count(*) from public.businesses where id in ('${a.ids.business}','${b.ids.business}') and qa_fixture and qa_window_until between now() and now()+interval '16 minutes'`),'2');
    const before=scalar(`select row_to_json(p) from public.products p where id='${b.ids.product}'`);
    psqlRaw(db,cleanupSql(a)); psqlRaw(db,cleanupSql(a));
    assert.equal(scalar(`select count(*) from public.businesses where id='${a.ids.business}'`),'0');
    assert.equal(scalar(`select count(*) from auth.users where id='${a.ids.user}'`),'0');
    assert.equal(scalar(`select row_to_json(p) from public.products p where id='${b.ids.product}'`),before);
    // Receipt can be reused after a complete cleanup, without permanent fixtures.
    psqlRaw(db,fixtureSql(a));
  } finally { psqlRaw(db,cleanupSql(a)); psqlRaw(db,cleanupSql(b)); }
});

test('saved receipt recovers an interrupted isolated runner and refuses an unmarked database',()=>{
  const run=drillRun('recovery'),database=`taba_local_drill_${run.tag}`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taba-drill-receipt-')),receipt=path.join(dir,'run.json');
  const command=()=>spawnSync(process.execPath,['scripts/recovery/qa-drill-recovery.mjs','--local','--cleanup-only','--run-file',receipt],
    {encoding:'utf8',windowsHide:true,env:process.env,timeout:30000});
  try {
    saveRun(receipt,run);
    // Interruption before the ownership marker: require review, never drop.
    psqlRaw('postgres',`create database ${database} template ${db};`);
    assert.notEqual(command().status,0);
    assert.equal(scalar(`select count(*) from pg_database where datname='${database}'`),'1');
    psqlRaw('postgres',`comment on database ${database} is 'qa-drill:${run.runId}';`);
    psqlRaw(database,fixtureSql(run)); // committed data left by a hard interruption
    const cleaned=command();assert.equal(cleaned.status,0,cleaned.stderr);
    assert.equal(scalar(`select count(*) from pg_database where datname='${database}'`),'0');
    assert.equal(command().status,0,'cleanup can be retried after success');
  } finally {
    psqlRaw('postgres',`drop database if exists ${database} with (force);`);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('cleanup removes finalized synthetic orders, payments, jobs and reservations', () => {
  const r=drillRun('recovery'),b=r.ids.business;
  try {
    psqlRaw(db,fixtureSql(r));
    psqlRaw(db,`do $$ declare i uuid; s uuid; ref text; begin
      select id,checkout_session_id,external_reference into i,s,ref from public.payment_intents where business_id='${b}';
      perform public.record_mercadopago_payment_snapshot(i,jsonb_build_object('provider_payment_id','${r.payment}',
        'external_reference',ref,'preference_id','${r.preference}','merchant_order_id','QA','collector_id','${r.collector}',
        'currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,
        'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('d',64)), 'drill-simulated',null);
      perform public.finalize_paid_checkout_session(s);
    end $$;`);
    assert.equal(scalar(`select count(*) from public.orders where business_id='${b}'`),'1');
    psqlRaw(db,cleanupSql(r));
    for(const table of ['orders','payment_intents','checkout_sessions','products','businesses'])
      assert.equal(scalar(`select count(*) from public.${table} where ${table==='businesses'?'id':'business_id'}='${b}'`),'0',table);
  } finally { psqlRaw(db,cleanupSql(r)); }
});

test('action failure still cleans up; non-owned tenant modification fails closed', async () => {
  const r=drillRun('late-changes');
  await assert.rejects(withDrillFixture(query,r,async()=>{throw Error('simulated process failure');}),/simulated process failure/);
  assert.equal(scalar(`select count(*) from auth.users where id='${r.ids.user}'`),'0');
  psqlRaw(db,fixtureSql(r));
  psqlRaw(db,`update public.businesses set name='Changed externally' where id='${r.ids.business}'`);
  try {
    assert.throws(()=>psqlRaw(db,cleanupSql(r)),/Cleanup refused/);
    assert.equal(scalar(`select count(*) from public.payment_intents where business_id='${r.ids.business}'`),'1');
  } finally {
    psqlRaw(db,`update public.businesses set name='QA drill ${r.tag}' where id='${r.ids.business}'`);
    psqlRaw(db,cleanupSql(r));
  }
});

test('cleanup refuses a checkout that another customer attached to the synthetic tenant',()=>{
  const r=drillRun('recovery'),other=drillRun('recovery');
  try {
    psqlRaw(db,fixtureSql(r));
    psqlRaw(db,`insert into auth.users(id,email) values('${other.ids.user}','${other.email}');
      update public.checkout_sessions set customer_id='${other.ids.user}' where business_id='${r.ids.business}';`);
    assert.throws(()=>psqlRaw(db,cleanupSql(r)),/Cleanup refused/);
    assert.equal(scalar(`select count(*) from public.checkout_sessions where business_id='${r.ids.business}' and customer_id='${other.ids.user}'`),'1');
  } finally {
    psqlRaw(db,`update public.checkout_sessions set customer_id='${r.ids.user}' where business_id='${r.ids.business}';`);
    psqlRaw(db,cleanupSql(r));
    psqlRaw(db,`delete from auth.users where id='${other.ids.user}';`);
  }
});
