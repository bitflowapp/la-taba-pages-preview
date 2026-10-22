// The 26 PostgreSQL scenarios of the independent forensic audit (commit 897aeefd), replayed one by one against the
// corrected schema. Each asserts the SAFE outcome. Scenarios that were controls in the audit still pass; the ones that
// exposed defects now assert the repaired behaviour. Provider facts are simulated; SQL, constraints and locks are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap, ACTOR, EXPIRE, LAPSE, FULL_REFUND, deliver } from './harness.mjs';

const approveAndFinalize = `v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; v_order:=(v_result->>'order_id')::uuid;`;
const LATE_IN_REVIEW = `${EXPIRE} update public.products set stock=1 where id=v_product; v_result:=${snap('approved')}; update public.products set stock=10 where id=v_product;`;
const CONNECT = `insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values(v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '1 day');`;

test('01 duplicate approval finalizes once: one order, stock 8', () => {
  const s = runScenario(`v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; v_extra:=public.finalize_paid_checkout_session(v_session);`);
  assert.equal(s.orders, 1); assert.equal(s.stock, 8); assert.equal(s.extra.idempotent, true);
});
test('02 a pending payment never becomes an order (SQLSTATE 55000)', () => {
  const s = runScenario(`v_result:=${snap('pending')}; begin v_extra:=public.finalize_paid_checkout_session(v_session); exception when others then v_extra:=jsonb_build_object('blocked',true,'sqlstate',SQLSTATE); end;`);
  assert.equal(s.extra.sqlstate, '55000'); assert.equal(s.orders, 0);
});
test('03 approval after the reservation expired no longer strands the buyer: the paid purchase is re-reserved in the same transaction', () => {
  const s = runScenario(`${EXPIRE} v_result:=${snap('approved')}; if (v_result->>'finalize_required')::boolean then v_result:=public.finalize_paid_checkout_session(v_session); end if; set constraints all immediate;`);
  assert.equal(s.orders, 1); assert.equal(s.stock, 8); assert.equal(s.intent.paid, 2500);
});
test('04 a missing preference is retryable; the corrected read finalizes once (no permanent review)', () => {
  const s = runScenario(`v_result:=${snap('approved', '991000001', `||jsonb_build_object('preference_id','')`)}; v_before:=v_result; v_result:=${snap('approved')}; if (v_result->>'finalize_required')::boolean then v_extra:=public.finalize_paid_checkout_session(v_session); end if; set constraints all immediate;`);
  assert.equal(s.before.retryable, true); assert.equal(s.orders, 1);
});
test('05 a rejected payment after the approved one does not replace the approved identity', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('rejected', '991000002')}; ${ACTOR} v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic');`);
  assert.equal(s.intent.provider_id, '991000001'); assert.equal(s.extra.provider_payment_id, '991000001');
});
test('06 two approved payment ids: both stored, first keeps funding, critical case opened', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('approved', '991000002')};`);
  assert.equal(s.payments.length, 2); assert.ok(s.discrepancies.some(d => d.kind === 'multiple_approved_payments' && d.severity === 'critical'));
});
test('07 refund of a late payment that stayed in review cannot be recovered afterwards', () => {
  const s = runScenario(`${LATE_IN_REVIEW} ${FULL_REFUND}
    begin v_result:=public.recover_paid_checkout_order(v_session); v_extra:=jsonb_build_object('recovery','allowed'); exception when others then v_extra:=jsonb_build_object('recovery',SQLSTATE); end;`);
  assert.equal(s.extra.recovery, '55000'); assert.equal(s.orders, 0); assert.equal(s.stock, 10);
});
test('08 eight empty probes do not stop the watch', () => {
  const s = runScenario(`update public.checkout_sessions set created_at=clock_timestamp()-interval '30 minutes' where id=v_session; insert into public.payment_events(payment_intent_id,event_type,server_recorded_at,details) select v_intent,'payment.provider_probe_empty',clock_timestamp()-interval '11 minutes','{}'::jsonb from generate_series(1,8); v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(s.result.enqueued, 1);
});
test('09 a checkout older than 48 h is still probed', () => {
  const s = runScenario(`update public.checkout_sessions set created_at=clock_timestamp()-interval '49 hours',expires_at=clock_timestamp()-interval '48 hours' where id=v_session; v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(s.result.enqueued, 1);
});
test('10 disconnect preflight counts a retryably rejected checkout as open', () => {
  const s = runScenario(`v_result:=${snap('rejected')}; v_extra:=public.mp_disconnect_preflight(v_business,'test');`);
  assert.ok(s.extra.open_payments >= 1);
});
test('11 a snapshot interrupted before finalization leaves exactly 2 units out of stock after expiry and the sweep', () => {
  const s = runScenario(`v_result:=${snap('approved')}; ${LAPSE} v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; perform public.expire_checkout_sessions(100);`);
  assert.equal(s.orders, 1); assert.equal(s.stock, 8);
  assert.equal(s.reservations.filter(r => r.status === 'converted').length, 1); assert.equal(s.reservations.filter(r => r.status === 'active').length, 0);
});
test('12 a payment to the wrong collector is blocked and never becomes an order', () => {
  const s = runScenario(`v_result:=${snap('approved', '991000001', `||jsonb_build_object('collector_id','other-seller')`)};`);
  assert.equal(s.result.reason, 'collector_mismatch'); assert.equal(s.orders, 0);
});
test('13 a payment with the wrong amount is blocked', () => {
  const s = runScenario(`v_result:=${snap('approved', '991000001', `||jsonb_build_object('transaction_amount','1.00')`)};`);
  assert.equal(s.result.reason, 'amount_mismatch'); assert.equal(s.orders, 0);
});
test('14 rejected then approved inside the same preference becomes one order', () => {
  const s = runScenario(`v_result:=${snap('rejected')}; v_result:=${snap('approved', '991000002')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate;`);
  assert.equal(s.orders, 1); assert.equal(s.intent.provider_id, '991000002'); assert.equal(s.stock, 8);
});
test('15 a refunded order cannot be prepared, dispatched or delivered', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('refunded', '991000001', `||jsonb_build_object('refunded_amount','2500.00')`)}; ${ACTOR} ${deliver('15')}`);
  assert.equal(s.extra.delivery.blocked, true); assert.equal(s.extra.delivery.sqlstate, '55000');
});
test('16 an external refund of 500 plus a local one of 250 totals 750', () => {
  const s = runScenario(`${approveAndFinalize} v_result:=${snap('approved', '991000001', `||jsonb_build_object('refunded_amount','500.00')`)}; ${ACTOR}
    v_extra:=public.prepare_payment_refund_v2(v_intent,250,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid; perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001'); perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',250,repeat('2',64));`);
  assert.equal(s.intent.refunded, 750);
});
test('17 an exception after reserving rolls the whole purchase back', () => {
  const s = runScenario(`v_before:=jsonb_build_object('stock',(select stock from public.products where id=v_product)); begin perform public.create_checkout_session(v_user,jsonb_build_object('business_id',v_business,'client_request_id','forensicfix000002','items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Synthetic audit','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago')); raise exception 'INJECTED_FAILURE_AFTER_RESERVE'; exception when others then v_extra:=jsonb_build_object('injected_error',SQLERRM); end;`);
  assert.equal(s.stock, s.before.stock);
});
test('18 recovery after an interrupted, expired reservation does not deduct twice (stock 8, one allocation)', () => {
  const s = runScenario(`v_result:=${snap('approved')}; ${LAPSE} v_result:=public.finalize_paid_checkout_session(v_session); ${ACTOR} v_result:=public.recover_paid_checkout_order(v_session); set constraints all immediate;`);
  assert.equal(s.stock, 8); assert.equal(s.orders, 1);
  assert.equal(s.reservations.filter(r => r.status === 'converted').reduce((a, r) => a + r.quantity, 0), 2);
});
test('19 recovery is refused while a refund is ambiguous', () => {
  const s = runScenario(`${LATE_IN_REVIEW} ${ACTOR} v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic'); perform public.mark_payment_refund_ambiguous((v_extra->>'refund_id')::uuid,repeat('3',64),'synthetic_lost_response');
    begin v_result:=public.recover_paid_checkout_order(v_session); v_extra:=jsonb_build_object('recovery','allowed'); exception when others then v_extra:=jsonb_build_object('recovery',SQLSTATE); end;`);
  assert.equal(s.extra.recovery, '55000'); assert.equal(s.orders, 0);
});
test('20 a newer rejection processed before the older approval does not block the purchase', () => {
  const s = runScenario(`v_result:=${snap('rejected', '991000002', `||jsonb_build_object('provider_occurred_at',(clock_timestamp()+interval '10 seconds')::text)`)}; v_result:=${snap('approved', '991000001')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate;`);
  assert.equal(s.orders, 1); assert.equal(s.intent.provider_id, '991000001');
});
test('21 a worker that died is replaced: the lease is reclaimed and the old owner cannot complete', () => {
  const s = runScenario(`insert into public.payment_outbox(payment_intent_id,topic) values(v_intent,'payment_reconcile'); select jsonb_agg(to_jsonb(j)) into v_before from public.claim_payment_outbox_v2('forensic-worker-one',1,15) j; perform public.start_payment_outbox_job((v_before->0->>'id')::uuid,'forensic-worker-one'); update public.payment_outbox set lease_expires_at=clock_timestamp()-interval '1 second' where payment_intent_id=v_intent; select jsonb_agg(to_jsonb(j)) into v_extra from public.claim_payment_outbox_v2('forensic-worker-two',1,15) j; v_result:=jsonb_build_object('old_owner_can_complete',public.complete_payment_outbox_job((v_before->0->>'id')::uuid,'forensic-worker-one'),'new_owner_can_start',public.start_payment_outbox_job((v_before->0->>'id')::uuid,'forensic-worker-two'));`);
  assert.equal(s.result.old_owner_can_complete, false); assert.equal(s.result.new_owner_can_start, true);
});
test('22 a duplicate webhook receipt yields one job', () => {
  const s = runScenario(`v_before:=public.record_mercadopago_webhook_receipt('test','forensic-duplicate','payment','991000001',true,'forensic-request',repeat('4',64)); v_extra:=public.record_mercadopago_webhook_receipt('test','forensic-duplicate','payment','991000001',true,'forensic-request',repeat('4',64)); v_result:=jsonb_build_object('jobs',(select count(*) from public.payment_outbox where webhook_receipt_id=(v_before->>'receipt_id')::uuid));`);
  assert.equal(s.result.jobs, 1);
});
test('23 client-side price and over-selling are rejected by the server', () => {
  const s = runScenario(`begin perform public.create_checkout_session(v_user,jsonb_build_object('business_id',v_business,'client_request_id','forensicfix000003','items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Synthetic audit','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago','total',1)); v_extra:=jsonb_build_object('price_rejected',false); exception when others then v_extra:=jsonb_build_object('price_rejected',true,'sqlstate',SQLSTATE); end;
    begin perform public.create_checkout_session(v_user,jsonb_build_object('business_id',v_business,'client_request_id','forensicfix000004','items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',9)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Synthetic audit','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago')); v_result:=jsonb_build_object('oversell_rejected',false); exception when others then v_result:=jsonb_build_object('oversell_rejected',true,'sqlstate',SQLSTATE); end;`);
  assert.equal(s.extra.price_rejected, true); assert.equal(s.result.oversell_rejected, true);
});
test('24 a fully refunded late payment cannot be recovered, prepared or delivered', () => {
  const s = runScenario(`${LATE_IN_REVIEW} ${FULL_REFUND}
    begin v_result:=public.recover_paid_checkout_order(v_session); v_order:=(v_result->>'order_id')::uuid; ${deliver('24')} exception when others then v_extra:=jsonb_build_object('recovery','blocked'); end;`);
  assert.equal(s.orders, 0); assert.equal(s.stock, 10); assert.notEqual(s.extra?.delivery?.status, 'delivered');
});
test('25 an open refund request deduplicates even with another UUID', () => {
  const s = runScenario(`${approveAndFinalize} ${ACTOR} v_before:=public.prepare_payment_refund_v2(v_intent,250,v_key,'forensic'); v_extra:=public.prepare_payment_refund_v2(v_intent,250,gen_random_uuid(),'forensic duplicate'); v_result:=jsonb_build_object('same_refund',v_before->>'refund_id'=v_extra->>'refund_id','count',(select count(*) from public.payment_refunds where payment_intent_id=v_intent and origin='local'));`);
  assert.equal(s.result.same_refund, true); assert.equal(s.result.count, 1);
});
test('26 disconnect after a retryable rejection is refused and keeps the credential', () => {
  const s = runScenario(`${CONNECT} v_result:=${snap('rejected')}; v_result:=public.mp_disconnect_checked(v_business,'test',true); select jsonb_build_object('status',status,'token_removed',protected_tokens is null) into v_extra from public.mp_seller_connections where business_id=v_business;`);
  assert.equal(s.result.ok, false); assert.equal(s.extra.token_removed, false); assert.equal(s.extra.status, 'connected');
});
