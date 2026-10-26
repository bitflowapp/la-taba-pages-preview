// P1 forensic findings F08-F10 and F14 plus the discrepancy inbox, ledger sweep and integrity checks, on real PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, runScenarioExpectingError, snap, ACTOR, EXPIRE } from './harness.mjs';

const CONNECT = `insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at) values(v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '1 day');`;
const SESSION_AGE = (created, expires) => `update public.checkout_sessions set created_at=clock_timestamp()-interval '${created}',expires_at=clock_timestamp()-interval '${expires}' where id=v_session;`;
const EMPTY_PROBES = (n, ago) => `insert into public.payment_events(payment_intent_id,event_type,server_recorded_at,details) select v_intent,'payment.provider_probe_empty',clock_timestamp()-interval '${ago}','{}'::jsonb from generate_series(1,${n});`;

test('F08 eight empty probes no longer end the watch: the ninth is enqueued once its backoff elapsed', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('30 minutes', '1 second')} ${EMPTY_PROBES(8, '11 minutes')} v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(s.result.enqueued, 1);
});

test('F08 backoff stretches but never stops: 30 empties an hour apart still produce a probe', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('30 minutes', '1 second')} ${EMPTY_PROBES(30, '61 minutes')} v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(s.result.enqueued, 1);
});

test('F08 a probe is not enqueued twice inside its backoff', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('30 minutes', '1 second')} ${EMPTY_PROBES(8, '3 minutes')} v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(s.result.enqueued, 0);
});

test('F08 a checkout older than 48 h is still watched', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('49 hours', '48 hours')} v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(s.result.enqueued, 1);
});

test('F08 closes only with evidence: expiry + 24 h grace + three empty probes after it', () => {
  const closed = runScenario(`${CONNECT} ${SESSION_AGE('60 hours', '50 hours')} ${EMPTY_PROBES(3, '2 hours')} v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(closed.result.enqueued, 0, 'three empty probes after the grace window close the watch');
  const notClosed = runScenario(`${CONNECT} ${SESSION_AGE('60 hours', '50 hours')} ${EMPTY_PROBES(30, '40 hours')} v_result:=jsonb_build_object('enqueued',public.enqueue_checkout_provider_probes(50));`);
  assert.equal(notClosed.result.enqueued, 1, 'any number of probes taken BEFORE the grace window ends do not close it');
});

test('F08 the unverified-checkout alert stays open while the watch is open, even after 8 empty probes and 48 h', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('49 hours', '48 hours')} ${EMPTY_PROBES(8, '40 hours')}
    update public.payment_intents set internal_status='expired' where id=v_intent;
    perform public.reconcile_operational_alerts_for_business(v_business);
    v_result:=jsonb_build_object('alerts',(select coalesce(jsonb_agg(alert_code),'[]'::jsonb) from public.operational_alerts where business_id=v_business and status<>'resolved'));`);
  assert.ok(s.result.alerts.includes('CHECKOUT_PROVIDER_UNVERIFIED'));
});

test('F10 disconnect is refused after a retryable rejection, keeps the credential and keeps payments paused', () => {
  const s = runScenario(`${CONNECT} v_result:=${snap('rejected')}; v_result:=public.mp_disconnect_checked(v_business,'test',true);
    select jsonb_build_object('status',status,'token_kept',protected_tokens is not null,'requested',disconnect_requested_at is not null) into v_extra from public.mp_seller_connections where business_id=v_business;
    v_before:=jsonb_build_object('enabled',(select enabled from public.business_payment_settings where business_id=v_business));`);
  assert.equal(s.result.ok, false);
  assert.equal(s.result.code, 'pending_operations');
  assert.equal(s.result.paused, true);
  assert.ok(s.result.pending.open_payments >= 1);
  assert.equal(s.extra.token_kept, true);
  assert.equal(s.extra.requested, true);
  assert.equal(s.before.enabled, false, 'new charges are paused immediately');
});

