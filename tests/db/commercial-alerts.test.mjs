// What the business panel is told, and how loudly (migration 20261024010000), on real PostgreSQL.
// Before the migration an abandoned Mercado Pago checkout was CRITICAL for about a day even while every read of the
// provider came back empty, and a fully refunded order that was still open only raised ORDER_NOT_ACCEPTED («aceptalo o
// cancelalo»), whose first option the database refuses. Run against a database without the migration these fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap, ACTOR } from './harness.mjs';

const CONNECT = `insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values(v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '1 day');`;
const SESSION_AGE = (created, expires) => `update public.checkout_sessions set created_at=clock_timestamp()-interval '${created}',expires_at=clock_timestamp()-interval '${expires}' where id=v_session;`;
const EMPTY_PROBES = (n, ago) => `insert into public.payment_events(payment_intent_id,event_type,server_recorded_at,details) select v_intent,'payment.provider_probe_empty',clock_timestamp()-interval '${ago}','{}'::jsonb from generate_series(1,${n});`;
const ABANDONED = `update public.payment_intents set internal_status='expired' where id=v_intent;`;
const RECONCILE = `perform public.reconcile_operational_alerts_for_business(v_business);`;
const OPEN_ALERTS = `(select coalesce(jsonb_agg(jsonb_build_object('code',alert_code,'severity',severity,'verification',evidence->>'verification','id',id) order by alert_code),'[]'::jsonb) from public.operational_alerts where business_id=v_business and status<>'resolved')`;
const APPROVE_AND_FINALIZE = `v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate; v_order:=(v_result->>'order_id')::uuid;`;
// The order waited 30 minutes without anyone accepting it; it is a production order (not a QA one), so the
// «not accepted» alert would apply to it. Triggers are off only for this bookkeeping.
const AGED_PRODUCTION_ORDER = `set local session_replication_role=replica; update public.orders set created_at=clock_timestamp()-interval '30 minutes', origin='production' where id=v_order; set local session_replication_role=origin;`;
const EXTERNAL_FULL_REFUND = `v_extra:=${snap('refunded', '991000001', `||jsonb_build_object('refunded_amount','2500.00')`)};`;

const byCode = (alerts, code) => (alerts || []).filter((a) => a.code === code);

// ---- 1. an abandoned checkout is watched, not an emergency ------------------------------------------------------
test('an abandoned checkout the provider keeps answering about is INFO while it is watched', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('2 hours', '1 hour')} ${EMPTY_PROBES(12, '5 minutes')} ${ABANDONED} ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  const [alert] = byCode(s.result.alerts, 'CHECKOUT_PROVIDER_UNVERIFIED');
  assert.ok(alert, 'the watch stays visible (F08): the alert is still open until closed with evidence');
  assert.equal(alert.severity, 'INFO');
  assert.equal(alert.verification, 'watching');
});

