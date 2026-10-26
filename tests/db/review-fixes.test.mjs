// Fixes from the independent review of the financial core (2026-10-23): migration 20261023210000, on real PostgreSQL.
// Each test states the behaviour BEFORE the fix in its comment; run against a database without the migration they fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap, ACTOR, EXPIRE, FIXTURE_IDS } from './harness.mjs';

const APPROVE_AND_FINALIZE = `v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; v_order:=(v_result->>'order_id')::uuid;`;
// Intents are aged with triggers off: updated_at is maintained by a trigger.
const AGE = (interval) => `set local session_replication_role=replica; update public.payment_intents set approved_at=clock_timestamp()-interval '${interval}', updated_at=clock_timestamp()-interval '${interval}' where id=v_intent; set local session_replication_role=origin;`;
const finding = (s, kind) => (s.discrepancies || []).find((d) => d.kind === kind);

// ---- 1. in_mediation ------------------------------------------------------------------------------------------------
// Before: `in_mediation` was an unknown status -> the paid, fulfilled intent became security_review_required, a BLOCKING
// critical discrepancy opened, the refund was refused (55000) and disconnection blocked for good.
test('a dispute on a fulfilled order is recorded and shown; intent, session and order stay as they were; the owner can still refund', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE}
    v_before:=jsonb_build_object('intent',(select internal_status from public.payment_intents where id=v_intent),
      'session',(select status from public.checkout_sessions where id=v_session),'orders',(select count(*) from public.orders where business_id=v_business));
    v_extra:=${snap('in_mediation')};
    ${ACTOR} v_extra2:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic');`);
  assert.equal(s.extra.mediation, true);
  assert.equal(s.extra.manual_review_required, false);
  assert.equal(s.intent.status, s.before.intent);
  assert.equal(s.intent.provider_status, 'approved', 'the purchase keeps the status of the payment that funded it');
  assert.equal(s.session.status, s.before.session);
  assert.equal(s.orders, s.before.orders);
  assert.equal(s.orders, 1);
  assert.equal(finding(s, 'provider_payment_inconsistent'), undefined, 'no blocking finding about an unknown status');
  assert.deepEqual(finding(s, 'payment_in_mediation'), { kind: 'payment_in_mediation', status: 'open', severity: 'high' });
  assert.ok(s.payments.some((p) => p.status === 'in_mediation'), 'the provider payment row records the dispute');
  assert.match(String(s.extra2.refund_id), /^[0-9a-f-]{36}$/, 'the refund is not refused because of the dispute');
});

