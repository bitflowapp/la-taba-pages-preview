// Scenario harness for financial-integrity tests against a disposable local PostgreSQL.
//
// Every scenario runs inside ONE transaction that always rolls back, on top of a fixture business that is
// built by the repository's own SQL test fixture (supabase/tests/mercadopago_rejected_retry.local.sql).
// The payment provider is simulated: the snapshots are built here and handed to the real SQL functions, so
// the state machine, constraints and locks under test are the production ones.
//
// Requires a cluster on 127.0.0.1 (scripts/local-db/bootstrap.mjs). Never connects to a hosted project.
import fs from 'node:fs';
import path from 'node:path';
import { psqlRaw, ROOT } from '../../scripts/local-db/lib.mjs';

export const DB = process.env.TABA_LOCAL_DB || 'taba_local_base';

const fixtureSource = fs.readFileSync(path.join(ROOT, 'supabase/tests/mercadopago_rejected_retry.local.sql'), 'utf8');
const fixtureStart = fixtureSource.indexOf('do $$');
const fixtureEnd = fixtureSource.indexOf('  -- Three purchases');
if (fixtureStart < 0 || fixtureEnd < 0) throw new Error('fixture markers changed in mercadopago_rejected_retry.local.sql');

const PREFIX = fixtureSource
  .slice(fixtureStart, fixtureEnd)
  .replaceAll('0000000000e1', '0000000000fa')
  .replaceAll('mp-retry', 'forensic-fix')
  .replace('v_counter integer := 0;', 'v_counter integer := 0; v_extra jsonb; v_before jsonb; v_refund uuid; v_key uuid := gen_random_uuid(); v_extra2 jsonb; v_refund2 uuid; v_pay jsonb; v_disc jsonb;');

const CHECKOUT = `
v_result := public.create_checkout_session(v_user,jsonb_build_object('business_id',v_business,'client_request_id','forensicfix000001','items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Synthetic audit','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago'));
v_session := (v_result->>'checkout_session_id')::uuid;
v_prepare := public.prepare_mercadopago_preference(v_session,v_user,false);
perform public.record_mercadopago_preference_created((v_prepare->>'payment_attempt_id')::uuid,'FORENSIC-PREF','https://www.mercadopago.com/checkout/v1/redirect?pref_id=FORENSIC-PREF',null,repeat('e',64),'forensic-request');
select id into v_intent from public.payment_intents where checkout_session_id=v_session;
`;

/** SQL expression: a provider snapshot recorded against the fixture intent. */
export const snap = (status, id = '991000001', extra = '') =>
  `public.record_mercadopago_payment_snapshot(v_intent,jsonb_build_object('provider_payment_id','${id}','external_reference','taba2:checkout:'||v_session::text,'preference_id','FORENSIC-PREF','merchant_order_id','FORENSIC-MO','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','${status}','payment_method','visa','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64)) ${extra},'reconciliation',null)`;

/** Makes the fixture owner the authenticated actor (panel operator). */
export const ACTOR = `insert into public.business_members(business_id,user_id,role,is_active) values(v_business,v_user,'owner',true); perform set_config('request.jwt.claim.sub',v_user::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated','session_id',v_key,'iat',extract(epoch from clock_timestamp()))::text,true); insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values(v_key,v_user,v_business,'owner','panel_web');`;

/** The reservation window closes and the sweep releases the stock (customer abandoned, payment arrives later). */
export const EXPIRE = `update public.checkout_sessions set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' where id=v_session; perform public.release_checkout_session_inventory(v_session,'forensic_expiry','expired');`;

/** The reservation window lapses but nothing has swept it yet: stock is still held by the reservation. */
export const LAPSE = `update public.checkout_sessions set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' where id=v_session; update public.inventory_reservations set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' where checkout_session_id=v_session;`;

/** Full refund of the fixture payment through the real refund functions (provider response simulated). */
export const FULL_REFUND = `${ACTOR} v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid; perform public.record_payment_refund_identity(v_refund,v_intent,'991000001',v_key,'881000001'); perform public.record_payment_refund_response_v2(v_refund,'881000001','approved',2500,repeat('2',64));`;

