// Independent review of PR #157: an ambiguous refund must have a way out that rests on provider evidence only.
//
// Before 20261026040000 a refund whose request never reached Mercado Pago (provider list empty) froze the order and
// every new refund forever: "executed" needs provider evidence and "not executed" was forbidden outright.
// The invariant stays: a note never becomes a financial fact, and money is never recorded as returned without evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap, ACTOR } from './harness.mjs';

const paid = `v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; v_order:=(v_result->>'order_id')::uuid;`;
// A full refund request whose response was lost; the worker parked it with the provider list it could read.
const lost = (evidence = []) => `${paid} ${ACTOR}
  v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'review: lost request');
  v_refund:=(v_extra->>'refund_id')::uuid;
  perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'network_or_timeout');
  perform public.park_refund_identity_unknown(v_refund,'${JSON.stringify({ provider_refunds: evidence })}'::jsonb);`;
const age = minutes => `update public.payment_refunds set requested_at=clock_timestamp()-interval '${minutes} minutes' where id=v_refund;`;
const settle = (evidence, complete = true) =>
  `public.settle_ambiguous_refund_from_provider(v_refund,'${JSON.stringify({ provider_refunds: evidence, list_complete: complete })}'::jsonb)`;
const attempt = sql => `begin ${sql} v_extra2:=jsonb_build_object('accepted',true); exception when others then v_extra2:=jsonb_build_object('accepted',false,'code',SQLSTATE); end;`;
const state = `v_before:=jsonb_build_object(
    'blocked',private.order_payment_blocks_fulfilment(v_order),
    'hold',private.payment_financial_hold(v_intent),
    'refund',(select status from public.payment_refunds where id=v_refund),
    'case',(select status from public.payment_discrepancies where refund_id=v_refund and kind='refund_identity_unknown'),
    'seen',(select details->'provider_refunds_seen' from public.payment_discrepancies where refund_id=v_refund and kind='refund_identity_unknown'),
    'events',(select count(*) from public.payment_events where payment_intent_id=v_intent and event_type='payment.refund_ambiguity_resolved'));`;

test('control: without provider evidence the owner has no way to release a lost refund request (the defect being fixed)', () => {
  const s = runScenario(`${lost()} ${attempt(`perform public.resolve_ambiguous_refund(v_refund,'not_executed',null,'the request never left the server');`)}
    v_extra:=v_extra2; ${attempt(`perform public.resolve_ambiguous_refund(v_refund,'executed','881000009','guess from the dashboard');`)} ${state}`);
  assert.equal(s.extra.accepted, false, 'a note released an uncertain refund');
  assert.equal(s.extra2.accepted, false, 'a refund id with no provider evidence was accepted');
  assert.equal(s.before.refund, 'ambiguous');
  assert.equal(s.before.blocked, true, 'the order stays frozen until the provider evidence exists');
});

test('a request younger than any possible in-flight invocation is never settled, even with a complete empty list', () => {
  const s = runScenario(`${lost()} v_extra:=to_jsonb(${settle([])}); ${state}`);
  assert.equal(s.extra, 'too_recent');
  assert.equal(s.before.refund, 'ambiguous');
  assert.equal(s.before.blocked, true);
});

test('a complete provider list with nothing unaccounted settles the request as not executed and unfreezes the payment', () => {
  const s = runScenario(`${lost()} ${age(20)} v_extra:=to_jsonb(${settle([])}); ${state}
    v_extra2:=public.prepare_payment_refund_v2(v_intent,null,gen_random_uuid(),'review: refund again');`);
  assert.equal(s.extra, 'settled_not_executed');
  assert.equal(s.before.refund, 'failed');
  assert.equal(s.before.case, 'resolved');
  assert.equal(s.before.blocked, false);
  assert.equal(s.before.events, 1);
  assert.notEqual(s.extra2.reconciliation_required, true, 'a new refund is possible again');
  assert.notEqual(s.extra2.refund_id, undefined);
  assert.equal(s.intent.refunded, 0, 'nothing was recorded as returned');
});

test('an unreadable or truncated list proves nothing and never erases the evidence read earlier', () => {
  const earlier = [{ id: '881000009', amount: 2500, status: 'approved' }];
  const s = runScenario(`${lost(earlier)} ${age(20)} v_extra:=to_jsonb(${settle([], false)}); ${state}`);
  assert.equal(s.extra, 'incomplete_evidence');
  assert.equal(s.before.refund, 'ambiguous');
  assert.deepEqual(s.before.seen.map(r => r.id), ['881000009']);
});

