// P0 forensic findings F01-F05 (money, stock, payment identity, refund accounting) against real PostgreSQL.
// Each case asserts the SAFE behaviour. Run against the audited commit 897aeefd these fail; they pass once the
// financial-integrity migration is applied. Provider responses are simulated; SQL, constraints and locks are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap, ACTOR, EXPIRE, LAPSE, FULL_REFUND, deliver } from './harness.mjs';

// Late payment that the system could NOT heal by itself (no stock when it arrived): stays in review, which is the
// state in which the audited build allowed refunds without an order and then let recovery reopen the sale.
const LATE_IN_REVIEW = `${EXPIRE} update public.products set stock=1 where id=v_product; v_result:=${snap('approved')}; update public.products set stock=10 where id=v_product;`;

const approveAndFinalize = `v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; v_order:=(v_result->>'order_id')::uuid;`;

test('F01 a fully refunded late payment cannot be recovered into a deliverable order', () => {
  const s = runScenario(`${LATE_IN_REVIEW} ${FULL_REFUND}
    begin v_result:=public.recover_paid_checkout_order(v_session); v_extra:=jsonb_build_object('recovery','allowed'); exception when others then v_extra:=jsonb_build_object('recovery','blocked','sqlstate',SQLSTATE); end;`);
  assert.equal(s.extra.recovery, 'blocked');
  assert.equal(s.extra.sqlstate, '55000');
  assert.equal(s.orders, 0, 'no order may be created for money that was returned');
  assert.equal(s.stock, 10, 'stock must stay intact');
  assert.equal(s.intent.status, 'security_review_required', 'the intent keeps its review; the refund is on the ledger');
  assert.equal(s.intent.refunded, 2500);
});

test('F01 composition: refund -> recover -> deliver never reaches delivered', () => {
  const s = runScenario(`${LATE_IN_REVIEW} ${FULL_REFUND}
    begin v_result:=public.recover_paid_checkout_order(v_session); v_order:=(v_result->>'order_id')::uuid; ${deliver('f01')} exception when others then v_extra:=jsonb_build_object('recovery','blocked'); end;`);
  assert.equal(s.orders, 0);
  assert.notEqual(s.extra?.delivery?.status, 'delivered');
});

test('F01 an order whose payment is fully refunded after completion cannot advance, whatever the review label says', () => {
  const s = runScenario(`${approveAndFinalize} ${FULL_REFUND} ${deliver('f01b')}`);
  assert.equal(s.extra.delivery.blocked, true);
  assert.equal(s.extra.delivery.sqlstate, '55000');
  assert.equal(s.intent.refunded, 2500);
});

test('F01 a partial refund (compensation) does not stop an order that still has net money', () => {
  const s = runScenario(`${approveAndFinalize} ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,250,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001');
    perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',250,repeat('2',64)); ${deliver('f01c')}`);
  assert.equal(s.extra.delivery.status, 'delivered');
  assert.equal(s.intent.refunded, 250);
  assert.equal(s.intent.status, 'partially_refunded');
});

test('F02 recovery is refused while a refund is ambiguous', () => {
  const s = runScenario(`${LATE_IN_REVIEW} ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic');
    perform public.mark_payment_refund_ambiguous((v_extra->>'refund_id')::uuid,repeat('3',64),'synthetic_lost_response');
    begin v_result:=public.recover_paid_checkout_order(v_session); v_extra:=jsonb_build_object('recovery','allowed'); exception when others then v_extra:=jsonb_build_object('recovery','blocked','sqlstate',SQLSTATE); end;`);
  assert.equal(s.extra.recovery, 'blocked');
  assert.equal(s.orders, 0);
  assert.equal(s.stock, 10);
});