/** Order progress to delivered via the real command RPC; returns the failure instead of aborting. */
export const deliver = tag => `begin
 select public.transition_order(v_order,revision,'accepted','fx-accept-${tag}') into v_extra2 from public.orders where id=v_order;
 select public.transition_order(v_order,revision,'preparing','fx-prepare-${tag}') into v_extra2 from public.orders where id=v_order;
 select public.transition_order(v_order,revision,'ready','fx-ready-${tag}') into v_extra2 from public.orders where id=v_order;
 select public.transition_order(v_order,revision,'delivered','fx-deliver-${tag}') into v_extra2 from public.orders where id=v_order;
 v_extra:=coalesce(v_extra,'{}'::jsonb)||jsonb_build_object('delivery',jsonb_build_object('status',v_extra2->>'status'));
exception when others then v_extra:=coalesce(v_extra,'{}'::jsonb)||jsonb_build_object('delivery',jsonb_build_object('blocked',true,'sqlstate',SQLSTATE,'message',SQLERRM)); end;`;

function tail() {
  return `
  if to_regclass('public.payment_provider_payments') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',provider_payment_id,''status'',status,''financing'',is_financing) order by provider_payment_id),''[]''::jsonb) from public.payment_provider_payments where payment_intent_id=$1' into v_pay using v_intent;
  end if;
  if to_regclass('public.payment_discrepancies') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''kind'',kind,''status'',status,''severity'',severity) order by kind),''[]''::jsonb) from public.payment_discrepancies where payment_intent_id=$1' into v_disc using v_intent;
  end if;
  insert into forensic_result select jsonb_build_object(
    'result',v_result,'extra',v_extra,'before',v_before,
    'intent',(select jsonb_build_object('status',internal_status,'provider_id',provider_payment_id,'provider_status',provider_status,'paid',paid_amount,'refunded',refunded_amount,'order_id',order_id,'review',security_review_reason) from public.payment_intents where id=v_intent),
    'session',(select jsonb_build_object('status',status,'order_id',completed_order_id,'review',manual_review_reason) from public.checkout_sessions where id=v_session),
    'stock',(select stock from public.products where id=v_product),
    'orders',(select count(*) from public.orders where business_id=v_business),
    'order_status',(select jsonb_agg(status) from public.orders where business_id=v_business),
    'reservations',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'quantity',quantity,'generation',reservation_generation) order by reservation_generation,created_at),'[]'::jsonb) from public.inventory_reservations where checkout_session_id=v_session),
    'refunds',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'amount',amount,'provider_refund_id',provider_refund_id) order by requested_at),'[]'::jsonb) from public.payment_refunds where payment_intent_id=v_intent),
    'payments',v_pay,'discrepancies',v_disc);
end; $$; set constraints all immediate; select * from forensic_result; rollback;`;
}

export function scenarioSql(body) {
  return `begin; set local statement_timeout='30s'; set local lock_timeout='5s'; create temp table forensic_result(result jsonb); ${PREFIX}${CHECKOUT}${body}${tail()}`;
}

/** Runs one scenario and returns the parsed state. Failures of the SQL itself are thrown. */
export function runScenario(body) {
  const r = psqlRaw(DB, scenarioSql(body), { tuples: true, timeout: 120000 });
  const line = r.stdout.split('\n').map(s => s.trim()).filter(s => s.startsWith('{')).pop();
  if (!line) throw new Error('scenario produced no state: ' + r.stdout.slice(0, 500));
  return JSON.parse(line);
}

/** Runs a scenario that is expected to raise; returns the message. */
export function runScenarioExpectingError(body) {
  const r = psqlRaw(DB, scenarioSql(body), { tuples: true, check: false, timeout: 120000 });
  if (r.status === 0) throw new Error('scenario unexpectedly succeeded');
  return String(r.stderr);
}
