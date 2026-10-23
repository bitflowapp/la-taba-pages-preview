// F13 (local, mechanical part): dump a database holding in-flight money, restore it into a NEW database without
// touching the original, prove the financial data is identical, and prove that reconciling afterwards neither charges,
// refunds nor books anything twice, and that facts which happened AFTER the backup are detected, not invented.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BIN, HOST, PORT, psqlRaw } from '../../scripts/local-db/lib.mjs';
import { committedFixtureSql, FIXTURE_IDS } from './harness.mjs';

const TEMPLATE = process.env.TABA_LOCAL_DB || 'taba_local_work';
const SRC = `taba_local_rd_src_${process.pid}`;
const DST = `taba_local_rd_dst_${process.pid}`;
const dir = fs.mkdtempSync(path.join(process.env.TMP || os.tmpdir(), 'taba-restore-'));
const dumpFile = path.join(dir, 'src.dump');
const exe = name => path.join(BIN, name + (process.platform === 'win32' ? '.exe' : ''));
after(() => {
  for (const db of [SRC, DST]) psqlRaw('postgres', `drop database if exists ${db} with (force);`, { check: false });
  fs.rmSync(dir, { recursive: true, force: true });
});

const one = (db, sql) => JSON.parse(psqlRaw(db, sql, { tuples: true }).stdout.split('\n').map(s => s.trim()).filter(Boolean).pop());
const B = FIXTURE_IDS.business;
const snap = (id, status, extra = '') => `jsonb_build_object('provider_payment_id','${id}','external_reference',ref,'preference_id','FORENSIC-PREF','merchant_order_id','MO','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','${status}','payment_method','visa','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64))${extra}`;

/** Fingerprint of everything financial and commercial, order-independent and free of volatile columns. */
const FINGERPRINT = `select jsonb_build_object(
  'intents',(select md5(coalesce(string_agg(concat_ws('|',external_reference,internal_status,provider_payment_id,provider_status,paid_amount,refunded_amount,order_id is not null,security_review_reason),',' order by external_reference),'')) from public.payment_intents),
  'payments',(select md5(coalesce(string_agg(concat_ws('|',provider_payment_id,status,is_financing,refunded_amount),',' order by provider_payment_id),'')) from public.payment_provider_payments),
  'refunds',(select md5(coalesce(string_agg(concat_ws('|',provider_refund_id,origin,status,amount),',' order by coalesce(provider_refund_id,id::text)),'')) from public.payment_refunds),
  'jobs',(select md5(coalesce(string_agg(concat_ws('|',topic,status,attempts),',' order by topic,status,attempts,id::text),'')) from public.payment_outbox),
  'discrepancies',(select md5(coalesce(string_agg(concat_ws('|',kind,status,severity,dedupe_key),',' order by dedupe_key),'')) from public.payment_discrepancies),
  'reservations',(select md5(coalesce(string_agg(concat_ws('|',status,quantity,reservation_generation),',' order by status,quantity,reservation_generation,id::text),'')) from public.inventory_reservations),
  'stock',(select md5(coalesce(string_agg(concat_ws('|',id,stock),',' order by id),'')) from public.products),
  'orders',(select count(*) from public.orders),
  'cursor',(select md5(coalesce(string_agg(concat_ws('|',environment,next_offset,window_end is not null),',' order by environment),'')) from public.provider_ledger_cursors))`;

