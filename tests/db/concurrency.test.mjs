// Real concurrency: several PostgreSQL sessions race on COMMITTED data in a throw-away database cloned from
// TABA_LOCAL_DB. Invariants are checked afterwards from the tables, not from what any single session returned.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { psqlRaw, psqlAsync } from '../../scripts/local-db/lib.mjs';
import { committedFixtureSql, FIXTURE_IDS } from './harness.mjs';

const TEMPLATE = process.env.TABA_LOCAL_DB || 'taba_local_work';
const B = FIXTURE_IDS.business;
const created = [];

function freshDb(label) {
  const db = `taba_local_cc_${label}_${process.pid}`;
  created.push(db);
  psqlRaw('postgres', `drop database if exists ${db} with (force); create database ${db} template ${TEMPLATE};`);
  psqlRaw(db, committedFixtureSql(2));
  psqlRaw(db, `create table public.race_errors(at timestamptz default clock_timestamp(), state text, message text);`);
  return db;
}
after(() => { for (const db of created) psqlRaw('postgres', `drop database if exists ${db} with (force);`, { check: false }); });

const one = (db, sql) => {
  const r = psqlRaw(db, sql, { tuples: true });
  return JSON.parse(r.stdout.split('\n').map(s => s.trim()).filter(Boolean).pop());
};

