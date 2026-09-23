import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSupabaseManualPaymentsRepository } from '../js/repositories/supabase-manual-payments-repository.js';
import { renderPaymentsSurface } from '../js/business/business-panel-render.js';

test('manual payment repository scopes list to one business and never calls provider APIs', async () => {
  const calls=[];
  const query={select(fields){calls.push(['select',fields]);return this},eq(field,value){calls.push(['eq',field,value]);return this},
    in(field,values){calls.push(['in',field,values]);return this},order(field,options){calls.push(['order',field,options]);return this},
    limit(n){calls.push(['limit',n]);return Promise.resolve({data:[],error:null})}};
  const client={from(table){calls.push(['from',table]);return query},async rpc(name,args){calls.push(['rpc',name,args]);return {data:{ok:true},error:null}}};
  const repository=createSupabaseManualPaymentsRepository({client,businessId:'qa-business'});
  assert.deepEqual(await repository.list(),{ok:true,data:[]});
  assert.deepEqual(calls.find(c=>c[0]==='eq'&&c[1]==='business_id'),['eq','business_id','qa-business']);
  assert.deepEqual(calls.find(c=>c[0]==='eq'&&c[1]==='origin'),['eq','origin','production']);
  assert.deepEqual(calls.find(c=>c[0]==='in'),['in','payment_method',['cash','coordinate']]);
  await repository.confirm({orderId:'o',expectedRevision:3,actualMethod:'cash',idempotencyKey:'qa-valid-123'});
  await repository.reverse({orderId:'o',expectedRevision:4,reason:'QA reversal',idempotencyKey:'qa-valid-456'});
  assert.deepEqual(calls.filter(c=>c[0]==='rpc').map(c=>c[1]),['confirm_manual_order_payment','reverse_manual_order_payment']);
  assert.equal(calls.some(c=>JSON.stringify(c).includes('mercadopago')),false);
});

test('panel distinguishes pending, paid and reversed without offering a staff refund', () => {
  const base={id:'00000000-0000-4000-8000-000000000001',public_code:'LT-QA',revision:3,total:1000,
    currency_code:'ARS',payment_method:'cash',status:'delivered'};
  const render=(status,role='admin')=>renderPaymentsSurface({payments:[],status:{phase:'ready'},
    manualPayments:[{...base,manual_payment_status:status,manual_payment_method:'cash'}],
    manualStatus:{phase:'ready'},role,connection:{status:'unavailable'},busy:false});
  assert.match(render('pending'),/Cobros manuales/);
  assert.match(render('pending'),/data-manual-payment-status="pending"/);
  assert.match(render('pending'),/data-manual-payment-confirm/);
  assert.doesNotMatch(render('pending'),/data-manual-payment-reverse/);
  assert.match(render('confirmed'),/data-manual-payment-status="confirmed"/);
  assert.match(render('confirmed'),/data-manual-payment-reverse/);
  assert.doesNotMatch(render('confirmed','staff'),/data-manual-payment-reverse/);
  assert.match(render('reversed'),/data-manual-payment-status="reversed"/);
  assert.doesNotMatch(render('reversed'),/data-manual-payment-confirm/);
  const cancelled = renderPaymentsSurface({payments:[],status:{phase:'ready'},
    manualPayments:[{...base,status:'cancelled',manual_payment_status:'pending'}],
    manualStatus:{phase:'ready'},role:'admin',connection:{status:'unavailable'},busy:false});
  assert.match(cancelled,/Cerrado sin cobrar/);
  assert.doesNotMatch(cancelled,/data-manual-payment-confirm/);
});

test('migration keeps manual payments separate from MP and grants no anon execution', () => {
  const sql=readFileSync(new URL('../supabase/migrations/20260923064927_commercial_pilot_manual_payment.sql',import.meta.url),'utf8');
  assert.match(sql,/create or replace function public\.confirm_manual_order_payment/);
  assert.match(sql,/create or replace function public\.reverse_manual_order_payment/);
  assert.match(sql,/revoke all on function public\.confirm_manual_order_payment\(uuid,bigint,text,text\) from public, anon/);
  assert.match(sql,/old\.manual_payment_status = 'confirmed'/);
  assert.match(sql,/insert into public\.order_events/);
  assert.doesNotMatch(sql,/insert into public\.payment_intents|mercadopago-refund|\/v1\/payments/i);
});