test('seed a database with money in flight (partial and external refunds, an ambiguous refund, queued and failing jobs, an open case, a half-read ledger window)', () => {
  psqlRaw('postgres', `drop database if exists ${SRC} with (force); create database ${SRC} template ${TEMPLATE};`);
  psqlRaw(SRC, committedFixtureSql(2));
  psqlRaw(SRC, `do $$ declare v_i uuid; v_s uuid; ref text; v_key uuid:=gen_random_uuid(); v_refund uuid; v_x jsonb; v_user uuid:='${FIXTURE_IDS.user}'; v_r jsonb; v_p jsonb; v_s2 uuid; v_i2 uuid; ref2 text; v_s3 uuid; v_i3 uuid; ref3 text; begin
    update public.products set stock=100 where id='${FIXTURE_IDS.product}';
    select pi.id, pi.checkout_session_id, pi.external_reference into v_i, v_s, ref from public.payment_intents pi limit 1;
    -- (a) approved, finalized, external 500 + local 250 refunds
    perform public.record_mercadopago_payment_snapshot(v_i, ${snap('991000001', 'approved')},'webhook',null);
    perform public.finalize_paid_checkout_session(v_s);
    commit; -- the order is its own transaction, exactly as in production
    perform public.record_mercadopago_payment_snapshot(v_i, ${snap('991000001', 'approved')} || jsonb_build_object('refunded_amount','500.00','refunds',jsonb_build_array(jsonb_build_object('id','770000001','amount','500.00','status','approved'))),'reconciliation',null);
    insert into public.business_members(business_id,user_id,role,is_active) values('${B}',v_user,'owner',true);
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values(v_key,v_user,'${B}','owner','panel_web');
    perform set_config('request.jwt.claim.sub',v_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated','session_id',v_key,'iat',extract(epoch from clock_timestamp()))::text,true);
    v_x:=public.prepare_payment_refund_v2(v_i,250,v_key,'partial'); v_refund:=(v_x->>'refund_id')::uuid;
    perform public.record_payment_refund_identity(v_refund,v_i,'991000001',v_key,'881000001');
    perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',250,repeat('2',64));
    -- (b) a second purchase, approved but not finalized (process died), with an AMBIGUOUS refund request
    v_r:=public.create_checkout_session(v_user,jsonb_build_object('business_id','${B}','client_request_id','rdcheckout0002','items',jsonb_build_array(jsonb_build_object('product_id','${FIXTURE_IDS.product}','quantity',2)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Restore Two','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago'));
    v_s2:=(v_r->>'checkout_session_id')::uuid; v_p:=public.prepare_mercadopago_preference(v_s2,v_user,false);
    perform public.record_mercadopago_preference_created((v_p->>'payment_attempt_id')::uuid,'RD-PREF-2','https://www.mercadopago.com/checkout/v1/redirect?pref_id=RD','https://s',repeat('e',64),'rd');
    select id, external_reference into v_i2, ref2 from public.payment_intents where checkout_session_id=v_s2;
    perform public.record_mercadopago_payment_snapshot(v_i2, jsonb_build_object('provider_payment_id','991000002','external_reference',ref2,'preference_id','RD-PREF-2','merchant_order_id','MO2','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64)),'webhook',null);
    -- (c) a third purchase waiting on the provider, with a failing queued job and an open case
    v_r:=public.create_checkout_session(v_user,jsonb_build_object('business_id','${B}','client_request_id','rdcheckout0003','items',jsonb_build_array(jsonb_build_object('product_id','${FIXTURE_IDS.product}','quantity',1)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Restore Three','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago'));
    v_s3:=(v_r->>'checkout_session_id')::uuid; v_p:=public.prepare_mercadopago_preference(v_s3,v_user,false);
    perform public.record_mercadopago_preference_created((v_p->>'payment_attempt_id')::uuid,'RD-PREF-3','https://www.mercadopago.com/checkout/v1/redirect?pref_id=RD3','https://s',repeat('e',64),'rd3');
    select id into v_i3 from public.payment_intents where checkout_session_id=v_s3;
    insert into public.payment_outbox(payment_intent_id,topic,status,attempts,next_attempt_at,last_error) values (v_i3,'payment_reconcile','retry_wait',3,clock_timestamp()+interval '10 minutes','provider_503');
    perform private.open_payment_discrepancy('${B}',v_i,v_s,'multiple_approved_payments','critical',false,'991000009','{}'::jsonb,'rd-case-0001');
    insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values('${B}','test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '1 day');
    insert into public.provider_ledger_cursors(business_id,environment,watermark_at,window_begin,window_end,next_offset) values('${B}','test',now()-interval '1 day',now()-interval '3 hours',now(),50);
  end $$;`);
  const state = one(SRC, `select jsonb_build_object('orders',(select count(*) from public.orders),'refunded',(select refunded_amount from public.payment_intents where provider_payment_id='991000001'),'ambiguous_or_open_jobs',(select count(*) from public.payment_outbox where status<>'completed'))`);
  assert.equal(state.orders, 1);
  assert.equal(state.refunded, 750);
});

