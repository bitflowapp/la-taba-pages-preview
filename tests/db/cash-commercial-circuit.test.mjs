// Real order, manual collection, delivery and cancellation RPCs. Rollback only;
// the sibling MP intent from the harness must remain financially independent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, ACTOR, deliver } from './harness.mjs';

const CASH=`${ACTOR}
  perform public.upsert_current_customer_profile('Synthetic cash buyer','2995550811');
  v_extra:=public.create_order_with_items(jsonb_build_object(
    'business_id',v_business,'client_request_id','cashcommercial0001','tracking_token',repeat('x',43),
    'items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),
    'customer_name','Synthetic cash buyer','customer_phone','2995550811','delivery_mode','pickup',
    'payment_method','cash','age_confirmed',true,'customer_notes','QA no entregar'));
  v_order:=(v_extra->>'id')::uuid;
  if v_order is null then raise exception 'cash order missing'; end if;
  if exists(select 1 from public.payment_intents where order_id=v_order)
    then raise exception 'cash order has a provider intent'; end if;
  select revision into v_stock from public.orders where id=v_order;
  v_extra:=public.confirm_manual_order_payment(v_order,v_stock,'cash','cash-confirm-0001');
  v_extra2:=public.confirm_manual_order_payment(v_order,v_stock,'cash','cash-confirm-0001');
  if not coalesce((v_extra2->>'idempotent_replay')::boolean,false)
    then raise exception 'cash confirmation was not idempotent'; end if;
  if (select count(*) from public.order_events where order_id=v_order and event_type='order.manual_payment_confirmed')<>1
    then raise exception 'cash collection event duplicated'; end if;
`;
test('cash checkout reserves once, records collection once, prepares and delivers with no provider payment',()=>{
  const r=runScenario(`${CASH} ${deliver('cash-commercial')}
    v_extra:=v_extra||jsonb_build_object('cash_status',(select manual_payment_status from public.orders where id=v_order));`);
  assert.equal(r.stock,7); // 2 held by independent MP checkout, 1 by cash order
  assert.equal(r.orders,1);
  assert.deepEqual(r.order_status,['delivered']);
  assert.equal(r.extra.cash_status,'confirmed');
  assert.equal(r.intent.paid,null);
  assert.equal(r.intent.status,'preference_created');
  assert.equal(r.intent.provider_id,null);
  assert.equal(r.intent.refunded,0);
});
test('a collected cash order requires a recorded reversal before cancellation and restocks only once',()=>{
  const r=runScenario(`${CASH}
    begin
      perform public.cancel_order(v_order,(select revision from public.orders where id=v_order),'QA cancel','cash-cancel-blocked');
      raise exception 'collected cash order cancelled without a reversal';
    exception when sqlstate '55000' then null; end;
    select revision into v_stock from public.orders where id=v_order;
    v_extra:=public.reverse_manual_order_payment(v_order,v_stock,'QA cash returned','cash-reverse-0001');
    v_extra2:=public.reverse_manual_order_payment(v_order,v_stock,'QA cash returned','cash-reverse-0001');
    if not coalesce((v_extra2->>'idempotent_replay')::boolean,false) then raise exception 'cash reversal was not idempotent'; end if;
    select revision into v_stock from public.orders where id=v_order;
    v_extra:=public.cancel_order(v_order,v_stock,'QA cash returned','cash-cancel-0001');
    v_extra2:=public.cancel_order(v_order,v_stock,'QA cash returned','cash-cancel-0001');
    v_extra:=v_extra||jsonb_build_object('cash_status',(select manual_payment_status from public.orders where id=v_order),
      'reversal_events',(select count(*) from public.order_events where order_id=v_order and event_type='order.manual_payment_reversed'));
  `);
  assert.equal(r.stock,8);
  assert.deepEqual(r.order_status,['cancelled']);
  assert.equal(r.extra.cash_status,'reversed');
  assert.equal(r.extra.reversal_events,1);
  assert.equal(r.intent.paid,null);
  assert.equal(r.intent.status,'preference_created');
  assert.equal(r.intent.provider_id,null);
  assert.equal(r.intent.refunded,0);
});