test('a provider refund we do not hold is never settled away; the owner can still adopt it with exact evidence', () => {
  const unheld = [{ id: '881000009', amount: 2500, status: 'approved' }];
  const s = runScenario(`${lost(unheld)} ${age(20)} v_extra:=to_jsonb(${settle(unheld)}); ${state}
    ${attempt(`v_result:=public.resolve_ambiguous_refund(v_refund,'executed','881000009','adopt the visible provider refund');`)}`);
  assert.equal(s.extra, 'unaccounted');
  assert.equal(s.before.refund, 'ambiguous');
  assert.equal(s.extra2.accepted, true);
  assert.equal(s.intent.refunded, 2500);
});

test('a pending provider refund (in process) also blocks settlement', () => {
  const pending = [{ id: '881000009', amount: 2500, status: 'in_process' }];
  const s = runScenario(`${lost(pending)} ${age(20)} v_extra:=to_jsonb(${settle(pending)}); ${state}`);
  assert.equal(s.extra, 'unaccounted');
  assert.equal(s.before.refund, 'ambiguous');
});

test('refunds the provider lists that we already recorded do not block, rejected ones moved no money, a different amount does', () => {
  const s = runScenario(`${paid} ${ACTOR}
    insert into public.payment_refunds(payment_intent_id,provider_refund_id,idempotency_key,amount,status,origin,requested_at,completed_at)
      values(v_intent,'881000010',gen_random_uuid(),500,'approved','external',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '3 hours');
    v_extra:=public.prepare_payment_refund_v2(v_intent,1000,v_key,'review: partial request');
    v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'network_or_timeout');
    perform public.park_refund_identity_unknown(v_refund,'{"provider_refunds":[]}'::jsonb);
    ${age(20)}
    v_extra:=to_jsonb(${settle([{ id: '881000010', amount: 500, status: 'approved' }, { id: '881000011', amount: 1000, status: 'rejected' }])});
    v_extra2:=to_jsonb(${settle([{ id: '881000010', amount: 499, status: 'approved' }])});
    ${state}`);
  // The second call happens after the first settled it, so build the expectation from both outcomes.
  assert.equal(s.extra, 'settled_not_executed');
  assert.equal(s.extra2, 'not_applicable', 'a refund that is no longer ambiguous is never touched again');
  assert.equal(s.before.refund, 'failed');
});

test('a recorded refund with a different amount than the provider reports is unaccounted', () => {
  const s = runScenario(`${paid} ${ACTOR}
    insert into public.payment_refunds(payment_intent_id,provider_refund_id,idempotency_key,amount,status,origin,requested_at,completed_at)
      values(v_intent,'881000010',gen_random_uuid(),500,'approved','external',clock_timestamp()-interval '3 hours',clock_timestamp()-interval '3 hours');
    v_extra:=public.prepare_payment_refund_v2(v_intent,1000,v_key,'review: partial request');
    v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'network_or_timeout');
    perform public.park_refund_identity_unknown(v_refund,'{"provider_refunds":[]}'::jsonb);
    ${age(20)}
    v_extra:=to_jsonb(${settle([{ id: '881000010', amount: 499, status: 'approved' }])}); ${state}`);
  assert.equal(s.extra, 'unaccounted');
  assert.equal(s.before.refund, 'ambiguous');
});

test('only an ambiguous refund without a provider identity can be settled; evidence must be a list', () => {
  const s = runScenario(`${paid} ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'review: ordinary refund');
    v_refund:=(v_extra->>'refund_id')::uuid;
    v_extra:=to_jsonb(${settle([])});
    perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001');
    perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'network_or_timeout');
    v_before:=to_jsonb(${settle([])});
    ${attempt(`perform public.settle_ambiguous_refund_from_provider(v_refund,'{"provider_refunds":{"id":"1"},"list_complete":true}'::jsonb);`)}`);
  assert.equal(s.extra, 'not_applicable');
  assert.equal(s.before, 'not_applicable', 'a refund that already has its provider identity is reconciled by that identity');
  assert.equal(s.extra2.accepted, false);
});