test('the finding closes by itself when the payment leaves mediation, and reopens if the dispute comes back', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE}
    v_extra:=${snap('in_mediation')};
    v_extra:=${snap('approved')};
    v_before:=jsonb_build_object('after_approved',(select status from public.payment_discrepancies where payment_intent_id=v_intent and kind='payment_in_mediation'));
    v_extra2:=${snap('in_mediation')};`);
  assert.equal(s.before.after_approved, 'resolved');
  assert.equal(finding(s, 'payment_in_mediation').status, 'open');
  assert.equal(s.intent.provider_status, 'approved');
});

test('a dispute that arrives before the order exists does not stop the purchase', () => {
  const s = runScenario(`v_result:=${snap('approved')}; v_extra:=${snap('in_mediation')};
    v_before:=jsonb_build_object('intent',(select internal_status from public.payment_intents where id=v_intent));
    v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate;`);
  assert.equal(s.extra.mediation, true);
  assert.equal(s.extra.finalize_required, true);
  assert.equal(s.before.intent, 'approved_order_pending');
  assert.equal(s.orders, 1);
});

test('control: a genuinely unknown provider status is still an anomaly that stops the purchase', () => {
  const s = runScenario(`v_result:=${snap('approved')}; v_extra:=${snap('totally_made_up')};`);
  assert.equal(s.extra.manual_review_required, true);
  assert.equal(s.extra.reason, 'unknown_provider_status');
});

// ---- 2. the stuck-purchase sweep has an age ------------------------------------------------------------------------
// Before: any approved purchase without an order, of any age, was fulfilled by the sweep (and took stock).
test('the sweep fulfils a recent approved purchase', () => {
  const s = runScenario(`v_result:=${snap('approved')}; ${AGE('2 minutes')} v_extra:=jsonb_build_object('done',public.retry_stuck_paid_checkouts(25));`);
  assert.equal(s.extra.done, 1);
  assert.equal(s.orders, 1);
});

test('the sweep still fulfils a purchase approved 47 hours ago', () => {
  const s = runScenario(`v_result:=${snap('approved')}; ${AGE('47 hours')} v_extra:=jsonb_build_object('done',public.retry_stuck_paid_checkouts(25));`);
  assert.equal(s.extra.done, 1);
  assert.equal(s.orders, 1);
});

test('an approved purchase older than 48 hours is shown to the owner instead of being fulfilled by the sweep', () => {
  const s = runScenario(`v_result:=${snap('approved')}; ${AGE('49 hours')}
    v_extra:=jsonb_build_object('done',public.retry_stuck_paid_checkouts(25));
    v_extra2:=jsonb_build_object('again',public.retry_stuck_paid_checkouts(25));`);
  assert.equal(s.extra.done, 0);
  assert.equal(s.extra2.again, 0);
  assert.equal(s.orders, 0, 'no order is created on the system\'s own authority');
  assert.equal(s.intent.status, 'approved_order_pending');
  assert.deepEqual(finding(s, 'paid_without_order'), { kind: 'paid_without_order', status: 'open', severity: 'high' });
});

// ---- 3. the lookup says which business owns the checkout -------------------------------------------------------------
test('the reference lookup returns the business that owns the checkout', () => {
  const s = runScenario(`v_extra:=public.find_payment_intent_by_external_reference('test','taba2:checkout:'||v_session::text);`);
  assert.equal(s.extra.business_id, FIXTURE_IDS.business);
  assert.ok(s.extra.payment_intent_id && s.extra.checkout_session_id);
});

// ---- 4. a provider refund id has to be one the provider listed ---------------------------------------------------------
// Before: any well-formed number marked the money as returned.
const AMBIGUOUS_REFUND = (evidence) => `${ACTOR} ${EXPIRE} update public.products set stock=1 where id=v_product;
    v_result:=${snap('approved')}; update public.products set stock=10 where id=v_product;
    v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'response_lost');
    perform public.park_refund_identity_unknown(v_refund,'${evidence}'::jsonb);`;

test('with the provider\'s refund list captured, an id that is not in it is refused and one that is in it resolves', () => {
  const s = runScenario(`${AMBIGUOUS_REFUND('{"provider_refunds":[{"id":"881000009","amount":2500,"status":"approved"}]}')}
    begin perform public.resolve_ambiguous_refund(v_refund,'executed','999999999','typed by hand from the dashboard, refund 999999999'); v_before:=jsonb_build_object('wrong','allowed');
    exception when others then v_before:=jsonb_build_object('wrong',SQLSTATE); end;
    v_before:=v_before||jsonb_build_object('still_ambiguous',(select status from public.payment_refunds where id=v_refund));
    v_result:=public.resolve_ambiguous_refund(v_refund,'executed','881000009','confirmed in the provider panel, refund 881000009');
    v_extra:=jsonb_build_object('refund',(select jsonb_build_object('status',status,'id',provider_refund_id) from public.payment_refunds where id=v_refund));`);
  assert.equal(s.before.wrong, '22023');
  assert.equal(s.before.still_ambiguous, 'ambiguous');
  assert.equal(s.extra.refund.status, 'approved');
  assert.equal(s.extra.refund.id, '881000009');
  assert.equal(s.intent.refunded, 2500);
});

test('with no provider evidence an owner note cannot assert money was refunded', () => {
  const s = runScenario(`${AMBIGUOUS_REFUND('{"provider_refunds":[]}')}
    begin perform public.resolve_ambiguous_refund(v_refund,'executed','881000009','confirmed in the provider panel, refund 881000009');
    v_extra:=jsonb_build_object('accepted',true);
    exception when others then v_extra:=jsonb_build_object('accepted',false,'code',SQLSTATE); end;`);
  assert.equal(s.extra.accepted, false);
  assert.equal(s.extra.code, '22023');
  assert.equal(s.intent.refunded, 0);
  assert.equal(s.refunds[0].status, 'ambiguous');
});

test('"not executed" cannot clear an ambiguous request without provider confirmation', () => {
  const s = runScenario(`${AMBIGUOUS_REFUND('{"provider_refunds":[{"id":"881000009","amount":2500}]}')}
    begin perform public.resolve_ambiguous_refund(v_refund,'not_executed',null,'provider panel shows no refund for this payment');
      v_before:=jsonb_build_object('released',true); exception when others then v_before:=jsonb_build_object('released',false,'code',SQLSTATE); end;
    v_extra:=jsonb_build_object('refund_status',(select status from public.payment_refunds where id=v_refund));`);
  assert.equal(s.before.released,false);
  assert.equal(s.before.code,'55000');
  assert.equal(s.extra.refund_status, 'ambiguous');
});