test('F02 finalization itself refuses to create an order while a refund is open', () => {
  const s = runScenario(`v_result:=${snap('approved')};
    insert into public.payment_refunds(payment_intent_id,amount,status,reason) values (v_intent,2500,'requested','forensic open refund');
    begin v_result:=public.finalize_paid_checkout_session(v_session); exception when others then v_result:=jsonb_build_object('ok',false,'sqlstate',SQLSTATE); end;`);
  assert.notEqual(s.result.ok, true);
  assert.equal(s.result.hold, 'refund_in_flight');
  assert.equal(s.orders, 0);
  assert.equal(s.stock, 8, 'only the original reservation holds stock: nothing is deducted twice');
  assert.equal(s.reservations.filter(r => r.status === 'converted').length, 0);
});

test('F03 a purchase of 2 units leaves exactly 2 units out of stock after interruption, expiry and recovery', () => {
  const s = runScenario(`v_result:=${snap('approved')}; ${LAPSE} v_result:=public.finalize_paid_checkout_session(v_session); perform public.expire_checkout_sessions(100);
    ${ACTOR} v_result:=public.recover_paid_checkout_order(v_session); set constraints all immediate;`);
  assert.equal(s.stock, 8, 'stock must be 10-2, not 10-4');
  assert.equal(s.orders, 1);
  const net = s.reservations.filter(r => r.status === 'converted').reduce((a, r) => a + r.quantity, 0);
  assert.equal(net, 2, 'exactly one net allocation of 2');
  assert.equal(s.reservations.filter(r => r.status === 'active').length, 0, 'no orphan active reservation');
});

test('F03 recovery executed twice never moves stock twice', () => {
  const s = runScenario(`v_result:=${snap('approved')}; ${LAPSE} v_result:=public.finalize_paid_checkout_session(v_session); ${ACTOR}
    v_result:=public.recover_paid_checkout_order(v_session); v_extra:=public.recover_paid_checkout_order(v_session); set constraints all immediate;`);
  assert.equal(s.stock, 8);
  assert.equal(s.orders, 1);
});

test('F03 a snapshot that arrives after the window lapsed (stock still held) finalizes without a second deduction', () => {
  const s = runScenario(`${LAPSE} v_result:=${snap('approved')}; if (v_result->>'finalize_required')::boolean then v_result:=public.finalize_paid_checkout_session(v_session); end if; set constraints all immediate;`);
  assert.equal(s.stock, 8);
  assert.equal(s.orders, 1, 'the paid purchase becomes an order: stock was still held for it');
});

test('F12 approval after the reservation was released re-reserves transactionally when stock exists, else leaves a visible case', () => {
  const s = runScenario(`${EXPIRE} v_result:=${snap('approved')}; if (v_result->>'finalize_required')::boolean then v_result:=public.finalize_paid_checkout_session(v_session); end if; set constraints all immediate;`);
  const orderCreated = s.orders === 1;
  if (orderCreated) {
    assert.equal(s.stock, 8);
  } else {
    assert.equal(s.stock, 10);
    assert.ok(s.discrepancies?.some(d => d.kind === 'paid_without_order' && d.status === 'open'), 'paid without order must be visible');
  }
  assert.ok(orderCreated, 'with stock available the paid purchase must not vanish');
});

test('F12 approval after release with NO stock available leaves a durable, visible case and no oversell', () => {
  const s = runScenario(`${EXPIRE} update public.products set stock=1 where id=v_product; v_result:=${snap('approved')}; if (v_result->>'finalize_required')::boolean then v_result:=public.finalize_paid_checkout_session(v_session); end if; set constraints all immediate;`);
  assert.equal(s.orders, 0);
  assert.equal(s.stock, 1);
  assert.ok(s.discrepancies?.some(d => d.kind === 'paid_without_order' && d.status === 'open'));
});

test('F04 a rejected payment recorded after an approved one never replaces the approved identity', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('rejected', '991000002')}; ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic');`);
  assert.equal(s.intent.provider_id, '991000001');
  assert.equal(s.intent.provider_status, 'approved');
  assert.equal(s.extra.provider_payment_id, '991000001', 'the refund must target the approved payment');
  assert.deepEqual(s.payments.map(p => p.id), ['991000001', '991000002']);
});