test('a custom-format dump restores into a NEW database, leaves the original untouched, and every financial fingerprint matches', () => {
  const before = one(SRC, FINGERPRINT);
  const dump = spawnSync(exe('pg_dump'), ['-h', HOST, '-p', String(PORT), '-U', 'postgres', '--format=custom', '--no-owner', '--schema=public', '--schema=private', '--file', dumpFile, SRC], { encoding: 'utf8' });
  assert.equal(dump.status, 0, String(dump.stderr).slice(0, 500));
  psqlRaw('postgres', `drop database if exists ${DST} with (force); create database ${DST};`);
  // The cluster-level pieces a managed platform provides are recreated first (roles, schemas of extensions, stand-ins).
  psqlRaw(DST, fs.readFileSync(path.resolve('scripts/local-db/stubs.sql'), 'utf8'));
  psqlRaw(DST, 'create schema if not exists private;');
  psqlRaw(DST, fs.readFileSync(path.resolve('supabase/tests/fixtures/a1-platform-auth.sql'), 'utf8'));
  // Auth lives in its own platform schema and is restored by the platform: its users must exist before the public data.
  const authDump = spawnSync(exe('pg_dump'), ['-h', HOST, '-p', String(PORT), '-U', 'postgres', '--data-only', '--table=auth.users', '--inserts', SRC], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(authDump.status, 0, String(authDump.stderr).slice(0, 500));
  psqlRaw(DST, authDump.stdout.replace(/^SET .*$/gm, ''));
  const restore = spawnSync(exe('pg_restore'), ['-h', HOST, '-p', String(PORT), '-U', 'postgres', '--no-owner', '-d', DST, dumpFile], { encoding: 'utf8' });
  // Objects that already exist from the stand-ins are expected to be skipped; any other error is a failure.
  const errors = String(restore.stderr).split('\n').filter(l => /error/i.test(l) && !/already exists|errores ignorados|errors ignored/i.test(l));
  assert.deepEqual(errors, [], 'restore errors: ' + errors.slice(0, 3).join(' | '));
  const restored = one(DST, FINGERPRINT);
  assert.deepEqual(restored, before, 'financial and commercial data identical after restore');
  assert.deepEqual(one(SRC, FINGERPRINT), before, 'the original database was not modified by the dump or the restore');
});

test('reconciling the restored database does not book, charge or refund anything twice', () => {
  const before = one(DST, FINGERPRINT);
  psqlRaw(DST, `select public.retry_stuck_paid_checkouts(50); select public.run_financial_integrity_checks(100); select public.expire_checkout_sessions(50);
    update public.payment_intents set updated_at=updated_at;`);
  const mid = one(DST, `select jsonb_build_object('orders',(select count(*) from public.orders),'stock',(select stock from public.products where id='${FIXTURE_IDS.product}'),
    'refunded',(select refunded_amount from public.payment_intents where provider_payment_id='991000001'),
    'live_dup',(select count(*) from (select checkout_session_id,product_id from public.inventory_reservations where status in ('active','converted') group by 1,2 having count(*)>1) x),
    'paid_without_order_cases',(select count(*) from public.payment_discrepancies where kind='paid_without_order' and status<>'resolved'))`);
  assert.equal(mid.refunded, 750, 'refund totals unchanged');
  assert.equal(mid.live_dup, 0);
  assert.ok(mid.orders >= 1 && mid.orders <= 2, 'the purchase that was approved-but-unfinalized at backup time becomes exactly one order');
  // Idempotent: a second pass changes nothing.
  const snapshotAfterFirst = one(DST, FINGERPRINT);
  psqlRaw(DST, `select public.retry_stuck_paid_checkouts(50); select public.run_financial_integrity_checks(100);`);
  const snapshotAfterSecond = one(DST, FINGERPRINT);
  assert.equal(snapshotAfterSecond.orders, snapshotAfterFirst.orders);
  assert.equal(snapshotAfterSecond.stock, snapshotAfterFirst.stock);
  assert.equal(snapshotAfterSecond.refunds, snapshotAfterFirst.refunds);
  assert.notEqual(before.orders, undefined);
});

test('facts that happened AFTER the backup are detected from the provider, never invented: a later external refund is added once, a payment with no local checkout becomes an orphan case', () => {
  // The provider ledger shows a refund of 300 made after the backup, listed with its own id, and a payment we never saw.
  psqlRaw(DST, `do $$ declare v_i uuid; ref text; begin
      select id, external_reference into v_i, ref from public.payment_intents where provider_payment_id='991000001';
      perform public.record_mercadopago_payment_snapshot(v_i, jsonb_build_object('provider_payment_id','991000001','external_reference',ref,'preference_id','FORENSIC-PREF','merchant_order_id','MO','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,'provider_occurred_at',(clock_timestamp()+interval '1 minute')::text,'refunded_amount','1050.00','raw_response_hash',repeat('1',64),
        'refunds',jsonb_build_array(jsonb_build_object('id','770000001','amount','500.00','status','approved'),jsonb_build_object('id','881000001','amount','250.00','status','approved'),jsonb_build_object('id','770000002','amount','300.00','status','approved'))),'reconciliation',null);
      perform public.record_orphan_provider_payment('${B}','test',jsonb_build_object('id','771000777','status','approved','transaction_amount',1800,'currency_id','ARS','external_reference','taba2:checkout:00000000-0000-4000-8000-0000000000cc','collector_id','collector-retry'));
    end $$;`);
  const again = () => psqlRaw(DST, `do $$ declare v_i uuid; ref text; begin select id, external_reference into v_i, ref from public.payment_intents where provider_payment_id='991000001';
      perform public.record_mercadopago_payment_snapshot(v_i, jsonb_build_object('provider_payment_id','991000001','external_reference',ref,'preference_id','FORENSIC-PREF','merchant_order_id','MO','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,'provider_occurred_at',(clock_timestamp()+interval '2 minutes')::text,'refunded_amount','1050.00','raw_response_hash',repeat('1',64),
        'refunds',jsonb_build_array(jsonb_build_object('id','770000001','amount','500.00','status','approved'),jsonb_build_object('id','881000001','amount','250.00','status','approved'),jsonb_build_object('id','770000002','amount','300.00','status','approved'))),'reconciliation',null); end $$;`);
  again(); again();
  const out = one(DST, `select jsonb_build_object('refunded',(select refunded_amount from public.payment_intents where provider_payment_id='991000001'),
    'refund_rows',(select count(*) from public.payment_refunds r join public.payment_intents pi on pi.id=r.payment_intent_id where pi.provider_payment_id='991000001' and r.status='approved'),
    'orphans',(select count(*) from public.payment_discrepancies where kind='orphan_provider_payment' and status<>'resolved'))`);
  assert.equal(out.refunded, 1050, '500 external + 250 local + 300 made after the backup, each counted once');
  assert.equal(out.refund_rows, 3);
  assert.equal(out.orphans, 1);
});
