// Independent review of PR #157: concurrent refund requests with DIFFERENT idempotency keys on one payment.
// A double click, two operators or a retry that mints a fresh UUID must never put more money in flight than was paid,
// and a lost response of one request must keep blocking every other request until it is reconciled.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { psqlRaw, psqlAsync } from '../../scripts/local-db/lib.mjs';
import { committedFixtureSql, snap, FIXTURE_IDS } from './harness.mjs';

const TEMPLATE = process.env.TABA_LOCAL_DB || 'taba_local_work';
const SESSION = '70000000-0000-4000-8000-0000000000aa';
const created = [];
const one = (db, sql) => JSON.parse(psqlRaw(db, sql, { tuples: true }).stdout.split('\n').map(s => s.trim()).filter(Boolean).pop());

function paidDb(label) {
  const db = `taba_local_rf_${label}_${process.pid}`;
  created.push(db);
  psqlRaw('postgres', `drop database if exists ${db} with (force); create database ${db} template ${TEMPLATE};`);
  psqlRaw(db, committedFixtureSql(2));
  psqlRaw(db, `do $$ declare v_intent uuid; v_session uuid; v_result jsonb; v_user uuid:='${FIXTURE_IDS.user}'; v_business uuid:='${FIXTURE_IDS.business}'; v_key uuid:='${SESSION}'; begin
    select id, checkout_session_id into v_intent, v_session from public.payment_intents where business_id=v_business;
    v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session);
    insert into public.business_members(business_id,user_id,role,is_active) values(v_business,v_user,'owner',true);
    insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values(v_key,v_user,v_business,'owner','panel_web');
  end $$;`);
  return db;
}
after(() => { for (const db of created) psqlRaw('postgres', `drop database if exists ${db} with (force);`, { check: false }); });

const asOwner = sql => `select set_config('request.jwt.claim.sub','${FIXTURE_IDS.user}',false),
  set_config('request.jwt.claims',jsonb_build_object('sub','${FIXTURE_IDS.user}'::text,'role','authenticated','session_id','${SESSION}','iat',extract(epoch from clock_timestamp()))::text,false);
  ${sql}`;
const request = (intent, amount) =>
  asOwner(`select to_jsonb(public.prepare_payment_refund_v2('${intent}',${amount},gen_random_uuid(),'review: concurrent request'));`);

const inflight = db => one(db, `select jsonb_build_object(
  'paid',(select coalesce(paid_amount,expected_amount) from public.payment_intents),
  'requested',(select coalesce(sum(amount),0) from public.payment_refunds where status in ('requested','processing','ambiguous','approved')),
  'rows',(select count(*) from public.payment_refunds where status in ('requested','processing','ambiguous','approved')))`);

for (const [label, amount] of [['partial 1500 on 2500', 1500], ['partial 1000 on 2500', 1000], ['full refund (no amount)', 'null']]) {
  test(`eight concurrent refund requests with different keys never put more than the payment in flight: ${label}`, async () => {
    const db = paidDb(label.replace(/[^a-z0-9]/gi, '').toLowerCase());
    const intent = one(db, `select to_jsonb(id) from public.payment_intents`);
    const results = await Promise.all(Array.from({ length: 8 }, () => psqlAsync(db, request(intent, amount))));
    const accepted = results.filter(r => r.status === 0 && /"refund_id"/.test(r.stdout) && !/"reconciliation_required": ?true/.test(r.stdout)).length;
    const state = inflight(db);
    console.log(JSON.stringify({ case: label, accepted, ...state }));
    assert.ok(state.requested <= state.paid, `more money in flight (${state.requested}) than was paid (${state.paid})`);
    assert.ok(accepted >= 1, 'no request was accepted at all');
    assert.equal(state.rows <= Math.floor(state.paid / (amount === 'null' ? state.paid : amount)), true,
      'more refund rows than the payment can cover');
  });
}

test('a request whose response was lost blocks every other request, concurrent or later, until reconciled', async () => {
  const db = paidDb('lostblock');
  const intent = one(db, `select to_jsonb(id) from public.payment_intents`);
  const first = JSON.parse((await psqlAsync(db, request(intent, 1000))).stdout.trim().split('\n').pop());
  psqlRaw(db, `select public.mark_payment_refund_ambiguous('${first.refund_id}',repeat('3',64),'network_or_timeout');`);
  const later = await Promise.all(Array.from({ length: 6 }, () => psqlAsync(db, request(intent, 500))));
  const answers = later.map(r => (r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : { rejected: true }));
  const state = inflight(db);
  console.log(JSON.stringify({ case: 'lost-response', answers: answers.map(a => a.reconciliation_required ?? a.rejected), ...state }));
  assert.ok(answers.every(a => a.rejected || a.reconciliation_required === true), 'a new refund was started while one is unreconciled');
  assert.equal(state.rows, 1, 'exactly the first request exists');
});
