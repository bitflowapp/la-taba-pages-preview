// All mutations below are to a positively identified network-isolated fixture.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { localClient, localSession, assertLocalContainer } from '../tests/fixtures/release-v5-database.mjs';
import { platformFixture } from '../tests/fixtures/release-v5-platform.mjs';
import { localContext, buildSources } from './release-v5/identity.mjs';
import { Lifecycle } from './release-v5/lifecycle.mjs';
import { ROOT, GUARDED_TABLES } from './release-v5/model.mjs';

const container=process.argv[2]; assertLocalContainer(container);
const audit=await localClient(container);
const {platform,state}=platformFixture(async(sql,args)=>(await audit.query(sql,args)).rows);
let first=await localSession(container,platform);
const second=await localSession(container,platform),writer=await localClient(container);
const context=localContext(ROOT,{requireClean:false}), built=await buildSources();
const lifecycle=new Lifecycle({session:first,platform,context,built});
const query=(sql,args=[])=>audit.query(sql,args);
const value=async(sql,args=[])=>Object.values((await query(sql,args)).rows[0])[0];
const pass=label=>console.log(label+': PASS');
try {
  // The owning runner must have installed the real schema and migration ledger.
  await first.acquire(0);
  await assert.rejects(second.acquire(250),/lock timeout/);
  await first.ownership(); pass('LIVE_PG_SESSION_LOCK_SECOND_RUNNER_REJECTED');
  await lifecycle.verifyExpand();
  assert.equal(await value("select rolsuper from pg_roles where rolname=current_user"),false);
  for(const role of ['anon','authenticated','service_role']){
    assert.equal(await value("select has_table_privilege($1,'private.a1_a4_releases_v5','SELECT,INSERT,UPDATE,DELETE')",[role]),false);
    assert.equal(await value("select has_function_privilege($1,'private.verify_a1_a4_release_v5(uuid,jsonb,jsonb,jsonb)','EXECUTE')",[role]),false);
  }
  pass('MANAGED_NON_SUPERUSER_AND_PRIVATE_PROOF_PERMISSIONS');
  const quiesceSql='select private.quiesce_a1_a4_release_v5($1,$2,$3,$4)';
  const bindings=[context.commit,built.sourceIdentity,context.expand_sha,context.contract_sha];
  const statusInserts={
    payment_intents:"insert into public.payment_intents(checkout_session_id,business_id,environment,external_reference,expected_amount,internal_status,correlation_id) values(gen_random_uuid(),gen_random_uuid(),'production','taba2:checkout:'||gen_random_uuid(),100,$1,gen_random_uuid())",
    payment_attempts:"insert into public.payment_attempts(payment_intent_id,attempt_number,status) values(gen_random_uuid(),1,$1)",
    payment_refunds:"insert into public.payment_refunds(payment_intent_id,amount,status) values(gen_random_uuid(),100,$1)",
    payment_cancellations:"insert into public.payment_cancellations(payment_intent_id,status) values(gen_random_uuid(),$1)",
    payment_outbox:"insert into public.payment_outbox(payment_intent_id,topic,status) values(gen_random_uuid(),'payment_reconcile',$1)",
  };
  let statuses=0;
  for(const [table,insert] of Object.entries(statusInserts)){
    const definition=await value('select pg_get_constraintdef(oid) from pg_constraint where conname=$1',[table+'_status_check']);
    const vocabulary=[...definition.matchAll(/'([^']+)'/g)].map(v=>v[1]);assert.ok(vocabulary.length>=6);
    for(const status of vocabulary){
      await first.query('begin; set local session_replication_role=replica');
      try {
        await first.query(insert,[status]);
        assert.equal((await first.value('select private.a1_a4_financial_counts_v5()'))[table],1);
        await assert.rejects(first.value(quiesceSql,bindings),/PRE_ONBOARDING_FINANCIAL_STATE_REQUIRED/);statuses++;
      } finally {await first.query('rollback');}
    }
    await first.query('begin; set local session_replication_role=replica');
    try {await assert.rejects(first.query(insert,['unknown_future_provider_state']),/check constraint/);} finally{await first.query('rollback');}
  }
  console.log(`SCHEMA_DERIVED_FINANCIAL_STATUS_REJECTION: PASS (${statuses} actual constrained states)`);
  await first.query('begin; alter table public.payment_intents drop constraint payment_intents_status_check');
  try {await assert.rejects(first.value(quiesceSql,bindings),/COMPATIBILITY_MISMATCH/);}finally{await first.query('rollback');}
  await first.query('begin; alter table public.payment_outbox rename to removed_for_failure_fixture');
  try {await assert.rejects(first.value('select private.a1_a4_inert_snapshot_v5()'));}finally{await first.query('rollback');}
  pass('UNKNOWN_SCHEMA_AND_DATABASE_READ_FAILURE_FAIL_CLOSED');
  // A writer activates after the read-only preflight but before quiescence.
  // The real transaction holds the guard row lock. Quiesce waits and then sees
  // the committed activation; it cannot deploy based on the earlier snapshot.
  const fixtureBusiness=randomUUID();
  await writer.query('begin; set local session_replication_role=replica');
  await writer.query("insert into public.business_payment_settings(business_id,environment,enabled,production_review_status,collector_id,application_id) values($1,'production',true,'approved','fixture-collector','fixture-application')",[fixtureBusiness]);
  const blocked=lifecycle.quiesce().then(()=>new Error('UNEXPECTED_QUIESCE_SUCCESS'),e=>e);
  for(let i=0;;i++){
    if(await value('select cardinality(pg_blocking_pids($1))>0',[first.pid]))break;
    assert.ok(i<100,'quiesce never waited for active financial writer');await new Promise(r=>setTimeout(r,20));
  }
  await writer.query('commit');
  assert.match((await blocked).message,/PRE_ONBOARDING_FINANCIAL_STATE_REQUIRED/);
  await query('delete from public.business_payment_settings where business_id=$1',[fixtureBusiness]);
  assert.equal(state.stageCount,0);pass('ACTIVATION_AFTER_PREFLIGHT_IS_SERIALIZED_AND_REJECTED');
  await second.query('begin isolation level repeatable read');
  await second.query('select paused from private.a1_a4_release_control_v5');
  const {release_id:id}=await lifecycle.quiesce();
  await assert.rejects(second.query('update public.business_payment_settings set enabled=enabled where false'),/serialize access/);
  await second.query('rollback');pass('STALE_REPEATABLE_READ_SNAPSHOT_CANNOT_BYPASS_QUIESCENCE');
  assert.equal((await lifecycle.drain(id)).ready,false);
  await assert.rejects(lifecycle.release(id),/NOT_INERT_OR_DRAINED/);
  assert.equal(state.stageCount,0); pass('PRE_DRAIN_DEPLOYMENT_REJECTED');
  for(const table of GUARDED_TABLES) {
    await assert.rejects(query(`update public.${table} set ${table==='checkout_sessions'?'status':table==='business_payment_settings'?'enabled':table==='mp_oauth_states'?'expires_at':table==='inventory_reservations'?'status':table==='checkout_session_items'?'quantity':table==='payment_intents'?'internal_status':table==='payment_webhook_receipts'?'environment':table==='payment_events'?'event_type':'status'}=${table==='checkout_sessions'?'status':table==='business_payment_settings'?'enabled':table==='mp_oauth_states'?'expires_at':table==='inventory_reservations'?'status':table==='checkout_session_items'?'quantity':table==='payment_intents'?'internal_status':table==='payment_webhook_receipts'?'environment':table==='payment_events'?'event_type':'status'} where false`),/TABA_RELEASE_QUIESCED/);
  }
  assert.equal(await value("select public.dispatch_payment_outbox_worker('cron')"),null);
  await assert.rejects(query("insert into net.http_request_queue(method,url,headers,body,timeout_milliseconds) values('POST','https://fixture.invalid','{}','{}',5000)"),/TABA_RELEASE_QUIESCED/);
  assert.equal(await value("select private.dispatch_payment_outbox_worker_v3_body('cron')"),null);
  pass('ALL_FINANCIAL_WRITES_AND_DIRECT_DISPATCH_BLOCKED');
  // Explicitly adjust only fixture time. The production path has no time or
  // drain override, and both timing failures are tested before this adjustment.
  await query("update private.a1_a4_release_control_v5 set paused_at=clock_timestamp()-interval '440 seconds',drain_observed_at=clock_timestamp()-interval '440 seconds'; update private.a1_a4_payment_dispatch_control set paused_at=clock_timestamp()-interval '440 seconds'");
  await lifecycle.protectedGate(id);
  await query("select cron.alter_job(jobid,active=>true) from cron.job where jobname='taba-checkout-provider-truth-sweep'");
  await assert.rejects(lifecycle.protectedGate(id),/NOT_INERT_OR_DRAINED/);
  await assert.rejects(query('select public.enqueue_checkout_provider_probes()'),/TABA_RELEASE_QUIESCED/);
  await query("select cron.alter_job(jobid,active=>false) from cron.job where jobname='taba-checkout-provider-truth-sweep'");
  await query("insert into private.a1_a4_payment_dispatch_audit(request_id,source) values(-501,'cron')");
  await assert.rejects(lifecycle.protectedGate(id),/NOT_INERT_OR_DRAINED/);
  await query("begin; set local session_replication_role=replica; update private.a1_a4_payment_dispatch_audit set requested_at=clock_timestamp()-interval '440 seconds' where request_id=-501; commit");
  await query("insert into net._http_response(id,status_code,created) values(-502,200,clock_timestamp())");
  await assert.rejects(lifecycle.protectedGate(id),/NOT_INERT_OR_DRAINED/);
  await query('delete from net._http_response where id=-502');
  pass('SCHEDULER_RACE_DEQUEUED_DISPATCH_AND_RECENT_RESPONSE_REJECTED');
  await assert.rejects(first.value('select private.execute_a1_a4_contract_v5($1,$2)',[id,context.contract_sha]),/CONTRACT_BINDING/);
  await assert.rejects(first.value("select private.execute_a1_a4_legacy_contract_v3(null,'production','forged',$1,'20260909050330',$2,'forged')",[context.contract_sha,context.expand_sha]),/V5_TRUSTED_RELEASE_REQUIRED/);
  pass('MISSING_TRUSTED_PROOF_AND_ARCHIVED_CONTRACT_ENTRYPOINT_REJECTED');
  // Kill a real runner process while its pg.Client owns the session lock.
  // The process lock must disappear, but the committed financial pause must not.
  await first.close();
  const holder=spawn(process.execPath,['tests/fixtures/release-v5-lock-holder.mjs',container],{cwd:ROOT,env:process.env,windowsHide:true});
  let childError='';holder.stderr.on('data',b=>childError+=b);
  const exited=new Promise(resolve=>holder.once('close',resolve));
  await Promise.race([
    new Promise(resolve=>holder.stdout.once('data',resolve)),
    exited.then(()=>{throw new Error('lock holder exited before ready: '+childError);}),
  ]);
  await assert.rejects(second.acquire(0),/lock timeout/);
  holder.kill('SIGKILL');await exited;
  await second.acquire(5000);await second.close();
  assert.equal(await value('select paused from private.a1_a4_release_control_v5'),true);
  await assert.rejects(query('update public.business_payment_settings set enabled=enabled where false'),/TABA_RELEASE_QUIESCED/);
  first=await localSession(container,platform);await first.acquire(5000);lifecycle.session=first;
  pass('KILLED_RUNNER_RELEASES_SESSION_LOCK_BUT_DURABLE_QUIESCENCE_SURVIVES');
  const competitor=await localSession(container,platform);
  let stageEntered,continueStage,sourceEntered,continueSource;
  const stageReady=new Promise(resolve=>stageEntered=resolve),stageBlocked=new Promise(resolve=>continueStage=resolve);
  const sourceReady=new Promise(resolve=>sourceEntered=resolve),sourceBlocked=new Promise(resolve=>continueSource=resolve);
  let stageOnce=true,sourceOnce=true;
  state.hooks.stage=async()=>{
    if(stageOnce){stageOnce=false;stageEntered();await stageBlocked;}
    await assert.rejects(competitor.acquire(0),/lock timeout/);
    await assert.rejects(query('update public.mp_seller_connections set status=status where false'),/TABA_RELEASE_QUIESCED/);
    await first.ownership();
  };
  state.hooks.source=async()=>{if(sourceOnce){sourceOnce=false;sourceEntered();await sourceBlocked;}await assert.rejects(competitor.acquire(0),/lock timeout/);};
  state.activateCount=0;
  const deploying=lifecycle.release(id).then(()=>{throw new Error('partial release unexpectedly passed');},error=>error);
  await Promise.race([stageReady,deploying.then(error=>{throw error;})]);
  await assert.rejects(competitor.acquire(0),/lock timeout/);await first.ownership();continueStage();await deploying;
  for(const count of [0,1,2]){
    state.activateCount=count;
    await assert.rejects(lifecycle.release(id));
    await assert.rejects(first.value('select private.verify_a1_a4_release_v5($1,$2,null,null)',[id,JSON.stringify(state.remote)]),/PARTIAL_OR_STALE_REMOTE_RELEASE/);
  }
  assert.equal((await lifecycle.record(id)).phase,'activation_pending');
  await assert.rejects(lifecycle.contract(id));
  await assert.rejects(lifecycle.finish(id,true));
  pass('PARTIAL_RELEASE_RETAINS_QUIESCENCE_AND_DENIES_CONTRACT_ABORT');
  const reserved=(await lifecycle.record(id)).staged;
  state.activateCount=3;
  const recovering=lifecycle.release(id);
  await Promise.race([sourceReady,recovering.then(()=>{throw new Error('verification did not block');})]);
  await assert.rejects(competitor.acquire(0),/lock timeout/);await first.ownership();continueSource();await recovering;
  await competitor.close();
  delete state.hooks.stage;delete state.hooks.source;
  pass('LOCK_REMAINS_OWNED_DURING_BLOCKED_DEPLOYMENT_AND_VERIFICATION');
  assert.deepEqual((await lifecycle.record(id)).staged,reserved);
  pass('PARTIAL_RETRY_REUSES_EXACT_IMMUTABLE_VERSIONS');
  state.staleRuntime=true;
  await assert.rejects(lifecycle.contract(id),/stale runtime response/);
  state.staleRuntime=false;state.wrongRuntimeVersion=true;
  await assert.rejects(lifecycle.contract(id),/runtime version differs/);
  state.wrongRuntimeVersion=false;state.tamperedSource='tampered executable source';
  await assert.rejects(lifecycle.contract(id),/remote executable source differs/);
  state.tamperedSource=null;
  pass('STALE_RUNTIME_WRONG_DEPLOYMENT_ID_AND_TAMPERED_SOURCE_REJECTED');
  await assert.rejects(lifecycle.attest(id),/POST_RELEASE_DRAIN/);
  await assert.rejects(lifecycle.contract(id),/CONTRACT_BINDING/);
  pass('RELEASE_WITHOUT_POST_RELEASE_DRAIN_CANNOT_CONTRACT');
  await query("update private.a1_a4_releases_v5 set verified_at=clock_timestamp()-interval '440 seconds' where id=$1",[id]);
  await lifecycle.attest(id);
  await assert.rejects(first.value('select private.execute_a1_a4_contract_v5($1::uuid,$2)',[id,'f'.repeat(64)]),/CONTRACT_BINDING/);
  await assert.rejects(query('update private.a1_a4_releases_v5 set proof_expires_at=null where id=$1',[id]),/check constraint/);
  await assert.rejects(query('update private.a1_a4_releases_v5 set runtime_proof=null where id=$1',[id]),/check constraint/);
  await query("update private.a1_a4_releases_v5 set last_checked_at=clock_timestamp()-interval '21 minutes',proof_expires_at=clock_timestamp()-interval '1 minute' where id=$1",[id]);
  await assert.rejects(first.value('select private.execute_a1_a4_contract_v5($1::uuid,$2)',[id,context.contract_sha]),/CONTRACT_BINDING/);
  pass('WRONG_CONTRACT_SHA_AND_STALE_PROOF_REJECTED');
  const result=await lifecycle.contract(id);
  assert.equal(result.ok,true);
  await assert.rejects(lifecycle.contract(id),/ALREADY_APPLIED/);
  await lifecycle.verifyContract(id);
  await lifecycle.finish(id);
  assert.equal((await lifecycle.health(id)).healthy,true);
  assert.equal(await value('select paused from private.a1_a4_release_control_v5'),false);
  assert.equal(await value("select count(*)::int from cron.job where active"),4);
  pass('COMPLETE_DURABLE_LIFECYCLE_CONTRACT_ONE_SHOT_AND_RESUME');
} finally { await writer.end();await second.close(); await first.close(); await audit.end(); }