test('F10 disconnect is refused with an open discrepancy and until the ledger was read after the last activity', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('40 hours', '30 hours')} update public.payment_intents set internal_status='expired' where id=v_intent;
    v_before:=public.mp_disconnect_checked(v_business,'test',true);
    insert into public.provider_ledger_cursors(business_id,environment,watermark_at,last_completed_at) values(v_business,'test',clock_timestamp(),clock_timestamp()+interval '1 second');
    v_extra:=public.mp_disconnect_preflight(v_business,'test');
    perform public.record_payment_discrepancy(v_business,v_intent,'provider_payment_inconsistent','critical',true,'991000009','{}'::jsonb,'fx-disc-0001','test','collector-retry');
    v_extra2:=public.mp_disconnect_preflight(v_business,'test');
    v_result:=public.mp_disconnect_checked(v_business,'test',true);`);
  assert.equal(s.before.pending.ledger_unsynced, 1, 'ledger not read since the last activity');
  assert.equal(s.extra.ledger_unsynced, 0);
  assert.equal(s.extra.open_payments, 0, 'expired long ago and nothing in flight');
  assert.equal(s.result.ok, false);
  assert.equal(s.result.pending.open_discrepancies, 1);
});

test('F10 a clean, drained, synchronized connection can be disconnected', () => {
  const s = runScenario(`${CONNECT} ${SESSION_AGE('40 hours', '30 hours')} update public.payment_intents set internal_status='expired' where id=v_intent;
    insert into public.provider_ledger_cursors(business_id,environment,watermark_at,last_completed_at) values(v_business,'test',clock_timestamp(),clock_timestamp()+interval '1 second');
    v_result:=public.mp_disconnect_checked(v_business,'test',true);
    select jsonb_build_object('status',status,'token_removed',protected_tokens is null) into v_extra from public.mp_seller_connections where business_id=v_business;`);
  assert.equal(s.result.ok, true);
  assert.equal(s.extra.status, 'disconnected');
  assert.equal(s.extra.token_removed, true);
});

test('F14 an old incident stays first when more than 200 newer payments exist', () => {
  const s = runScenario(`${ACTOR} update public.products set stock=1000 where id=v_product;
    -- the incident: approved and never fulfilled, the OLDEST row
    v_result:=${snap('approved')}; update public.payment_intents set created_at=clock_timestamp()-interval '30 days' where id=v_intent;
    for i in 1..205 loop
      perform public.create_checkout_session(v_user,jsonb_build_object('business_id',v_business,'client_request_id','fx14row'||lpad(i::text,6,'0'),'items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Synthetic audit','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago'));
    end loop;
    perform set_config('request.jwt.claim.sub',v_user::text,true);
    select jsonb_agg(x) into v_extra from public.list_business_payments(v_business) x;
    select jsonb_agg(x) into v_extra2 from public.list_business_payments(v_business,0,5,v_intent::text) x;
    v_before:=jsonb_build_object('total',(select count(*) from public.payment_intents where business_id=v_business));`);
  assert.ok(s.before.total >= 1);
  assert.ok(s.extra.length <= 200);
  assert.equal(s.extra[0].payment_intent_id !== undefined, true);
  assert.ok(s.extra.some(row => row.needs_attention === true), 'attention rows are returned');
  assert.equal(s.extra[0].needs_attention, true, 'incidents are first');
});

test('discrepancy inbox: resolution needs evidence, an owner, and a real order for paid-without-order', () => {
  const s = runScenario(`${ACTOR} v_result:=${snap('approved')};
    perform private.open_payment_discrepancy(v_business,v_intent,v_session,'paid_without_order','high',false,'991000001','{}'::jsonb,'fx-inbox-0001');
    select id into v_refund from public.payment_discrepancies where dedupe_key='fx-inbox-0001';
    begin perform public.resolve_payment_discrepancy(v_refund,'order_created','a note long enough'); v_extra:=jsonb_build_object('no_order','allowed'); exception when others then v_extra:=jsonb_build_object('no_order',SQLSTATE); end;
    begin perform public.resolve_payment_discrepancy(v_refund,'refunded_in_provider','short'); v_extra:=v_extra||jsonb_build_object('short_note','allowed'); exception when others then v_extra:=v_extra||jsonb_build_object('short_note',SQLSTATE); end;
    v_result:=public.resolve_payment_discrepancy(v_refund,'refunded_in_provider','refunded from the provider panel, evidence 12345');
    v_before:=(select to_jsonb(d) - 'details' from public.payment_discrepancies d where id=v_refund);`);
  assert.equal(s.extra.no_order, '55000');
  assert.equal(s.extra.short_note, '22023');
  assert.equal(s.before.status, 'resolved');
  assert.equal(s.before.resolution, 'refunded_in_provider');
});

test('discrepancy inbox: a recurrence is counted, not duplicated, and a resolved one reopens', () => {
  const s = runScenario(`v_result:=${snap('approved')};
    perform private.open_payment_discrepancy(v_business,v_intent,v_session,'paid_without_order','high',false,'991000001','{}'::jsonb,'fx-inbox-0002');
    perform private.open_payment_discrepancy(v_business,v_intent,v_session,'paid_without_order','high',false,'991000001','{}'::jsonb,'fx-inbox-0002');
    update public.payment_discrepancies set status='resolved',resolved_at=now(),resolution='verified_no_loss' where dedupe_key='fx-inbox-0002';
    perform private.open_payment_discrepancy(v_business,v_intent,v_session,'paid_without_order','high',false,'991000001','{}'::jsonb,'fx-inbox-0002');
    select jsonb_build_object('rows',count(*),'occurrences',max(occurrences),'status',max(status)) into v_extra from public.payment_discrepancies where dedupe_key='fx-inbox-0002';`);
  assert.deepEqual(s.extra, { rows: 1, occurrences: 3, status: 'open' });
});

test('discrepancy alerts: every open discrepancy becomes an operational alert', () => {
  const s = runScenario(`v_result:=${snap('approved')};
    perform private.open_payment_discrepancy(v_business,v_intent,v_session,'multiple_approved_payments','critical',true,'991000002','{}'::jsonb,'fx-alert-0001');
    perform public.reconcile_operational_alerts_for_business(v_business);
    v_extra:=(select coalesce(jsonb_agg(alert_code||':'||severity),'[]'::jsonb) from public.operational_alerts where business_id=v_business and alert_code='PAYMENT_DISCREPANCY_OPEN');`);
  assert.deepEqual(s.extra, ['PAYMENT_DISCREPANCY_OPEN:CRITICAL']);
});

test('F09 a refund with a lost identity is parked, blocks recovery, and is resolved only with evidence', () => {
  const s = runScenario(`${ACTOR} ${EXPIRE} update public.products set stock=1 where id=v_product;
    v_result:=${snap('approved')}; update public.products set stock=10 where id=v_product;
    v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'response_lost');
    perform public.park_refund_identity_unknown(v_refund,'{"provider_refunds":[{"id":"881000009","amount":2500,"status":"approved"}]}'::jsonb);
    begin perform public.recover_paid_checkout_order(v_session); v_before:=jsonb_build_object('recovery','allowed'); exception when others then v_before:=jsonb_build_object('recovery',SQLSTATE); end;
    v_result:=public.resolve_ambiguous_refund(v_refund,'executed','881000009','confirmed in the provider panel, refund 881000009');
    v_extra:=jsonb_build_object('refund',(select jsonb_build_object('status',status,'id',provider_refund_id) from public.payment_refunds where id=v_refund),
      'discrepancy',(select status from public.payment_discrepancies where refund_id=v_refund and kind='refund_identity_unknown'));`);
  assert.equal(s.before.recovery, '55000');
  assert.equal(s.extra.refund.status, 'approved');
  assert.equal(s.extra.refund.id, '881000009');
  assert.equal(s.extra.discrepancy, 'resolved');
  assert.equal(s.intent.refunded, 2500);
  assert.equal(s.orders, 0);
});

test('F09 an operator note cannot release an unknown refund hold', () => {
  const s = runScenario(`${ACTOR} ${EXPIRE} update public.products set stock=1 where id=v_product;
    v_result:=${snap('approved')}; update public.products set stock=10 where id=v_product;
    v_extra:=public.prepare_payment_refund_v2(v_intent,null,v_key,'forensic'); v_refund:=(v_extra->>'refund_id')::uuid;
    perform public.mark_payment_refund_ambiguous(v_refund,repeat('3',64),'response_lost');
    begin perform public.resolve_ambiguous_refund(v_refund,'not_executed',null,'provider panel shows no refund for this payment');
      v_before:=jsonb_build_object('released',true); exception when others then v_before:=jsonb_build_object('released',false,'code',SQLSTATE); end;
    v_extra:=jsonb_build_object('hold',private.payment_financial_hold(v_intent),'refund_status',(select status from public.payment_refunds where id=v_refund));`);
  assert.notEqual(s.extra.hold, null);
  assert.equal(s.extra.refund_status, 'ambiguous');
  assert.equal(s.before.released, false);
  assert.equal(s.before.code, '55000');
  assert.equal(s.intent.refunded, 0);
});

test('ledger sweep: a window is leased, resumed at its offset, finished only when every page was read', () => {
  const s = runScenario(`${CONNECT}
    v_before:=public.claim_provider_ledger_window('worker-a');
    v_extra:=public.claim_provider_ledger_window('worker-b');
    perform public.record_provider_ledger_page('worker-a',v_business,'test',50,false,50,0,null);
    update public.provider_ledger_cursors set lease_expires_at=clock_timestamp()-interval '1 second' where business_id=v_business;
    v_extra2:=public.claim_provider_ledger_window('worker-c');
    perform public.record_provider_ledger_page('worker-c',v_business,'test',0,true,7,1,null);
    v_result:=jsonb_build_object('cursor',(select to_jsonb(c) from public.provider_ledger_cursors c where business_id=v_business),
      'stale_owner_accepted',public.record_provider_ledger_page('worker-a',v_business,'test',0,true,0,0,null));`);
  assert.equal(s.before.business_id !== undefined, true);
  assert.equal(s.extra, null, 'a second worker does not get a leased window');
  assert.equal(s.extra2.offset, 50, 'a crashed worker is resumed at the page it had reached');
  assert.equal(s.extra2.begin, s.before.begin, 'the resumed window is the same window');
  assert.equal(s.result.cursor.window_end, null);
  assert.equal(s.result.cursor.next_offset, 0);
  assert.ok(s.result.cursor.last_completed_at);
  assert.equal(s.result.cursor.orphans_found, 1);
  assert.equal(s.result.stale_owner_accepted, false);
});

test('ledger sweep: failures back off and never advance the watermark', () => {
  const s = runScenario(`${CONNECT}
    v_before:=public.claim_provider_ledger_window('worker-a');
    perform public.record_provider_ledger_page('worker-a',v_business,'test',0,false,0,0,'provider_503');
    v_extra:=public.claim_provider_ledger_window('worker-b');
    v_result:=(select to_jsonb(c) from public.provider_ledger_cursors c where business_id=v_business);`);
  assert.equal(s.extra, null, 'inside the backoff nothing is claimed');
  assert.equal(s.result.consecutive_failures, 1);
  assert.ok(s.result.window_end, 'the unfinished window is kept');
});

test('ledger sweep: an orphan approved payment becomes a critical, recovery-blocking discrepancy', () => {
  const s = runScenario(`${CONNECT}
    perform public.record_orphan_provider_payment(v_business,'test',jsonb_build_object('id','771000001','status','approved','transaction_amount',2500,'currency_id','ARS','external_reference','taba2:checkout:00000000-0000-4000-8000-0000000000aa','collector_id','collector-retry'));
    perform public.record_orphan_provider_payment(v_business,'test',jsonb_build_object('id','771000001','status','approved','transaction_amount',2500,'currency_id','ARS','external_reference','taba2:checkout:00000000-0000-4000-8000-0000000000aa','collector_id','collector-retry'));
    v_result:=(select jsonb_build_object('rows',count(*),'sev',max(severity),'blocks',bool_or(blocks_recovery),'occ',max(occurrences)) from public.payment_discrepancies where kind='orphan_provider_payment' and business_id=v_business);
    begin perform public.record_orphan_provider_payment(v_business,'test',jsonb_build_object('id','1','status','approved','external_reference','someone-elses-order')); v_extra:=jsonb_build_object('foreign','accepted'); exception when others then v_extra:=jsonb_build_object('foreign',SQLSTATE); end;`);
  // The ledger window overlaps on purpose (second audit): the same provider version seen again is not a new fact.
  assert.deepEqual(s.result, { rows: 1, sev: 'critical', blocks: true, occ: 1 });
  assert.equal(s.extra.foreign, '22023');
});

test('integrity checks: an order paid whose provider verification is overdue is flagged and clears itself when verified', () => {
  // Second audit: "unverified" is judged against the payment's own verification ladder (15 m, 1 h, 6 h, 24 h, 3 d, ...)
  // instead of a flat 24 hours: the payment was first seen three days ago and never verified since.
  const s = runScenario(`${CONNECT} v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate;
    update public.payment_provider_payments set first_seen_at=clock_timestamp()-interval '3 days', last_seen_at=clock_timestamp()-interval '3 days' where payment_intent_id=v_intent;
    v_before:=public.run_financial_integrity_checks(100);
    v_extra:=(select coalesce(jsonb_agg(kind||':'||status),'[]'::jsonb) from public.payment_discrepancies where payment_intent_id=v_intent);
    v_result:=${snap('approved')};
    v_before:=v_before||public.run_financial_integrity_checks(100);
    v_extra2:=(select coalesce(jsonb_agg(kind||':'||status),'[]'::jsonb) from public.payment_discrepancies where payment_intent_id=v_intent);`);
  assert.deepEqual(s.extra, ['order_paid_unverified:open']);
  assert.deepEqual(s.extra2, ['order_paid_unverified:resolved']);
});

test('integrity checks: approved money with no order is flagged, and a paid order never double-counts stock', () => {
  const s = runScenario(`v_result:=${snap('approved')}; alter table public.payment_intents disable trigger payment_intents_set_updated_at; update public.payment_intents set updated_at=clock_timestamp()-interval '30 minutes' where id=v_intent;
    v_before:=public.run_financial_integrity_checks(100);
    v_extra:=(select coalesce(jsonb_agg(kind||':'||status),'[]'::jsonb) from public.payment_discrepancies where payment_intent_id=v_intent);`);
  assert.ok(s.extra.includes('paid_without_order:open'));
});

test('F07 a missing preference is a retry, not a permanent review; the corrected read finalizes once', () => {
  const s = runScenario(`v_result:=${snap('approved', '991000001', `||jsonb_build_object('preference_id','')`)}; v_before:=v_result;
    v_result:=${snap('approved')}; if (v_result->>'finalize_required')::boolean then v_extra:=public.finalize_paid_checkout_session(v_session); end if; set constraints all immediate;`);
  assert.equal(s.before.retryable, true);
  assert.equal(s.before.finalize_required, false);
  assert.equal(s.orders, 1);
  assert.equal(s.stock, 8);
  assert.notEqual(s.intent.status, 'security_review_required');
});

test('F07 a DIFFERENT preference is still a real mismatch and still goes to review', () => {
  const s = runScenario(`v_result:=${snap('approved', '991000001', `||jsonb_build_object('preference_id','SOMEONE-ELSES-PREF')`)};`);
  assert.equal(s.result.manual_review_required, true);
  assert.equal(s.result.reason, 'preference_mismatch');
  assert.equal(s.intent.status, 'security_review_required');
  assert.ok(s.discrepancies.some(d => d.kind === 'provider_payment_inconsistent'));
});

test('a defective payment of a DIFFERENT id does not poison a healthy completed purchase', () => {
  const s = runScenario(`v_result:=${snap('approved')}; v_result:=public.finalize_paid_checkout_session(v_session); set constraints all immediate;
    v_result:=${snap('approved', '991000077', `||jsonb_build_object('transaction_amount','1.00')`)};`);
  assert.equal(s.intent.status, 'completed');
  assert.equal(s.session.status, 'completed');
  assert.equal(s.orders, 1);
  assert.ok(s.discrepancies.some(d => d.kind === 'provider_payment_inconsistent' && d.severity === 'critical'));
});

test('a payment id already bound to another checkout is refused as inconsistent', () => {
  const msg = runScenario(`v_result:=${snap('approved')};
    v_extra:=public.record_mercadopago_payment_snapshot(v_intent,jsonb_build_object('provider_payment_id','991000001','external_reference','taba2:checkout:'||v_session::text,'preference_id','FORENSIC-PREF','collector_id','collector-retry','currency','ARS','transaction_amount','2500.00','status','approved','live_mode',true,'provider_occurred_at',clock_timestamp()::text,'refunded_amount','0.00','raw_response_hash',repeat('1',64)),'reconciliation',null);`);
  assert.equal(msg.extra.ok, true, 'the same payment on its own checkout is simply idempotent');
});

test('error text of an expected SQL failure is reachable by the harness', () => {
  const text = runScenarioExpectingError(`perform public.finalize_paid_checkout_session(v_session);`);
  assert.match(text, /pago no aprobado verificadamente/);
});