test('F04 two approved payment ids keep the first as financing and raise a durable discrepancy', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('approved', '991000002')};`);
  assert.equal(s.intent.provider_id, '991000001');
  assert.equal(s.payments.length, 2);
  assert.ok(s.discrepancies.some(d => d.kind === 'multiple_approved_payments' && d.status === 'open' && d.severity === 'critical'));
  assert.equal(s.orders, 1);
  assert.equal(s.stock, 8);
});

test('F04 order of arrival does not matter: newer rejection first, older approval second still finalizes', () => {
  const s = runScenario(`v_result:=${snap('rejected', '991000002', `||jsonb_build_object('provider_occurred_at',(clock_timestamp()+interval '10 seconds')::text)`)};
    v_result:=${snap('approved', '991000001')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate;`);
  assert.equal(s.orders, 1);
  assert.equal(s.intent.provider_id, '991000001');
  assert.equal(s.intent.provider_status, 'approved');
});

test('F04 the same payment repeated, stale and out of order is idempotent and never regresses', () => {
  const s = runScenario(`v_result:=${snap('pending')}; v_result:=${snap('approved')}; v_result:=${snap('approved')}; v_result:=${snap('pending', '991000001', `||jsonb_build_object('provider_occurred_at',(clock_timestamp()-interval '1 minute')::text)`)}; v_result:=${snap('pending')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate;`);
  assert.equal(s.orders, 1);
  assert.equal(s.payments.length, 1);
  assert.equal(s.intent.provider_status, 'approved');
});

test('F05 external refund of 500 plus local refund of 250 totals 750', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('approved', '991000001', `||jsonb_build_object('refunded_amount','500.00')`)}; ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,250,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001');
    perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',250,repeat('2',64));`);
  assert.equal(s.intent.refunded, 750);
  assert.equal(s.intent.status, 'partially_refunded');
});

test('F05 the same total is reached when the provider snapshot arrives after the local refund, and when repeated', () => {
  const s = runScenario(`${approveAndFinalize} ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,250,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001');
    perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',250,repeat('2',64));
    v_result:=${snap('approved', '991000001', `||jsonb_build_object('refunded_amount','750.00','refunds',jsonb_build_array(jsonb_build_object('id','881000001','amount','250.00','status','approved'),jsonb_build_object('id','770000009','amount','500.00','status','approved')))`)};
    v_result:=${snap('approved', '991000001', `||jsonb_build_object('refunded_amount','750.00','refunds',jsonb_build_array(jsonb_build_object('id','881000001','amount','250.00','status','approved'),jsonb_build_object('id','770000009','amount','500.00','status','approved')))`)};`);
  assert.equal(s.intent.refunded, 750);
  assert.equal(s.refunds.filter(r => r.status === 'approved').length, 2);
});

test('F05 an external refund that already covers the local one is not counted twice', () => {
  const s = runScenario(`${approveAndFinalize}
    v_result:=${snap('approved', '991000001', `||jsonb_build_object('refunded_amount','250.00','refunds',jsonb_build_array(jsonb_build_object('id','881000001','amount','250.00','status','approved')))`)}; ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,250,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001');
    perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',250,repeat('2',64));`);
  assert.equal(s.intent.refunded, 250, 'one provider refund, one count');
});

test('F05 refunds that add up to the full amount move the intent to refunded and block advancing', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('approved', '991000001', `||jsonb_build_object('refunded_amount','2000.00')`)}; ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,500,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001');
    perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',500,repeat('2',64)); ${deliver('f05')}`);
  assert.equal(s.intent.refunded, 2500);
  assert.equal(s.intent.status, 'refunded');
  assert.equal(s.extra.delivery.blocked, true);
});
