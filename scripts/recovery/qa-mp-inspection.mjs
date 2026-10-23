import assert from 'node:assert/strict';

const fields = {
  session: 'id,status,currency,subtotal,discount_total,delivery_fee,total,expires_at,completed_order_id,manual_review_reason,created_at,updated_at',
  intents: 'id,internal_status,environment,expected_amount,paid_amount,currency,external_reference,provider_payment_id,provider_status,provider_status_detail,live_mode,approved_at,rejected_at,refunded_amount,order_id,security_review_reason',
  payments: 'provider_payment_id,environment,seller_id,status,status_detail,amount,currency,refunded_amount,is_financing,validation_error,watch_state,next_check_at,first_seen_at,last_seen_at',
  attempts: 'id,attempt_number,attempt_type,status,preference_id,last_error_code,created_at',
  receipts: 'event_type,resource_id,signature_valid,processing_status,attempt_count,received_at,processed_at,last_error',
  outbox: 'id,topic,resource_id,status,attempts,interruptions,last_error,next_attempt_at,completed_at',
  orders: 'id,public_code,status,payment_method,payment_status,manual_payment_status,total,currency_code,created_at,cancelled_at',
  reservations: 'product_id,quantity,status,expires_at,released_at,release_reason,converted_at',
  refunds: 'id,status,origin,amount,provider_refund_id,idempotency_key,requested_at,completed_at',
  cancellations: 'id,status,idempotency_key,requested_at,completed_at',
  discrepancies: 'id,kind,severity,status,provider_payment_id,provider_refund_id,first_detected_at,last_detected_at,resolution',
  ledger: 'environment,watermark_at,window_begin,window_end,next_offset',
};
const pick=(row,key)=>Object.fromEntries(fields[key].split(',').filter(f=>f in row).map(f=>[f,row[f]]));
async function read(request,label) {
  const {data,error}=await request;
  // Never turn a failed financial read into an apparently clean empty array.
  if(error) throw Error(`QA inspection could not read ${label} (${error.code || 'unknown'})`);
  return data;
}
export async function inspectPaymentSession(db,sessionId,businessId) {
  const session=await read(db.from('checkout_sessions').select('*').eq('id',sessionId).maybeSingle(),'session');
  assert.ok(session,'checkout session not found');
  assert.equal(session.business_id,businessId,'only the selected QA tenant is inspected');
  const intents=await read(db.from('payment_intents').select('*').eq('checkout_session_id',sessionId),'intents') || [];
  for(const i of intents) {
    assert.equal(i.business_id,businessId,'intent tenant mismatch');
    assert.equal(i.environment,'test','test payment intents only');
  }
  const ids=intents.map(i=>i.id), result={session:pick(session,'session'),intents:intents.map(i=>pick(i,'intents'))};
  for(const [key,table] of Object.entries({payments:'payment_provider_payments',attempts:'payment_attempts',
    outbox:'payment_outbox',refunds:'payment_refunds',cancellations:'payment_cancellations',discrepancies:'payment_discrepancies'})) {
    const rows=ids.length?await read(db.from(table).select('*').in('payment_intent_id',ids),key) || []:[];
    result[key]=rows.map(row=>pick(row,key));
  }
  const paymentIds=[...new Set([...intents.map(i=>i.provider_payment_id),...result.payments.map(p=>p.provider_payment_id)].filter(Boolean).map(String))];
  const receipts=paymentIds.length?await read(db.from('payment_webhook_receipts').select('*').eq('seller_business_id',businessId)
    .eq('environment','test').in('resource_id',paymentIds),'receipts') || []:[];
  result.receipts=receipts.map(row=>pick(row,'receipts'));
  const orderIds=[...new Set([session.completed_order_id,...intents.map(i=>i.order_id)].filter(Boolean))];
  const orders=orderIds.length?await read(db.from('orders').select('*').eq('business_id',businessId).in('id',orderIds),'orders') || []:[];
  result.orders=orders.map(row=>pick(row,'orders'));
  result.reservations=(await read(db.from('inventory_reservations').select('*').eq('checkout_session_id',sessionId),'reservations') || []).map(row=>pick(row,'reservations'));
  result.ledger=(await read(db.from('provider_ledger_cursors').select('*').eq('business_id',businessId),'ledger') || []).map(row=>pick(row,'ledger'));
  result.stock=await read(db.from('products').select('sku,stock').eq('business_id',businessId).order('sku'),'stock') || [];
  return result;
}
