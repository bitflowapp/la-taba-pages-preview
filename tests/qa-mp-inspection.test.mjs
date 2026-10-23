import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPaymentSession } from '../scripts/recovery/qa-mp-inspection.mjs';

function fake({fail,tenant='qa',environment='test'}={}) {
  const seen=[];
  const data={checkout_sessions:{id:'s',business_id:tenant},payment_intents:[{id:'i',business_id:'qa',environment,provider_payment_id:'approved'}],
    payment_provider_payments:[{provider_payment_id:'rejected',status:'rejected'},{provider_payment_id:'approved',status:'approved',is_financing:true}],
    payment_webhook_receipts:[{resource_id:'rejected',signature_valid:true}],provider_ledger_cursors:[{environment:'test',watermark_at:'cursor'}]};
  return {seen,from(table){
    const filters=[]; seen.push({table,filters});
    const builder={select(){return builder;},eq(...args){filters.push(['eq',...args]);return builder;},
      in(...args){filters.push(['in',...args]);return builder;},order(){return builder;},maybeSingle(){return builder;},
      then(resolve,reject){return Promise.resolve(table===fail?{error:{code:'42501'}}:{data:data[table] || []}).then(resolve,reject);}};
    return builder;
  }};
}
test('inspection includes rejected and financing payments plus all their receipts and independent ledger position',async()=>{
  const db=fake(),r=await inspectPaymentSession(db,'s','qa');
  assert.equal(r.payments.length,2);
  assert.equal(r.receipts[0].resource_id,'rejected');
  assert.equal(r.ledger[0].watermark_at,'cursor');
  const receipts=db.seen.find(x=>x.table==='payment_webhook_receipts');
  assert.deepEqual(receipts.filters,[['eq','seller_business_id','qa'],['eq','environment','test'],['in','resource_id',['approved','rejected']]]);
});
test('financial read errors cannot appear as clean empty results',async()=>{
  for(const table of ['payment_provider_payments','payment_refunds','provider_ledger_cursors','checkout_sessions'])
    await assert.rejects(inspectPaymentSession(fake({fail:table}),'s','qa'),/QA inspection could not read/);
});
test('inspection rejects a different business and production intent before any payment details are read',async()=>{
  await assert.rejects(inspectPaymentSession(fake({tenant:'other'}),'s','qa'),/selected QA tenant/);
  await assert.rejects(inspectPaymentSession(fake({environment:'production'}),'s','qa'),/test payment intents only/);
});
