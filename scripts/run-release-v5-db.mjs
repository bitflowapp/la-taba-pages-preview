// Own cluster, own fixtures, own lifecycle. Never restarts, dumps or changes an
// existing Supabase/Bitflow container. No bind mounts or published ports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { localClient, localSession } from '../tests/fixtures/release-v5-database.mjs';
import { platformFixture } from '../tests/fixtures/release-v5-platform.mjs';
import { localContext, buildSources } from './release-v5/identity.mjs';
import { Lifecycle } from './release-v5/lifecycle.mjs';
import { ROOT, EXPAND } from './release-v5/model.mjs';
import { compatibilitySnapshot, packCompatibility } from './release-v5/compatibility.mjs';

assert.equal(process.env.TABA_LOCAL_PAYMENT_DB,'1','TABA_LOCAL_PAYMENT_DB=1 required');
const container=`taba-a1-a4-local-v5-${process.pid}-${randomUUID().slice(0,8)}`;
const restoreDatabase='taba_v5_restore';
const image='public.ecr.aws/supabase/postgres:17.6.1.166';
const generateIndex=process.argv.indexOf('--generate-compat');
const generateOutput=generateIndex<0?null:process.argv[generateIndex+1];
if(generateIndex>=0)assert.ok(generateOutput,'--generate-compat requires a new output file outside the checkout');
const focused=process.argv.includes('--release-only')||Boolean(generateOutput);
const docker=(args,input)=>execFileSync('docker',args,{cwd:ROOT,input,encoding:input===undefined?'utf8':undefined,maxBuffer:128*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']});
const run=(script,...args)=>{
  const result=execFileSync(process.execPath,['--experimental-vm-modules',script,container,...args],{cwd:ROOT,env:process.env,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe'],windowsHide:true});
  console.log(result.split('\n').filter(line=>/PASS|FAIL_CLOSED|EXACTLY|MIGRATIONS=|REJECTED/.test(line)).join('\n'));
};
let client,releaseSession;
let started=false;
try {
  try {
    docker(['image','inspect',image]);
  } catch {
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        console.log(`Pulling ${image} (attempt ${attempt}/6)...`);
        docker(['pull', image]);
        break;
      } catch (err) {
        if (attempt === 6) throw err;
        const delay = attempt * 5000;
        console.warn(`Docker pull failed. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  docker(['run','-d','--name',container,'--network','none','--user','postgres',
    '--tmpfs','/var/lib/postgresql/data:rw,size=1024m,uid=100,gid=101','--tmpfs','/tmp:rw,size=128m',
    '--tmpfs','/etc/postgresql-custom:rw,size=1m,uid=100,gid=101',
    '--entrypoint','/bin/sh',image,'-c',
    'initdb -D /var/lib/postgresql/data/db -U supabase_admin -A trust >/tmp/init.log && postgres -D /var/lib/postgresql/data/db -k /tmp -c listen_addresses=127.0.0.1 -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/lib/postgresql/bin/pgsodium_getkey.sh -c cron.database_name=postgres -c cron.launch_active_jobs=off']);
  started=true;
  for(let attempt=0;;attempt++){
    try {docker(['exec',container,'pg_isready','-h','/tmp','-U','supabase_admin']);break;}
    catch(error){if(attempt===100)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
  }
  docker(['exec',container,'psql','-h','/tmp','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c','create role postgres login superuser createdb createrole']);
  // pg_cron's C routines temporarily use the EXTENSION owner. Merely changing
  // cron.job/function owners is not an accurate managed-platform fixture.
  docker(['exec',container,'psql','-h','/tmp','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1','-c',
    'create extension pg_cron with schema pg_catalog; grant usage on schema cron to postgres; grant select on cron.job to postgres; grant execute on all functions in schema cron to postgres']);
  run('scripts/bootstrap-a1-v2-local.mjs');
  if(!focused){
  run('scripts/verify-a1-v2-independent.mjs');
  run('scripts/verify-a1-a4-v3-legacy-refund.mjs');
  run('scripts/verify-a1-v2-independent.mjs','--current-contract');
  run('scripts/verify-a1-v2-locks.mjs');
  }
  client=await localClient(container);
  const query=(sql,args=[])=>client.query(sql,args);
  const snapshotSession={value:async(sql,args)=>Object.values((await query(sql,args)).rows[0])[0]};
  const stages=generateOutput?[await compatibilitySnapshot(snapshotSession)]:[];
  if(focused)for(const name of EXPAND.slice(0,3)){
    await query(fs.readFileSync(path.join(ROOT,'supabase/migrations',name),'utf8'));
    if(generateOutput)stages.push(await compatibilitySnapshot(snapshotSession));
  }
  const clear=async()=>query(`begin; set local session_replication_role=replica;
    truncate public.checkout_sessions,public.payment_intents,public.payment_outbox,public.payment_refunds,
      public.payment_cancellations,public.payment_disputes,public.payment_webhook_receipts,public.payment_events cascade;
    update public.business_payment_settings set enabled=false;
    update public.mp_seller_connections set status='disconnected',protected_tokens=null,refresh_owner=null,refresh_started_at=null;
    delete from public.mp_oauth_states; commit;`);
  await clear();
  await query("select vault.create_secret('fixture-worker-hmac-only-for-local-tests','taba_payment_worker_hmac_secret'); select vault.create_secret('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-payment-worker','taba_payment_worker_url')");
  await query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  for(const name of fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(v=>v.endsWith('.sql')&&v<'20260909050330').sort())
    await query('insert into supabase_migrations.schema_migrations(version,statements) values($1,$2)',[name.slice(0,14),[fs.readFileSync(path.join(ROOT,'supabase/migrations',name),'utf8')]]);
  // Match the managed platform: postgres is NOT a superuser; cron.job is owned
  // by supabase_admin and postgres has SELECT only. pg_net's extension grants
  // queue privileges (including TRIGGER) to PUBLIC, as verified read-only.
  await query(`alter database postgres owner to postgres;
    alter table cron.job owner to supabase_admin;
    revoke all on cron.job from postgres; grant select on cron.job to postgres;
    alter function cron.alter_job(bigint,text,text,text,text,boolean) owner to supabase_admin;
    grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to postgres;
    alter table net.http_request_queue owner to supabase_admin;
    alter table net._http_response owner to supabase_admin;
    grant set on parameter session_replication_role to postgres;
    grant anon, authenticated, service_role to postgres with admin option;
    alter role postgres nosuperuser bypassrls createdb createrole;`);
  if(generateOutput){
    const output=path.resolve(generateOutput),relative=path.relative(ROOT,output);
    assert.ok(relative.startsWith('..'+path.sep)||path.isAbsolute(relative));
    await query(fs.readFileSync(path.join(ROOT,'supabase/migrations',EXPAND[3]),'utf8'));
    stages.push(await compatibilitySnapshot(snapshotSession));
    const contractBody=fs.readFileSync(path.join(ROOT,'supabase/migrations',EXPAND[2]),'utf8');
    const retired=[...contractBody.matchAll(/execute \$ddl\$([\s\S]*?)\$ddl\$/g)];assert.equal(retired.length,6);
    // Oracle generation executes the reviewed retirement DDL in this isolated
    // empty database, never fabricating production release evidence.
    for(const match of retired)await query(match[1]);
    fs.writeFileSync(output,JSON.stringify(packCompatibility(stages,await compatibilitySnapshot(snapshotSession)),null,2)+'\n',{flag:'wx'});
    console.log('INDEPENDENT_COMPATIBILITY_ORACLE_GENERATED: '+output);
  } else {
  const {platform}=platformFixture(async(sql,args)=>(await query(sql,args)).rows);
  releaseSession=await localSession(container,platform);await releaseSession.acquire(0);
  const lifecycle=new Lifecycle({session:releaseSession,platform,context:localContext(ROOT,{requireClean:false}),built:await buildSources()});
  await lifecycle.expand();
  await releaseSession.close();releaseSession=null;
  console.log('ACTUAL_EXPAND_ENTRYPOINT_ON_NON_SUPERUSER_POSTGRES: PASS');
  if(!focused){
    run('scripts/verify-a1-v2-independent.mjs','--expanded-v5');
    run('scripts/verify-a1-a4-v3-legacy-refund.mjs');
  }
  await clear();
  run('scripts/verify-release-v5-local.mjs');
  if(!focused){
    run('scripts/verify-a1-v2-independent.mjs','--current-contract');
    run('scripts/verify-a1-v2-independent.mjs','--retired-contract');
  }
  let assertions=0;
  if(!focused){
    const posteriores=fs.readdirSync(path.join(ROOT,'supabase/migrations'))
      .filter(v=>v.endsWith('.sql')&&v.slice(0,14)>'20260909050330').sort();
    for(const name of posteriores)
      await query(fs.readFileSync(path.join(ROOT,'supabase/migrations',name),'utf8'));
    console.log('POST_INTERLOCK_MIGRATIONS='+posteriores.length);
    const canonicalTests=['business_windows_scanner_fiscal_test.sql','mercadopago_seller_oauth.local.sql',
      'mercadopago_clean_business.local.sql','fiscal_document_closure_test.sql','production_operations_control_plane_test.sql',
      'durable_offline_packing_test.sql','public_tracking_gps_quality_test.sql','business_timezone_windows_test.sql',
      'horario_24x7_test.sql','alta_propuesta_comercial_test.sql','production_least_privilege_test.sql',
      'business_self_delivery_test.sql','controlled_production_qa_window_test.sql',
      'mercadopago_availability_requires_seller.local.sql','payment_method_isolation.local.sql',
      'mercadopago_seller_cannot_charge_alert.local.sql','mercadopago_operator_switch.local.sql'];
    for(const name of canonicalTests){
      const output=docker(['exec','-i',container,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],
        Buffer.from('set search_path=public,extensions;\n'+fs.readFileSync(path.join(ROOT,'supabase/tests',name),'utf8'))).toString();
      assert.doesNotMatch(output,/^not ok\b/m,name);assert.match(output,/^1\.\.[0-9]+$/m,name);
      assertions+=Number(/^1\.\.([0-9]+)$/m.exec(output)[1]);
    }
    assert.equal(assertions,420);
    console.log('CANONICAL_PGTAP: 250 + 44 least-privilege + 50 reparto-propio + 37 ventana QA/columnas privadas/pausa + 9 Mercado Pago sólo con vendedor conectado + 5 aislamiento cobro manual/Mercado Pago + 9 alerta de vendedor que no puede cobrar + 16 interruptor de operador por negocio assertions PASS');

    // Drill the exact compensating rollback in the same isolated schema where
    // the forward migration and its pgTAP contract just passed. The first run
    // proves it refuses to remove the delivery-code RPC while a self-delivery
    // is in flight. The second proves the clean rollback restores the previous
    // function, preserves durable evidence and does not rewrite migration
    // history. Both are wrapped in transactions and leave the forward schema
    // in place for the dump/restore drill below.
    const rollbackSql=fs.readFileSync(path.join(
      ROOT,'docs/migrations/rollback/20260919120000_business_self_delivery_and_finished_today.rollback.sql'
    ),'utf8');
    await query('begin');
    await query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
      values('e6000000-0000-4000-8000-000000000001','ROLLBACK DRILL','open','rollback-drill',true,'America/Argentina/Buenos_Aires');
      insert into public.orders(
        id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
        client_request_id,customer_name,customer_neighborhood,customer_street_address,
        customer_phone,payment_method,subtotal,delivery_fee,total
      ) values(
        'e6000000-0000-4000-8000-000000000002','e6000000-0000-4000-8000-000000000001',
        'ROLLBACK-DRILL','ROLLBACK-DRILL','on_the_way','delivery','delivery',
        'rollback-drill-order','ROLLBACK DRILL','Centro','Mendoza 1','+540000000000','cash',1000,0,1000
      )`);
    await assert.rejects(query(rollbackSql),/ROLLBACK_BLOCKED/);
    await query('rollback');

    const durableTables=['order_events','order_delivery_handoffs','delivery_confirmation_attempts',
      'business_command_receipts','mp_seller_connections'];
    const durableCounts=Object.fromEntries(await Promise.all(durableTables.map(async table=>[
      table,Number((await query(`select count(*)::integer as n from public.${table}`)).rows[0].n),
    ])));
    await query('begin');
    await query(`insert into supabase_migrations.schema_migrations(version,name,statements)
      values('20260919120000','business_self_delivery_and_finished_today',array['ROLLBACK_DRILL'])
      on conflict (version) do nothing`);
    const historyBefore=Number((await query('select count(*)::integer as n from supabase_migrations.schema_migrations')).rows[0].n);
    await query(rollbackSql);
    for(const signature of [
      'public.record_business_self_delivery()',
      'public.prevent_business_delivery_over_rider()',
      'public.confirm_business_delivery_code(uuid,bigint,text,text)',
      'public.get_business_finished_today(uuid,text)',
      'public.get_business_finished_today(uuid,text,date)',
    ]) assert.equal((await query('select to_regprocedure($1) as oid',[signature])).rows[0].oid,null,signature);
    const previousDefinition=(await query(
      "select pg_get_functiondef('public.change_order_status(uuid,text,text)'::regprocedure) as definition"
    )).rows[0].definition;
    assert.equal(createHash('sha256').update(previousDefinition).digest('hex'),
      '16547d986eebd2a056da6ab4f5de6918c52ba4a262d0014b107eaa7448f8894a');
    assert.equal(Number((await query('select count(*)::integer as n from supabase_migrations.schema_migrations')).rows[0].n),historyBefore);
    for(const [table,before] of Object.entries(durableCounts))
      assert.equal(Number((await query(`select count(*)::integer as n from public.${table}`)).rows[0].n),before,table);
    assert.equal((await query(
      "select has_function_privilege('anon','public.change_order_status(uuid,text,text)','EXECUTE') as allowed"
    )).rows[0].allowed,false);
    assert.equal((await query(
      "select has_function_privilege('authenticated','public.change_order_status(uuid,text,text)','EXECUTE') as allowed"
    )).rows[0].allowed,false);
    assert.equal((await query(
      "select has_function_privilege('service_role','public.change_order_status(uuid,text,text)','EXECUTE') as allowed"
    )).rows[0].allowed,true);
    await query('rollback');
    console.log('BUSINESS_SELF_DELIVERY_ROLLBACK_DRILL: PASS');
  } else {
    console.log('FOCUSED_RELEASE_RUN: historical matrix and canonical pgTAP NOT RUN');
  }
  // Restore schema + synthetic state, including durable consumed evidence.
  // Platform extensions are deliberately excluded, as in the original drill.
  // A restored release must fail closed until its platform schema is verified.
  await query("create schema restore_drill; create table restore_drill.evidence(marker text); insert into restore_drill.evidence values('TABA2_SYNTHETIC_RESTORE_DRILL_V1')");
  const summarySql=`select jsonb_build_object('tables',(select count(*) from pg_catalog.pg_tables where schemaname='public'),
    'functions',(select count(*) from pg_proc where pronamespace='public'::regnamespace),
    'marker',(select marker from restore_drill.evidence),
    'contracts',(select count(*) from private.deployment_contract_executions),
    'consumed',(select count(*) from private.deployment_drain_attestations where status='consumed'),
    'release',(select verified_remote from private.a1_a4_releases_v5 where phase='resumed'))`;
  const sourceSummary=(await query(summarySql)).rows[0].jsonb_build_object;
  const start=Date.now();
  const archive=docker(['exec',container,'pg_dump','-h','/tmp','-U','postgres','-d','postgres','--format=custom','--no-owner','--no-privileges',
    '--exclude-extension=pg_cron','--exclude-schema=cron','--exclude-extension=pg_net','--exclude-schema=net','--exclude-extension=supabase_vault','--exclude-schema=vault'],Buffer.alloc(0));
  const dumpSha256=createHash('sha256').update(archive).digest('hex');
  docker(['exec',container,'createdb','-h','/tmp','-U','supabase_admin',restoreDatabase]);
  docker(['exec','-i',container,'pg_restore','-h','/tmp','-U','supabase_admin','-d',restoreDatabase,'--no-owner','--no-privileges','--exit-on-error'],archive);
  const restoredSummary=JSON.parse(docker(['exec',container,'psql','-h','/tmp','-U','supabase_admin','-d',restoreDatabase,'-X','-qAt','-c',summarySql]));
  assert.deepEqual(restoredSummary,sourceSummary);
  const failClosed=spawnSync('docker',['exec',container,'psql','-h','/tmp','-U','supabase_admin','-d',restoreDatabase,'-X','-qAt','-v','ON_ERROR_STOP=1','-c','select private.a1_a4_inert_snapshot_v5()'],{encoding:'utf8',windowsHide:true});
  assert.notEqual(failClosed.status,0,'platform-incomplete restore must not authorize release');
  const report={productionDataUsed:false,focused,migrationsApplied:fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(v=>v.endsWith('.sql')).length,canonicalPgTap:assertions,dumpSha256,restoreDurationMs:Date.now()-start,passed:true,sourceSummary,restoredSummary};
  if(process.env.TABA_RESTORE_DRILL_REPORT){
    const output=path.resolve(process.env.TABA_RESTORE_DRILL_REPORT);fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
  console.log('DUMP_RESTORE_DURABLE_EVIDENCE_AND_FAIL_CLOSED_PLATFORM_GATE: PASS');
  }
} finally {
  await releaseSession?.close();await client?.end();
  if(started){
    const inspected=JSON.parse(docker(['inspect',container]))[0];
    assert.equal(inspected.Name,'/'+container);assert.equal(inspected.HostConfig.NetworkMode,'none');
    docker(['rm','-f',container]);
  }
}