test('privileges: only the service role settles; only an owner or admin may ask for another provider read', () => {
  const s = runScenario(`${lost()}
    v_extra:=jsonb_build_object(
      'settle_anon',has_function_privilege('anon','public.settle_ambiguous_refund_from_provider(uuid,jsonb)','EXECUTE'),
      'settle_auth',has_function_privilege('authenticated','public.settle_ambiguous_refund_from_provider(uuid,jsonb)','EXECUTE'),
      'settle_service',has_function_privilege('service_role','public.settle_ambiguous_refund_from_provider(uuid,jsonb)','EXECUTE'),
      'reverify_anon',has_function_privilege('anon','public.request_refund_reverification(uuid)','EXECUTE'),
      'reverify_auth',has_function_privilege('authenticated','public.request_refund_reverification(uuid)','EXECUTE'));
    v_before:=jsonb_build_object('first',public.request_refund_reverification(v_refund));
    v_before:=v_before||jsonb_build_object('second',public.request_refund_reverification(v_refund),
      'jobs',(select count(*) from public.payment_outbox where refund_id=v_refund and topic='refund_reconcile' and status in ('pending','claimed','processing','retry_wait')));
    perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000dead',true);
    perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated"}',true);
    ${attempt(`perform public.request_refund_reverification(v_refund);`)}`);
  assert.deepEqual(s.extra, { settle_anon: false, settle_auth: false, settle_service: true, reverify_anon: false, reverify_auth: true });
  assert.equal(s.before.first, true);
  assert.equal(s.before.second, true);
  assert.equal(s.before.jobs, 1, 'asking twice never queues two provider reads');
  assert.equal(s.extra2.accepted, false);
  assert.equal(s.extra2.code, '42501');
});

// The evidence is a LIST. A guard that only asks "is there SOME approved refund of the right amount" while the
// operator names ANOTHER entry would record money as returned on the strength of a different refund.
for (const [label, evidence, picked] of [
  ['an entry of a different amount while another entry has the right one', [{ id: '881000001', amount: 500, status: 'approved' }, { id: '881000002', amount: 2500, status: 'approved' }], '881000001'],
  ['a rejected entry while another entry is approved with the right amount', [{ id: '881000001', amount: 2500, status: 'rejected' }, { id: '881000002', amount: 2500, status: 'approved' }], '881000001'],
  ['an entry that is only in process while another is approved', [{ id: '881000001', amount: 2500, status: 'in_process' }, { id: '881000002', amount: 2500, status: 'approved' }], '881000001'],
]) {
  test(`the operator cannot adopt ${label}`, () => {
    const s = runScenario(`${lost(evidence)} ${attempt(`perform public.resolve_ambiguous_refund(v_refund,'executed','${picked}','operator picks the wrong provider entry');`)}`);
    assert.equal(s.extra2.accepted, false, 'a different provider refund was adopted as this one');
    assert.equal(s.intent.refunded, 0);
    assert.equal(s.refunds[0].status, 'ambiguous');
  });
}

test('control: the same list lets the operator adopt the entry that really matches', () => {
  const evidence = [{ id: '881000001', amount: 500, status: 'approved' }, { id: '881000002', amount: 2500, status: 'approved' }];
  const s = runScenario(`${lost(evidence)} ${attempt(`perform public.resolve_ambiguous_refund(v_refund,'executed','881000002','operator picks the matching provider entry');`)}`);
  assert.equal(s.extra2.accepted, true);
  assert.equal(s.intent.refunded, 2500);
});

// The two financial guards are installed by patching the function's text. A later migration that redefines the whole
// function from an older body would silently drop them; this test fails the moment that happens.
test('the live resolve_ambiguous_refund still carries both financial guards and the original privileges', () => {
  const s = runScenario(`v_extra:=jsonb_build_object(
    'amount_guard',position('CONFIRMED_PROVIDER_REFUND_AMOUNT' in pg_get_functiondef('public.resolve_ambiguous_refund(uuid,text,text,text)'::regprocedure))>0,
    'outcome_guard',position('UNKNOWN_REFUND_REQUIRES_PROVIDER_OUTCOME' in pg_get_functiondef('public.resolve_ambiguous_refund(uuid,text,text,text)'::regprocedure))>0,
    'anon',has_function_privilege('anon','public.resolve_ambiguous_refund(uuid,text,text,text)','EXECUTE'),
    'authenticated',has_function_privilege('authenticated','public.resolve_ambiguous_refund(uuid,text,text,text)','EXECUTE'),
    'definer',(select prosecdef from pg_proc where oid='public.resolve_ambiguous_refund(uuid,text,text,text)'::regprocedure));`);
  assert.deepEqual(s.extra, { amount_guard: true, outcome_guard: true, anon: false, authenticated: true, definer: true });
});