test('a checkout the provider was never asked about stays CRITICAL: nobody knows whether someone paid', () => {
  const s = runScenario(`${SESSION_AGE('2 hours', '1 hour')} ${ABANDONED} ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  const [alert] = byCode(s.result.alerts, 'CHECKOUT_PROVIDER_UNVERIFIED');
  assert.equal(alert.severity, 'CRITICAL');
  assert.equal(alert.verification, 'never_verified');
});

test('a watch whose last answer is more than 3 hours old is CRITICAL again: the verification stopped', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('10 hours', '9 hours')} ${EMPTY_PROBES(20, '5 hours')} ${ABANDONED} ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  const [alert] = byCode(s.result.alerts, 'CHECKOUT_PROVIDER_UNVERIFIED');
  assert.equal(alert.severity, 'CRITICAL');
  assert.equal(alert.verification, 'verification_stalled');
});

test('the same alert row lowers its severity once the provider answers, and closes when a payment appears', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('2 hours', '1 hour')} ${ABANDONED} ${RECONCILE}
    v_before:=jsonb_build_object('alerts',${OPEN_ALERTS});
    ${EMPTY_PROBES(1, '1 minute')} ${RECONCILE}
    v_extra:=jsonb_build_object('alerts',${OPEN_ALERTS});
    update public.payment_intents set provider_payment_id='991000077' where id=v_intent; ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  const [before] = byCode(s.before.alerts, 'CHECKOUT_PROVIDER_UNVERIFIED');
  const [after] = byCode(s.extra.alerts, 'CHECKOUT_PROVIDER_UNVERIFIED');
  assert.equal(before.severity, 'CRITICAL');
  assert.equal(after.severity, 'INFO');
  assert.equal(after.id, before.id, 'one alert per checkout: the row is updated, not duplicated');
  assert.deepEqual(byCode(s.result.alerts, 'CHECKOUT_PROVIDER_UNVERIFIED'), [], 'a payment from the provider closes it as before');
});

// ---- 2. a refunded order that is still open says it has to be closed ---------------------------------------------
test('control: an unpaid-back order nobody accepted raises ORDER_NOT_ACCEPTED and no refund alert', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE} ${AGED_PRODUCTION_ORDER} ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  assert.equal(byCode(s.result.alerts, 'ORDER_NOT_ACCEPTED').length, 1);
  assert.deepEqual(byCode(s.result.alerts, 'ORDER_PAYMENT_REVERSED_OPEN'), []);
});

test('a fully refunded order that is still open raises ORDER_PAYMENT_REVERSED_OPEN instead of «accept it»', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE} ${AGED_PRODUCTION_ORDER} ${EXTERNAL_FULL_REFUND} ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  const [alert] = byCode(s.result.alerts, 'ORDER_PAYMENT_REVERSED_OPEN');
  assert.ok(alert, 'the refunded order is flagged');
  assert.equal(alert.severity, 'ACTION_REQUIRED');
  assert.deepEqual(byCode(s.result.alerts, 'ORDER_NOT_ACCEPTED'), [], 'no instruction the database would refuse');
  assert.deepEqual(s.order_status, ['received']);
  assert.equal(s.intent.refunded, 2500);
});

test('cancelling the refunded order closes the alert and returns the stock once', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE} ${AGED_PRODUCTION_ORDER} ${EXTERNAL_FULL_REFUND} ${RECONCILE}
    v_before:=jsonb_build_object('stock',(select stock from public.products where id=v_product),'revision',(select revision from public.orders where id=v_order));
    ${ACTOR}
    v_extra2:=public.cancel_order(v_order,(v_before->>'revision')::bigint,'pago devuelto al cliente','refunded-order-0001');
    v_extra2:=public.cancel_order(v_order,(v_before->>'revision')::bigint,'pago devuelto al cliente','refunded-order-0001');
    ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  assert.equal(s.before.stock, 8);
  assert.equal(s.stock, 10, 'the two units come back exactly once, even with the command repeated');
  assert.equal(s.extra2.idempotent_replay, true);
  assert.deepEqual(s.order_status, ['cancelled']);
  assert.deepEqual(byCode(s.result.alerts, 'ORDER_PAYMENT_REVERSED_OPEN'), []);
});

test('a partial refund does not stop the order: no refund alert, and an unaccepted order is still reported', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE} ${AGED_PRODUCTION_ORDER}
    v_extra:=${snap('approved', '991000001', `||jsonb_build_object('refunded_amount','500.00')`)}; ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  assert.deepEqual(byCode(s.result.alerts, 'ORDER_PAYMENT_REVERSED_OPEN'), []);
  assert.equal(byCode(s.result.alerts, 'ORDER_NOT_ACCEPTED').length, 1);
});

// ---- 3. the operation center cards agree with the alerts (migration 20261024020000) -------------------------------
// Before: a refunded open order still counted as «Pedidos nuevos — esperan que los aceptes» and, once late, as
// «Pedidos demorados» in red, next to the alert that asks to cancel it.
const LATE_PRODUCTION_ORDER = `set local session_replication_role=replica; update public.orders set created_at=clock_timestamp()-interval '50 minutes', origin='production' where id=v_order; set local session_replication_role=origin;`;
const METRICS = `(select jsonb_build_object('new',(c->'metrics'->>'new_orders')::int,'delayed',(c->'metrics'->>'delayed_orders')::int) from (select public.get_production_operation_center(v_business) c) x)`;

test('a refunded open order is neither a new nor a delayed order in the operation center', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE} ${LATE_PRODUCTION_ORDER} ${ACTOR}
    v_before:=${METRICS};
    ${EXTERNAL_FULL_REFUND}
    v_result:=${METRICS};`);
  assert.deepEqual(s.before, { new: 1, delayed: 1 }, 'control: the same order counts while its payment stands');
  assert.deepEqual(s.result, { new: 0, delayed: 0 });
});

test('a delivered order refunded afterwards (a complaint) is closed business: no refund alert', () => {
  const s = runScenario(`${APPROVE_AND_FINALIZE} ${ACTOR}
    select public.transition_order(v_order,revision,'accepted','ca-accept-0001') into v_extra2 from public.orders where id=v_order;
    select public.transition_order(v_order,revision,'preparing','ca-prepare-0001') into v_extra2 from public.orders where id=v_order;
    select public.transition_order(v_order,revision,'ready','ca-ready-0001') into v_extra2 from public.orders where id=v_order;
    select public.transition_order(v_order,revision,'delivered','ca-deliver-0001') into v_extra2 from public.orders where id=v_order;
    ${EXTERNAL_FULL_REFUND} ${RECONCILE}
    v_result:=jsonb_build_object('alerts',${OPEN_ALERTS});`);
  assert.deepEqual(s.order_status, ['delivered']);
  assert.deepEqual(byCode(s.result.alerts, 'ORDER_PAYMENT_REVERSED_OPEN'), []);
});