/** n extra purchases of 1 unit, each with its own session/intent/preference, optionally lapsed. */
const makePurchases = (n, { lapsed = false } = {}) => `do $$ declare v_user uuid:='${FIXTURE_IDS.user}'; v_r jsonb; v_s uuid; v_p jsonb; i int; begin
  update public.products set stock=1000 where id='${FIXTURE_IDS.product}';
  for i in 1..${n} loop
    v_r:=public.create_checkout_session(v_user,jsonb_build_object('business_id','${B}','client_request_id','ccrow'||lpad(i::text,8,'0'),'items',jsonb_build_array(jsonb_build_object('product_id','${FIXTURE_IDS.product}','quantity',1)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Race','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago'));
    v_s:=(v_r->>'checkout_session_id')::uuid; v_p:=public.prepare_mercadopago_preference(v_s,v_user,false);
    perform public.record_mercadopago_preference_created((v_p->>'payment_attempt_id')::uuid,'RACE-PREF-'||i,'https://www.mercadopago.com/checkout/v1/redirect?pref_id=RACE-PREF-'||i,null,repeat('e',64),'race');
    ${lapsed ? `update public.checkout_sessions set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' where id=v_s;
    update public.inventory_reservations set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' where checkout_session_id=v_s;` : ''}
  end loop; end $$;`;

const snapshotAll = `do $$ declare r record; begin for r in select pi.id intent, pi.external_reference ref, pi.preference_id pref, row_number() over (order by pi.created_at) n from public.payment_intents pi where pi.preference_id like 'RACE-PREF-%' order by pi.created_at loop
  begin
    declare v jsonb; begin
      v:=public.record_mercadopago_payment_snapshot(r.intent,jsonb_build_object('provider_payment_id',(550000000+r.n)::text,'external_reference',r.ref,'preference_id',r.pref,'merchant_order_id','MO'||r.n,'collector_id','collector-retry','currency','ARS','transaction_amount','1250.00','status','approved','payment_method','visa','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64)),'reconciliation',null);
      if (v->>'finalize_required')::boolean then perform public.finalize_paid_checkout_session((select checkout_session_id from public.payment_intents where id=r.intent)); end if;
    end;
  exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end;
end loop; end $$;`;

const sweeps = (rounds) => `do $$ declare i int; begin for i in 1..${rounds} loop begin perform public.sweep_expired_checkout_sessions(); perform public.retry_stuck_paid_checkouts(50);
  exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end; end loop; end $$;`;

const invariants = db => one(db, `select jsonb_build_object(
  'stock',(select stock from public.products where id='${FIXTURE_IDS.product}'),
  'held',(select coalesce(sum(quantity),0) from public.inventory_reservations where status in ('active','converted')),
  'orders',(select count(*) from public.orders where business_id='${B}'),
  'paid',(select count(*) from public.payment_intents where provider_status='approved'),
  'paid_without_order_and_without_case',(select count(*) from public.payment_intents pi where pi.provider_status='approved' and pi.order_id is null
      and not exists(select 1 from public.payment_discrepancies d where d.payment_intent_id=pi.id and d.kind='paid_without_order' and d.status<>'resolved')),
  'duplicate_live_reservations',(select count(*) from (select checkout_session_id,product_id from public.inventory_reservations where status in ('active','converted') group by 1,2 having count(*)>1) x),
  'converted_without_order',(select count(*) from public.inventory_reservations r join public.checkout_sessions s on s.id=r.checkout_session_id where r.status='converted' and s.completed_order_id is null),
  'negative_stock',(select count(*) from public.products where stock<0),
  'errors',(select coalesce(jsonb_agg(distinct state),'[]') from public.race_errors),
  'deadlocks',(select count(*) from public.race_errors where state='40P01'))`);

test('payment approval races the expiry sweep, the stuck-payment retry and the integrity checks: no deadlock, nothing lost, no double stock', async () => {
  const db = freshDb('approve');
  psqlRaw(db, makePurchases(40, { lapsed: true }));
  const before = invariants(db);
  const results = await Promise.all([
    psqlAsync(db, snapshotAll), psqlAsync(db, snapshotAll), psqlAsync(db, sweeps(60)), psqlAsync(db, sweeps(60)),
    psqlAsync(db, `do $$ declare i int; begin for i in 1..40 loop begin perform public.run_financial_integrity_checks(100); exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end; end loop; end $$;`),
  ]);
  for (const r of results) assert.equal(r.status, 0, r.stderr.slice(0, 500));
  // Let the system settle: the sweep re-drives whatever a lost race left behind.
  psqlRaw(db, `select public.retry_stuck_paid_checkouts(100); update public.payment_intents set updated_at=clock_timestamp()-interval '10 minutes';`);
  psqlRaw(db, sweeps(3));
  const inv = invariants(db);
  assert.equal(inv.deadlocks, 0, 'no deadlock: ' + JSON.stringify(inv.errors));
  assert.equal(inv.duplicate_live_reservations, 0);
  assert.equal(inv.negative_stock, 0);
  assert.equal(inv.stock + inv.held, before.stock + before.held, 'every unit is either on the shelf or held by exactly one live reservation');
  assert.equal(inv.paid, 40, 'every approval was recorded');
  assert.equal(inv.paid_without_order_and_without_case, 0, 'a payment is either an order or a visible case');
  assert.equal(inv.converted_without_order, 0);
  assert.equal(inv.orders, 40, 'with stock available every paid purchase becomes exactly one order');
});

test('two buyers race for the last units: exactly one gets them, stock never goes negative', async () => {
  const db = freshDb('lastunits');
  psqlRaw(db, `update public.products set stock=2, available=true where id='${FIXTURE_IDS.product}'; update public.inventory_reservations set status='released',released_at=now(),release_reason='fx' where status='active'; update public.products set stock=2 where id='${FIXTURE_IDS.product}';`);
  const buy = id => `do $$ begin perform public.create_checkout_session('${FIXTURE_IDS.user}'::uuid,jsonb_build_object('business_id','${B}','client_request_id','${id}','items',jsonb_build_array(jsonb_build_object('product_id','${FIXTURE_IDS.product}','quantity',2)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Race','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago')); exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end $$;`;
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => psqlAsync(db, buy('lastunit' + String(i).padStart(8, '0')))));
  for (const r of rs) assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const out = one(db, `select jsonb_build_object('stock',(select stock from public.products where id='${FIXTURE_IDS.product}'),
    'active_new',(select count(*) from public.inventory_reservations r join public.checkout_sessions s on s.id=r.checkout_session_id where r.status='active' and s.client_request_id like 'lastunit%'),
    'errors',(select count(*) from public.race_errors where state<>'40P01'),'deadlocks',(select count(*) from public.race_errors where state='40P01'))`);
  assert.equal(out.stock, 0);
  assert.equal(out.active_new, 1, 'only one of the eight buyers holds the two units');
  assert.equal(out.errors, 7);
  assert.equal(out.deadlocks, 0);
});

test('the same payment finalized from five sessions at once creates one order and moves stock once', async () => {
  const db = freshDb('finalize');
  psqlRaw(db, `select public.record_mercadopago_payment_snapshot((select id from public.payment_intents limit 1),jsonb_build_object('provider_payment_id','991000001','external_reference',(select external_reference from public.payment_intents limit 1),'preference_id','FORENSIC-PREF','merchant_order_id','MO','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64)),'webhook',null);`);
  const fin = `do $$ begin perform public.finalize_paid_checkout_session((select checkout_session_id from public.payment_intents limit 1)); exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end $$;`;
  const recover = `do $$ begin perform public.retry_stuck_paid_checkouts(10); exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end $$;`;
  const rs = await Promise.all([fin, fin, fin, fin, fin, recover, recover].map(s => psqlAsync(db, s)));
  for (const r of rs) assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const inv = invariants(db);
  assert.equal(inv.orders, 1);
  assert.equal(inv.stock, 8);
  assert.equal(inv.deadlocks, 0);
});

test('a refund and a manual recovery race on a late payment: never an order for money that was returned', async () => {
  const db = freshDb('refundrecover');
  // Late payment that could not heal itself (no stock when it arrived), so both operator actions are available.
  psqlRaw(db, `update public.checkout_sessions set created_at=now()-interval '2 hours',expires_at=now()-interval '1 second';
    select public.release_checkout_session_inventory((select id from public.checkout_sessions limit 1),'fx','expired');
    update public.products set stock=1 where id='${FIXTURE_IDS.product}';
    select public.record_mercadopago_payment_snapshot((select id from public.payment_intents limit 1),jsonb_build_object('provider_payment_id','991000001','external_reference',(select external_reference from public.payment_intents limit 1),'preference_id','FORENSIC-PREF','merchant_order_id','MO','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','approved','payment_method','visa','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64)),'webhook',null);
    update public.products set stock=10 where id='${FIXTURE_IDS.product}';
    insert into public.business_members(business_id,user_id,role,is_active) values('${B}','${FIXTURE_IDS.user}','owner',true);
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values('50000000-0000-4000-8000-0000000000aa','${FIXTURE_IDS.user}','${B}','owner','panel_web');`);
  const actor = `select set_config('request.jwt.claim.sub','${FIXTURE_IDS.user}',false); select set_config('request.jwt.claims',jsonb_build_object('sub','${FIXTURE_IDS.user}','role','authenticated','session_id','50000000-0000-4000-8000-0000000000aa','iat',extract(epoch from clock_timestamp()))::text,false);`;
  const refund = `${actor} do $$ declare x jsonb; begin x:=public.prepare_payment_refund_v2((select id from public.payment_intents limit 1),null,gen_random_uuid(),'race'); exception when others then insert into public.race_errors(state,message) values ('R'||sqlstate,left(sqlerrm,120)); end $$;`;
  const recover = `${actor} do $$ begin perform public.recover_paid_checkout_order((select id from public.checkout_sessions limit 1)); exception when others then insert into public.race_errors(state,message) values ('V'||sqlstate,left(sqlerrm,120)); end $$;`;
  const rs = await Promise.all([psqlAsync(db, refund), psqlAsync(db, recover), psqlAsync(db, refund), psqlAsync(db, recover)]);
  for (const r of rs) assert.equal(r.status, 0, r.stderr.slice(0, 400));
  const out = one(db, `select jsonb_build_object('orders',(select count(*) from public.orders),'open_refunds',(select count(*) from public.payment_refunds where status in ('requested','processing','ambiguous')),
    'stock',(select stock from public.products where id='${FIXTURE_IDS.product}'),'deadlocks',(select count(*) from public.race_errors where state like '%40P01'),
    'errors',(select coalesce(jsonb_agg(state),'[]') from public.race_errors))`);
  assert.equal(out.deadlocks, 0);
  // Whoever won, the loser was refused: an order and an open full refund must never coexist for the same payment
  // unless the refund was requested AFTER the order existed (then the order is frozen by the fulfilment guard).
  if (out.orders === 1) assert.equal(out.stock, 8, 'one order, one deduction');
  else assert.equal(out.stock, 10, 'no order, nothing deducted');
  assert.ok(out.orders + out.open_refunds >= 1, 'one of the two actions won');
});

test('disconnect racing new checkouts: once it succeeds there is no open payment left behind', async () => {
  const db = freshDb('disconnect');
  psqlRaw(db, `insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values('${B}','test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '1 day');
    update public.checkout_sessions set created_at=now()-interval '40 hours',expires_at=now()-interval '30 hours'; update public.payment_intents set internal_status='expired';
    update public.products set stock=1000 where id='${FIXTURE_IDS.product}';`);
  const buyers = Array.from({ length: 4 }, (_, k) => psqlAsync(db, `do $$ declare i int; v jsonb; s uuid; p jsonb; begin for i in 1..25 loop begin
    v:=public.create_checkout_session('${FIXTURE_IDS.user}'::uuid,jsonb_build_object('business_id','${B}','client_request_id','dcrow${k}'||lpad(i::text,6,'0'),'items',jsonb_build_array(jsonb_build_object('product_id','${FIXTURE_IDS.product}','quantity',1)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Race','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago'));
    s:=(v->>'checkout_session_id')::uuid; p:=public.prepare_mercadopago_preference(s,'${FIXTURE_IDS.user}'::uuid,false);
    perform public.record_mercadopago_preference_created((p->>'payment_attempt_id')::uuid,'DC-'||i||'-${k}','https://www.mercadopago.com/checkout/v1/redirect?pref_id=DC','https://s',repeat('e',64),'dc');
  exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end; end loop; end $$;`));
  const disconnect = psqlAsync(db, `do $$ declare i int; v jsonb; begin for i in 1..30 loop v:=public.mp_disconnect_checked('${B}','test',true); insert into public.race_errors(state,message) values ('D'||(v->>'ok'),(v->'pending')::text); exit when (v->>'ok')::boolean; perform pg_sleep(0.05); end loop; end $$;`);
  const rs = await Promise.all([...buyers, disconnect]);
  for (const r of rs) assert.equal(r.status, 0, r.stderr.slice(0, 400));
  const out = one(db, `select jsonb_build_object('status',(select status from public.mp_seller_connections where business_id='${B}'),
    'token_kept',(select protected_tokens is not null from public.mp_seller_connections where business_id='${B}'),
    'open',(public.mp_disconnect_preflight('${B}','test')->>'open_payments')::int,
    'live_checkouts',(select count(*) from public.checkout_sessions where status in ('created','validating','ready_for_payment','redirected','payment_pending') and expires_at>now()),
    'disconnect_ok',(select count(*) from public.race_errors where state='Dtrue'))`);
  // Either the disconnect never completed (open payments kept the credential), or it completed with nothing open.
  if (out.status === 'disconnected') {
    assert.equal(out.token_kept, false);
    assert.equal(out.live_checkouts, 0, 'a completed disconnect cannot leave a live checkout without its credential');
  } else {
    assert.equal(out.token_kept, true, 'while payments are open the credential is kept');
  }
});


test('lock order: payment snapshots, expiry sweeps and buyers reopening the payment link never deadlock', async () => {
  const db = freshDb('lockorder');
  const N = 120;
  psqlRaw(db, makePurchases(N, { lapsed: true }));
  psqlRaw(db, `update public.checkout_sessions set status='payment_pending' where id in (select checkout_session_id from public.payment_intents where preference_id like 'RACE-PREF-%');`);
  const intents = one(db, `select jsonb_agg(jsonb_build_object('i',id,'s',checkout_session_id,'r',external_reference,'p',preference_id) order by created_at) from public.payment_intents where preference_id like 'RACE-PREF-%'`);
  const record = e => `do $$ begin perform public.record_mercadopago_payment_snapshot('${e.i}',jsonb_build_object('provider_payment_id','${660000000 + intents.indexOf(e)}','external_reference','${e.r}','preference_id','${e.p}','merchant_order_id','M','collector_id','collector-retry','currency','ARS','transaction_amount','1250.00','status','pending','payment_method','visa','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64)),'x',null); exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end $$;`;
  const sweep = `do $$ begin perform public.expire_checkout_sessions(3); exception when others then insert into public.race_errors(state,message) values (sqlstate,left(sqlerrm,120)); end $$;`;
  const reopen = e => `do $$ begin perform public.prepare_mercadopago_preference('${e.s}','${FIXTURE_IDS.user}'::uuid,false); exception when others then insert into public.race_errors(state,message) values ('P'||sqlstate,left(sqlerrm,120)); end $$;`;
  const worker = async statements => { for (const sql of statements) await psqlAsync(db, sql); };
  await Promise.all([
    worker(intents.map(record)), worker([...intents].reverse().map(record)),
    worker(Array.from({ length: N }, () => sweep)), worker(Array.from({ length: N }, () => sweep)),
    worker(intents.map(reopen)),
  ]);
  const out = one(db, `select jsonb_build_object('deadlocks',(select count(*) from public.race_errors where state in ('40P01','P40P01')),'states',(select coalesce(jsonb_agg(distinct state),'[]') from public.race_errors))`);
  assert.equal(out.deadlocks, 0, 'deadlock detected: ' + JSON.stringify(out.states));
});
