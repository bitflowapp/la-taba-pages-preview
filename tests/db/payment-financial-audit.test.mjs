import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap, ACTOR } from './harness.mjs';

const paid = `v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; v_order:=(v_result->>'order_id')::uuid;`;
const pendingRefund = evidence => `${paid} ${ACTOR}
  v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'independent audit synthetic');
  v_refund:=(v_extra->>'refund_id')::uuid;
  perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'response_lost');
  perform public.park_refund_identity_unknown(v_refund,'${JSON.stringify({provider_refunds:evidence})}'::jsonb);`;
const resolve = `begin
  v_result:=public.resolve_ambiguous_refund(v_refund,'executed','881000009','synthetic operator selects visible provider refund');
  v_extra:=jsonb_build_object('accepted',true);
exception when others then v_extra:=jsonb_build_object('accepted',false,'code',SQLSTATE); end;`;

for (const [name, evidence] of [
  ['wrong amount',[{id:'881000009',amount:500,status:'approved'}]],
  ['rejected refund',[{id:'881000009',amount:2500,status:'rejected'}]],
  ['pending refund',[{id:'881000009',amount:2500,status:'in_process'}]],
  ['no provider evidence',[]],
]) test(`manual resolution cannot assert full refund with ${name}`, () => {
  const s=runScenario(`${pendingRefund(evidence)} ${resolve}`);
  console.log(JSON.stringify({case:name,accepted:s.extra.accepted,recordedRefunded:s.intent.refunded,refunds:s.refunds}));
  assert.equal(s.extra.accepted,false,'unverified operator selection fabricated a financial result');
  assert.equal(s.intent.refunded,0);
});

test('control: a matching approved provider refund can be resolved once',()=>{
  const s=runScenario(`${pendingRefund([{id:'881000009',amount:2500,status:'approved'}])} ${resolve}`);
  assert.equal(s.extra.accepted,true); assert.equal(s.intent.refunded,2500);
});

test('regression: stale approval cannot undo a provider refund',()=>{
  const s=runScenario(`${paid} v_result:=${snap('refunded')}; v_extra:=${snap('approved')};`);
  assert.equal(s.intent.refunded,2500); assert.equal(s.extra.stale,true); assert.equal(s.orders,1);
});

for (const [field,value,reason] of [['transaction_amount','1.00','amount_mismatch'],['currency','USD','currency_mismatch'],['collector_id','foreign-seller','collector_mismatch'],['external_reference','foreign-checkout','external_reference_mismatch'],['application_id','other-app','application_mismatch']]) {
  test(`control: provider ${field} mismatch cannot create a paid order`,()=>{
    const s=runScenario(`v_result:=${snap('approved','991000001',`||jsonb_build_object('${field}','${value}')`)};`);
    assert.equal(s.result.reason,reason); assert.equal(s.orders,0);
  });
}

test('control: unauthenticated client cannot call payment snapshot recorder or read seller tokens',()=>{
  const s=runScenario(`v_extra:=jsonb_build_object('anon_snapshot',has_function_privilege('anon','public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)','EXECUTE'),'auth_snapshot',has_function_privilege('authenticated','public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)','EXECUTE'),'auth_tokens',has_table_privilege('authenticated','public.mp_seller_connections','SELECT'));`);
  assert.deepEqual(s.extra,{anon_snapshot:false,auth_snapshot:false,auth_tokens:false});
});

const cart = `jsonb_build_object('business_id',v_business,'client_request_id','independentcart00001','items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Synthetic audit','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago')`;
for(const [label,mutation] of [
  ['browser total',`||jsonb_build_object('total',1)`],
  ['browser currency',`||jsonb_build_object('currency','USD')`],
  ['browser unit price',`||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2,'unit_price',0.01)))`],
  ...[-1,0,1.5,1001].map(n=>[`quantity ${n}`,`||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',${n})))`]),
])test(`control: reject ${label} without consuming extra stock`,()=>{
  const s=runScenario(`begin perform public.create_checkout_session(v_user,${cart}${mutation});v_extra:=jsonb_build_object('accepted',true);
    exception when others then v_extra:=jsonb_build_object('accepted',false,'sqlstate',SQLSTATE);end;`);
  assert.equal(s.extra.accepted,false);assert.equal(s.stock,8);assert.equal(s.orders,0);
});

test('control: checkout retries reuse the session; changed quantity with the same key is rejected',()=>{
  const s=runScenario(`v_extra:=public.create_checkout_session(v_user,${cart});
    v_extra2:=public.create_checkout_session(v_user,${cart});
    v_before:=jsonb_build_object('same_session',v_extra->>'checkout_session_id'=v_extra2->>'checkout_session_id');
    begin perform public.create_checkout_session(v_user,${cart}||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1))));
    v_before:=v_before||jsonb_build_object('alteration_accepted',true);
    exception when others then v_before:=v_before||jsonb_build_object('alteration_accepted',false);end;`);
  assert.equal(s.before.same_session,true);assert.equal(s.before.alteration_accepted,false);assert.equal(s.stock,6);
});

test('control: a new refund UUID cannot bypass an existing ambiguous refund',()=>{
  const s=runScenario(`${pendingRefund([])} v_extra2:=public.prepare_payment_refund_v2(v_intent,500,gen_random_uuid(),'second click');`);
  assert.equal(s.extra2.refund_id,s.extra.refund_id);assert.equal(s.extra2.reconciliation_required,true);
  assert.equal(s.refunds.length,1);assert.equal(s.refunds[0].status,'ambiguous');
});

test('an operator cannot unlock another refund by declaring an unknown request not executed',()=>{
  const s=runScenario(`${pendingRefund([{id:'881000009',amount:2500,status:'approved'}])}
    begin perform public.resolve_ambiguous_refund(v_refund,'not_executed',null,'operator assumes the lost response meant no refund');
      v_extra2:=jsonb_build_object('accepted',true);
    exception when others then v_extra2:=jsonb_build_object('accepted',false,'code',SQLSTATE); end;
    v_result:=public.prepare_payment_refund_v2(v_intent,500,gen_random_uuid(),'another attempt');`);
  assert.equal(s.extra2.accepted,false);
  assert.equal(s.refunds.length,1);
  assert.equal(s.refunds[0].status,'ambiguous');
  assert.equal(s.result.reconciliation_required,true);
});
