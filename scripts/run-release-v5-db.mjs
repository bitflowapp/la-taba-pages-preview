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
// La misma imagen, byte por byte: se baja POR DIGEST y se etiqueta con el nombre
// canónico. GHCR primero (Supabase la espeja ahí y desde GitHub Actions no tiene
// el tope de datos anónimos de ECR Public, que cortó corridas con
// «toomanyrequests: Data limit exceeded»); ECR como respaldo.
const imageDigest='sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86';
const imageSources=[`ghcr.io/supabase/postgres@${imageDigest}`,`public.ecr.aws/supabase/postgres@${imageDigest}`];
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
    let pulled=null;
    for (let attempt = 1; attempt <= 6 && !pulled; attempt++) {
      for (const source of imageSources) {
        try {
          console.log(`Pulling ${source} (attempt ${attempt}/6)...`);
          docker(['pull', source]);
          pulled=source;
          break;
        } catch (err) {
          console.warn(`Docker pull failed for ${source}: ${String(err.stderr||err.message).trim().split(/\r?\n/).pop()}`);
        }
      }
      if (!pulled) {
        if (attempt === 6) throw Error('POSTGRES_IMAGE_UNAVAILABLE_FROM_ALL_SOURCES');
        const delay = attempt * 5000;
        console.warn(`Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    docker(['tag', pulled, image]);
    const repoDigests=docker(['image','inspect','--format','{{json .RepoDigests}}',image]);
    assert.ok(repoDigests.includes(imageDigest),'POSTGRES_IMAGE_DIGEST_MISMATCH');
    console.log(`POSTGRES_IMAGE: ${image} <- ${pulled}`);
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
    let legacyFiscalRows=false;
    // La línea fiscal (20260928180000…180800) se revierte con un archivo generado comparando dos
    // bases reales. Se prueba acá, sobre el esquema sin línea fiscal y sin filas fiscales, en una
    // transacción que se deshace: aplicarla, revertirla (huella IGUAL a la de antes) y volver a
    // aplicarla (huella IGUAL a la de después). Recién después se cargan las filas legadas.
    const FINGERPRINT_SQL=fs.readFileSync(path.join(ROOT,'scripts/controlled-production/schema-fingerprint.sql'),'utf8');
    const schemaFingerprint=async()=>Object.fromEntries((await query(FINGERPRINT_SQL)).rows.map(r=>[r.cat,r]));
    // Si difiere, dice QUÉ difiere: categoría y objeto, para arreglarlo sin adivinar.
    const sameFingerprint=(actual,expected,label)=>{
      const cats=Object.keys(expected).filter(cat=>actual[cat]?.hash!==expected[cat].hash);
      const items=cats.flatMap(cat=>{
        const a=actual[cat]?.items||{};const e=expected[cat].items;
        return [...new Set([...Object.keys(a),...Object.keys(e)])].filter(k=>a[k]!==e[k]).map(k=>`${cat}:${k}`);
      });
      assert.deepEqual(items,[],label);
    };
    const fiscalLine=posteriores.filter(v=>/^2026092818[0-9]{4}_/.test(v));
    const fiscalRollback=fs.readFileSync(path.join(ROOT,
      'docs/migrations/rollback/20260928180000_fiscal_core_line.rollback.sql'),'utf8')
      .replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    assert.equal(fiscalLine.length,9,'la línea fiscal son nueve migraciones');
    for(const name of posteriores){
      // Filas fiscales como las pudo dejar el worker anterior, cargadas justo antes de adoptar el
      // core fiscal (la primera migracion *_fiscal_core_*), sobre el esquema que tenga main en ese
      // momento: fiscal_core_upgrade_test.sql verifica que la adopcion no pierde ni rompe nada.
      if(!legacyFiscalRows&&name.includes('_fiscal_core_')){
        assert.equal(name,fiscalLine[0],'el core fiscal empieza la línea fiscal');
        const beforeFiscal=await schemaFingerprint();
        await query('begin');
        for(const line of fiscalLine) await query(fs.readFileSync(path.join(ROOT,'supabase/migrations',line),'utf8'));
        const withFiscal=await schemaFingerprint();
        await query(fiscalRollback);
        sameFingerprint(await schemaFingerprint(),beforeFiscal,'FISCAL_LINE_ROLLBACK');
        for(const line of fiscalLine) await query(fs.readFileSync(path.join(ROOT,'supabase/migrations',line),'utf8'));
        sameFingerprint(await schemaFingerprint(),withFiscal,'FISCAL_LINE_REFORWARD');
        await query('rollback');
        console.log('FISCAL_LINE_ROLLBACK_DRILL: PASS');
        await query(fs.readFileSync(path.join(ROOT,'supabase/tests/fixtures/fiscal_core_legacy_rows.sql'),'utf8'));
        legacyFiscalRows=true;
        console.log('FISCAL_LEGACY_ROWS_BEFORE_CORE_ADOPTION: LOADED');
      }
      await query(fs.readFileSync(path.join(ROOT,'supabase/migrations',name),'utf8'));
    }
    assert.ok(legacyFiscalRows,'la adopcion del core fiscal tiene que correr sobre filas legadas');
    console.log('POST_INTERLOCK_MIGRATIONS='+posteriores.length);
    const canonicalTests=['business_windows_scanner_fiscal_test.sql','mercadopago_seller_oauth.local.sql',
      'mercadopago_clean_business.local.sql','fiscal_document_closure_test.sql','production_operations_control_plane_test.sql',
      'durable_offline_packing_test.sql','public_tracking_gps_quality_test.sql','business_timezone_windows_test.sql',
      'horario_24x7_test.sql','alta_propuesta_comercial_test.sql','production_least_privilege_test.sql',
      'business_self_delivery_test.sql','controlled_production_qa_window_test.sql',
      'mercadopago_availability_requires_seller.local.sql','payment_method_isolation.local.sql',
      'mercadopago_seller_cannot_charge_alert.local.sql','mercadopago_operator_switch.local.sql',
      'local_print_agent_test.sql','catalog_image_storage_test.sql','store_opening_readiness_test.sql',
      'commercial_publish_merchant_intent_test.sql','identity_alcohol_null_safe_test.sql',
      'fiscal_core_contract_test.sql','fiscal_core_upgrade_test.sql','fiscal_receiver_vat_condition_test.sql',
      'commercial_order_fiscal_test.sql','fiscal_disaster_recovery_test.sql','fiscal_secret_boundary_test.sql',
      'fiscal_refund_separation_test.sql','owner_handover_test.sql','caja_clara_pos_integration_test.sql'];
    for(const name of canonicalTests){
      const output=docker(['exec','-i',container,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],
        Buffer.from('set search_path=public,extensions;\n'+fs.readFileSync(path.join(ROOT,'supabase/tests',name),'utf8'))).toString();
      assert.doesNotMatch(output,/^not ok\b/m,name);assert.match(output,/^1\.\.[0-9]+$/m,name);
      assertions+=Number(/^1\.\.([0-9]+)$/m.exec(output)[1]);
    }
    assert.equal(assertions,924);
    console.log('CANONICAL_PGTAP: 268 + 44 least-privilege + 50 reparto-propio + 37 ventana QA/columnas privadas/pausa + 9 Mercado Pago sólo con vendedor conectado + 5 aislamiento cobro manual/Mercado Pago + 9 alerta de vendedor que no puede cobrar + 16 interruptor de operador por negocio + 104 impresión del mostrador + 19 pipeline de imágenes + 84 preparar la apertura + 24 primera publicación de un borrador de CP + 12 invariantes a prueba de NULL + 55 contrato del core fiscal + 24 upgrade fiscal + 14 RG 5616 + 54 pedidos online V2 + 21 recuperación ante desastre fiscal + 7 frontera de secretos fiscales + 2 reembolso no es nota de crédito + 12 traspaso de dueño + 54 Caja Clara como terminal del local assertions PASS');

    // pgTAP no puede probar dos agentes reclamando a la vez: una conexión por llamada.
    const { runPrintClaimRace } = await import('./print-agent/claim-race.mjs');
    await runPrintClaimRace(() => localClient(container));
    // Ni pgTAP puede probar el Panel, el celular, WhatsApp y una automatizacion pidiendo la misma factura a la vez.
    const { runFiscalIntentRace } = await import('./fiscal-core/intent-race.mjs');
    await runFiscalIntentRace(() => localClient(container));
    // Lo mismo para un pedido online: 10/50/100 pedidos por canal, un comprobante, ninguna venta POS.
    const { runOrderIntentRace } = await import('./fiscal-core/order-intent-race.mjs');
    await runOrderIntentRace(() => localClient(container));

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

    // 20260928150000: el rollback compensatorio retira las RPC de la apertura y
    // devuelve las dos funciones que reemplaza a su definición anterior, byte
    // por byte. Corre adentro de una transacción que se deshace: el esquema
    // queda hacia adelante para el volcado y la restauración de abajo.
    const openingRollback=fs.readFileSync(path.join(
      ROOT,'docs/migrations/rollback/20260928150000_store_opening_readiness.rollback.sql'
    ),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    await query('begin');
    await query(openingRollback);
    for(const signature of [
      'public.get_store_opening_readiness(uuid,integer)',
      'public.platform_verify_business_ordering(uuid,text,text,integer,text)',
      'public.platform_revoke_business_ordering(uuid,text,text,text)',
      'public.set_business_fulfillment(uuid,boolean,boolean)',
      'public.set_business_opening_hours(uuid,jsonb)',
      'public.set_business_address(uuid,text)',
      'public.team_invitation_lookup(text)',
      'public.team_invitation_record_activation(text,uuid,boolean)',
    ]) assert.equal((await query('select to_regprocedure($1) as oid',[signature])).rows[0].oid,null,signature);
    for(const [signature,previousSha256] of [
      ['public.set_business_open_state(uuid,text)','420233317694836322cc267d6769228ff643d04a4f87d5b115bc1332ccbcf366'],
      ['public.apply_commercial_catalog_batch(uuid,jsonb)','51e07f01493fb96fae1ac69f2f2655228354e4544c0391257d86c4e8af53bb5e'],
      ['public.get_business_operations_config(uuid)','0beaa102bb721e85f75102c5f1bb20e5406bfceb22c4809f0e8a03e0b2c35f01'],
    ]){
      const definition=(await query('select pg_get_functiondef($1::regprocedure) as definition',[signature])).rows[0].definition;
      assert.equal(createHash('sha256').update(definition).digest('hex'),previousSha256,signature);
    }
    assert.equal(Number((await query(
      "select count(*)::integer as n from pg_policies where schemaname='storage' and policyname='team_apps_owner_admin_read'"
    )).rows[0].n),0,'team_apps_owner_admin_read');
    await query('rollback');
    console.log('STORE_OPENING_ROLLBACK_DRILL: PASS');

    // 20260928160000: el rollback devuelve la planilla al cuerpo de
    // 20260928150000, byte por byte, sin tocar filas.
    const intentRollback=fs.readFileSync(path.join(
      ROOT,'docs/migrations/rollback/20260928160000_publish_sets_merchant_intent.rollback.sql'
    ),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    await query('begin');
    const productsBefore=Number((await query('select count(*)::integer as n from public.products')).rows[0].n);
    await query(intentRollback);
    const restoredBatch=(await query(
      "select pg_get_functiondef('public.apply_commercial_catalog_batch(uuid,jsonb)'::regprocedure) as definition"
    )).rows[0].definition;
    assert.equal(createHash('sha256').update(restoredBatch).digest('hex'),
      'f5a5754667c1347c335e16062aeb51117fc5d2ac64c32fc18bacdda7895c749f','apply_commercial_catalog_batch');
    assert.equal(Number((await query('select count(*)::integer as n from public.products')).rows[0].n),productsBefore);
    await query('rollback');
    console.log('MERCHANT_INTENT_ROLLBACK_DRILL: PASS');

    // 20260928170000: el rollback devuelve las dos restricciones a su texto
    // anterior (el que tenía CP) y se niega si una aceptación ya perdió su cuenta.
    const nullSafeRollback=fs.readFileSync(path.join(
      ROOT,'docs/migrations/rollback/20260928170000_identity_and_alcohol_invariants_null_safe.rollback.sql'
    ),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
    const constraintDef=async name=>(await query(
      'select pg_get_constraintdef(oid) as def from pg_constraint where conname=$1',[name])).rows[0].def;
    await query('begin');
    await query(nullSafeRollback);
    assert.equal(await constraintDef('identity_invitations_acceptance_is_complete'),
      'CHECK (((accepted_at IS NULL) = (accepted_user_id IS NULL)))');
    assert.equal(await constraintDef('businesses_alcohol_policy_complete'),
      "CHECK (((NOT alcohol_sales_enabled) OR (((alcohol_minimum_age >= 18) AND (alcohol_minimum_age <= 99)) AND (alcohol_sales_start IS NOT NULL) AND (alcohol_sales_end IS NOT NULL) AND (alcohol_timezone IS NOT NULL) AND (btrim(alcohol_timezone) <> ''::text))))");
    await query('rollback');
    await query('begin');
    await query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('e6000000-0000-4000-8000-0000000000a7','authenticated','authenticated','drill@null-safe.invalid','',now(),'{}','{}',now(),now());
      insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
      values('e6000000-0000-4000-8000-0000000000b7','NULL SAFE DRILL','closed','null-safe-drill',true,'America/Argentina/Buenos_Aires');
      insert into public.identity_invitations(business_id,invited_email,invited_role,full_name,token_hash,expires_at,accepted_at,accepted_user_id)
      values('e6000000-0000-4000-8000-0000000000b7','drill@null-safe.invalid','rider','Drill',repeat('e',64),now()+interval '1 day',now(),
        'e6000000-0000-4000-8000-0000000000a7');
      delete from auth.users where id='e6000000-0000-4000-8000-0000000000a7'`);
    await assert.rejects(query(nullSafeRollback),/ROLLBACK_BLOCKED/);
    await query('rollback');
    console.log('NULL_SAFE_INVARIANTS_ROLLBACK_DRILL: PASS');

    // Con filas fiscales (las legadas del arnés), la reversión de la línea fiscal se niega:
    // un registro fiscal no se borra.
    await query('begin');
    await assert.rejects(query(fiscalRollback),/ROLLBACK_BLOCKED/);
    await query('rollback');
    console.log('FISCAL_LINE_ROLLBACK_REFUSES_WITH_FISCAL_ROWS: PASS');
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
