// QA payment 185083342105 (ARS 350, OTHE card) answered in_process / deferred_retry and its reservation lapsed. Until the
// provider says approved or rejected the money is UNCERTAIN: no order, no refund, no "rejected" label; and if the provider
// approves later, the purchase must become exactly one order with stock moved once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap, EXPIRE } from './harness.mjs';

const finalize = `if (v_result->>'finalize_required')::boolean then v_result:=public.finalize_paid_checkout_session(v_session); end if; set constraints all immediate;`;

test('in_process creates no order, moves no stock and is not treated as rejected or paid', () => {
  const s = runScenario(`v_result:=${snap('in_process', '991000002')};`);
  assert.equal(s.orders, 0);
  assert.equal(s.stock, 8, 'the reservation (not a sale) still holds the units');
  assert.notEqual(s.intent.status, 'completed');
  assert.notEqual(s.intent.status, 'rejected');
  assert.equal(s.intent.provider_status, 'in_process');
  assert.equal(s.intent.refunded, 0);
});

test('in_process, then the reservation lapses, then the provider approves: exactly one order and the stock moves once', () => {
  const s = runScenario(`v_result:=${snap('in_process', '991000002')}; ${EXPIRE}
    v_before:=jsonb_build_object('orders',(select count(*) from public.orders where business_id=v_business),'stock',(select stock from public.products where id=v_product));
    v_result:=${snap('approved', '991000002')}; ${finalize}
    v_extra:=${snap('approved', '991000002')}; ${finalize}`);
  assert.equal(s.before.orders, 0, 'nothing is sold while the payment is only in process');
  assert.equal(s.orders, 1, 'the late approval must not vanish and must not duplicate');
  assert.equal(s.stock, 8, 'two units left stock exactly once, also when the same approval is replayed');
});

test('in_process followed by a rejection frees the purchase without an order and without a refund', () => {
  const s = runScenario(`v_result:=${snap('in_process', '991000002')}; ${EXPIRE} v_result:=${snap('rejected', '991000002')};`);
  assert.equal(s.orders, 0);
  assert.equal(s.stock, 10);
  assert.equal(s.intent.refunded, 0);
});
