// Second independent audit (Astra), findings 1 and 2: the SQL contracts the worker relies on, tested one by one on
// real PostgreSQL (each scenario runs in a transaction that always rolls back): the job reaper, release and
// heartbeat (leases, backoff, attempts, dead letters), the keyset ledger checkpoint, the follow-up schedule of each
// provider payment, the unchanged-payment shortcut and the escalation of discrepancies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, snap } from './harness.mjs';

const out = body => runScenario(body).extra;
const jobs = `(select coalesce(jsonb_agg(jsonb_build_object('r',resource_id,'status',status,'attempts',attempts,'interruptions',interruptions,
  'error',last_error,'owner',owner,'later',next_attempt_at > clock_timestamp() + interval '10 seconds') order by resource_id),'[]'::jsonb)
  from public.payment_outbox where resource_id like 'p%')`;
const insertJob = (resource, status, owner, leaseSql, attempts, extra = '') =>
  `insert into public.payment_outbox(payment_intent_id,topic,resource_id,status,owner,lease_expires_at,attempts${extra ? ',' + extra.split('=')[0] : ''})
   values (v_intent,'payment','${resource}','${status}',${owner ? `'${owner}'` : 'null'},${leaseSql},${attempts}${extra ? ',' + extra.split('=')[1] : ''});`;
const CONNECT = `
    insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
      values (v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '30 days');
`;
const byResource = rows => Object.fromEntries(rows.map(row => [row.r, row]));

test('C1 a dead or overrun worker does not keep the front of the queue: reaped, backed off, attempt refunded if it never ran', () => {
  const rows = byResource(out(`
    ${insertJob('p1', 'processing', 'dead-1', "clock_timestamp()-interval '1 minute'", 2)}
    ${insertJob('p2', 'claimed', 'dead-2', "clock_timestamp()-interval '1 minute'", 1)}
    ${insertJob('p3', 'processing', 'dead-3', "clock_timestamp()-interval '1 minute'", 8)}
    ${insertJob('p4', 'pending', null, 'null', 0)}
    perform public.claim_payment_outbox_v2('worker-1', 1, 60);
    v_extra := ${jobs};`));
  assert.equal(rows.p1.status, 'retry_wait', 'the interrupted job waits instead of being re-claimed first');
  assert.equal(rows.p1.attempts, 2);
  assert.equal(rows.p1.interruptions, 1);
  assert.equal(rows.p1.error, 'lease_expired_interrupted');
  assert.equal(rows.p1.later, true, 'with a backoff');
  assert.equal(rows.p2.status, 'claimed', 'a job that never ran is due again and is the one claimed');
  assert.equal(rows.p2.attempts, 1, 'its attempt was refunded (1 -> 0) and then spent on this claim');
  assert.equal(rows.p2.owner, 'worker-1');
  assert.equal(rows.p3.status, 'dead_letter', 'eight interrupted attempts park the job and raise the alert');
  assert.equal(rows.p4.status, 'pending');
  assert.equal(rows.p4.attempts, 0);
});

test('C2 releasing a job hands it back: attempt refunded while it is rare, spent once it keeps happening, dead letter at eight', () => {
  const rows = byResource(out(`
    ${insertJob('p1', 'claimed', 'w', "clock_timestamp()+interval '60 seconds'", 1)}
    ${insertJob('p2', 'processing', 'w', "clock_timestamp()+interval '60 seconds'", 1)}
    ${insertJob('p3', 'processing', 'w', "clock_timestamp()+interval '60 seconds'", 3, 'interruptions=3')}
    ${insertJob('p4', 'processing', 'w', "clock_timestamp()+interval '60 seconds'", 8, 'interruptions=3')}
    ${insertJob('p5', 'processing', 'w', "clock_timestamp()+interval '60 seconds'", 2)}
    perform public.release_payment_outbox_job((select id from public.payment_outbox where resource_id='p1'),'w',5,'t');
    perform public.release_payment_outbox_job((select id from public.payment_outbox where resource_id='p2'),'w',5,'t');
    perform public.release_payment_outbox_job((select id from public.payment_outbox where resource_id='p3'),'w',5,'t');
    perform public.release_payment_outbox_job((select id from public.payment_outbox where resource_id='p4'),'w',5,'t');
    perform public.release_payment_outbox_job((select id from public.payment_outbox where resource_id='p5'),'someone-else',5,'t');
    v_extra := ${jobs};`));
  assert.deepEqual([rows.p1.status, rows.p1.attempts], ['pending', 0], 'claimed but never started: as if never claimed');
  assert.deepEqual([rows.p2.status, rows.p2.attempts, rows.p2.interruptions], ['retry_wait', 0, 1], 'first interruption: attempt refunded');
  assert.equal(rows.p2.later, false, 'a short delay (5 s)');
  assert.deepEqual([rows.p3.status, rows.p3.attempts, rows.p3.interruptions], ['retry_wait', 3, 4], 'interrupted again and again: the attempt counts');
  assert.equal(rows.p3.later, true, 'and it waits like a failure would');
  assert.equal(rows.p4.status, 'dead_letter');
  assert.equal(rows.p5.status, 'processing', 'only the owner can release a job');
});

test('C3 the heartbeat extends only a lease that is still valid and still ours', () => {
  const r = out(`
    ${insertJob('p1', 'processing', 'w', "clock_timestamp()+interval '20 seconds'", 1)}
    ${insertJob('p2', 'processing', 'w', "clock_timestamp()-interval '1 second'", 1)}
    ${insertJob('p3', 'processing', 'w', "clock_timestamp()+interval '20 seconds'", 1)}
    v_extra := jsonb_build_object(
      'valid', public.extend_payment_outbox_lease((select id from public.payment_outbox where resource_id='p1'),'w',60),
      'lapsed', public.extend_payment_outbox_lease((select id from public.payment_outbox where resource_id='p2'),'w',60),
      'foreign', public.extend_payment_outbox_lease((select id from public.payment_outbox where resource_id='p3'),'not-the-owner',60));
    v_extra := v_extra || jsonb_build_object(
      'extended', (select lease_expires_at > clock_timestamp() + interval '50 seconds' from public.payment_outbox where resource_id='p1'),
      'foreignUntouched', (select lease_expires_at < clock_timestamp() + interval '30 seconds' from public.payment_outbox where resource_id='p3'));`);
  assert.deepEqual(r, { valid: true, lapsed: false, foreign: false, extended: true, foreignUntouched: true });
});

test('C4 every provider payment has a follow-up schedule that fits what it is', () => {
  const r = out(`
    perform ${snap('pending')};
    declare_dummy: begin null; end;`.replace('declare_dummy: begin null; end;', '') + `
    v_extra := '[]'::jsonb;
    for v_before in select to_jsonb(x) from (values
      ('pending','0 minutes','1 minute'), ('pending','5 minutes','1 minute'), ('pending','30 minutes','5 minutes'), ('pending','2 hours','15 minutes'),
      ('pending','10 hours','1 hour'), ('pending','5 days','6 hours'), ('in_process','0 minutes','1 minute'),
      ('approved','0 minutes','15 minutes'), ('approved','20 minutes','1 hour'), ('approved','2 hours','6 hours'),
      ('approved','7 hours','24 hours'), ('approved','30 hours','3 days'), ('approved','4 days','7 days'),
      ('approved','8 days','14 days'), ('approved','20 days','30 days'), ('approved','40 days',null),
      ('rejected','0 minutes',null), ('cancelled','0 minutes',null), ('expired','0 minutes',null),
      ('refunded','0 minutes',null), ('charged_back','0 minutes',null)) as x(status, seen_after, expected)
    loop
      update public.payment_provider_payments
         set status = v_before ->> 'status', first_seen_at = clock_timestamp() - interval '60 days',
             last_seen_at = clock_timestamp() - interval '60 days' + (v_before ->> 'seen_after')::interval;
      v_extra := v_extra || jsonb_build_array(jsonb_build_object('case', v_before,
        'state', (select watch_state from public.payment_provider_payments limit 1),
        'due', (select case when next_check_at is null then null
                       when status in ('pending','in_process') then (next_check_at - last_seen_at)::text
                       else (next_check_at - first_seen_at)::text end from public.payment_provider_payments limit 1)));
    end loop;`);
  const expectedInterval = text => (text === null ? null : { '1 minute': '00:01:00', '5 minutes': '00:05:00', '15 minutes': '00:15:00', '1 hour': '01:00:00', '6 hours': '06:00:00', '24 hours': '1 day', '3 days': '3 days', '7 days': '7 days', '14 days': '14 days', '30 days': '30 days' }[text]);
  for (const row of r) {
    const { status, expected } = row.case;
    assert.equal(row.due, expectedInterval(expected), `${status} seen ${row.case.seen_after} after first sight`);
    assert.equal(row.state, expected === null ? 'settled' : (status === 'approved' ? 'verify' : 'pending'), `${status}: watch state`);
  }
});

test('C5 a defective payment is not followed (a discrepancy already carries it) and a settled one never wakes up', () => {
  const r = out(`
    perform ${snap('approved')};
    update public.payment_provider_payments set validation_error = 'amount_mismatch';
    v_extra := (select jsonb_build_object('state', watch_state, 'due', next_check_at) from public.payment_provider_payments limit 1);`);
  assert.deepEqual(r, { state: 'settled', due: null });
});

test('C6 the unchanged shortcut only skips a payment held in exactly this state and never one whose order is still pending', () => {
  const r = out(`
    v_extra := jsonb_build_object('pendingOrder', public.provider_payment_unchanged('test','collector-retry','991000001','approved', clock_timestamp()));
    perform ${snap('approved')};
    v_pay := (select to_jsonb(provider_event_at) from public.payment_provider_payments limit 1);
    v_extra := v_extra || jsonb_build_object(
      'whileOrderPending', public.provider_payment_unchanged('test','collector-retry','991000001','approved', (v_pay #>> '{}')::timestamptz));
    perform public.finalize_paid_checkout_session(v_session);
    v_extra := v_extra || jsonb_build_object(
      'unchanged', public.provider_payment_unchanged('test','collector-retry','991000001','approved', (v_pay #>> '{}')::timestamptz),
      'otherStatus', public.provider_payment_unchanged('test','collector-retry','991000001','refunded', (v_pay #>> '{}')::timestamptz),
      'newerUpdate', public.provider_payment_unchanged('test','collector-retry','991000001','approved', (v_pay #>> '{}')::timestamptz + interval '1 second'),
      'otherSeller', public.provider_payment_unchanged('test','someone-else','991000001','approved', (v_pay #>> '{}')::timestamptz),
      'unknownPayment', public.provider_payment_unchanged('test','collector-retry','12345','approved', (v_pay #>> '{}')::timestamptz),
      'noTimestamp', public.provider_payment_unchanged('test','collector-retry','991000001','approved', null),
      'touched', (select last_seen_at >= clock_timestamp() - interval '5 seconds' from public.payment_provider_payments limit 1));`);
  assert.deepEqual(r, {
    pendingOrder: false, whileOrderPending: false, unchanged: true, otherStatus: false, newerUpdate: false,
    otherSeller: false, unknownPayment: false, noTimestamp: false, touched: true,
  });
});

test('C7 the ledger checkpoint only moves forward, only for the lease owner, and closes the window only when told', () => {
  const r = out(`
    insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
      values (v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '30 days');
    v_before := public.claim_provider_ledger_window('owner-a', 120, 7, 120, 10);
    v_extra := jsonb_build_object('claimBegin', v_before ->> 'begin', 'claimEnd', v_before ->> 'end', 'claimCursor', v_before ->> 'cursor_at', 'claimOffset', v_before -> 'offset');
    v_extra := v_extra || jsonb_build_object(
      'foreign', public.record_provider_ledger_checkpoint('owner-b', v_business, 'test', (v_before ->> 'cursor_at')::timestamptz + interval '5 minutes', 3, 3, 0, false, null, false, 90),
      'forward', public.record_provider_ledger_checkpoint('owner-a', v_business, 'test', (v_before ->> 'cursor_at')::timestamptz + interval '5 minutes', 3, 3, 1, false, null, false, 90));
    v_extra := v_extra || jsonb_build_object('afterForward', (select jsonb_build_object('at', private.provider_ts(cursor_at), 'skip', next_offset, 'seen', payments_seen, 'orphans', orphans_found) from public.provider_ledger_cursors));
    perform public.record_provider_ledger_checkpoint('owner-a', v_business, 'test', (v_before ->> 'cursor_at')::timestamptz + interval '1 minute', 50, 5, 0, false, null, false, 90);
    v_extra := v_extra || jsonb_build_object('afterBackward', (select jsonb_build_object('at', private.provider_ts(cursor_at), 'skip', next_offset) from public.provider_ledger_cursors));
    perform public.record_provider_ledger_checkpoint('owner-a', v_business, 'test', (v_before ->> 'cursor_at')::timestamptz + interval '5 minutes', 4, 1, 0, false, null, true, 90);
    v_extra := v_extra || jsonb_build_object('released', (select lease_owner is null and lease_expires_at is null and window_end is not null from public.provider_ledger_cursors));
    v_extra := v_extra || jsonb_build_object('resumeCursor', (public.claim_provider_ledger_window('owner-c', 120, 7, 120, 10)) ->> 'cursor_at');
    perform public.record_provider_ledger_checkpoint('owner-c', v_business, 'test', null, 0, 0, 0, true, null, false, 90);
    v_extra := v_extra || jsonb_build_object('closed', (select window_end is null and cursor_at is null and last_completed_at is not null and watermark_at > clock_timestamp() - interval '1 minute' from public.provider_ledger_cursors));`);
  assert.equal(r.claimCursor, r.claimBegin, 'a fresh window starts at its begin');
  assert.equal(r.claimOffset, 0);
  assert.match(r.claimBegin, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'milliseconds, UTC');
  assert.equal(r.foreign, false, 'a stale owner cannot move the cursor');
  assert.equal(r.forward, true);
  assert.deepEqual(r.afterForward, { at: new Date(Date.parse(r.claimBegin) + 300_000).toISOString(), skip: 3, seen: 3, orphans: 1 });
  assert.equal(r.afterBackward.at, r.afterForward.at, 'the cursor never moves backwards');
  assert.equal(r.afterBackward.skip, 3);
  assert.equal(r.released, true, 'a released lease keeps the window open');
  assert.equal(r.resumeCursor, new Date(Date.parse(r.claimBegin) + 300_000).toISOString(), 'the next owner resumes at the cursor');
  assert.equal(r.closed, true);
});

test('C8 a discrepancy escalates with more severity, never lowers, keeps its block and reopens when it must', () => {
  const r = out(`
    perform private.open_payment_discrepancy(v_business, null, null, 'orphan_provider_payment', 'low', false, '1', '{"status":"pending"}', 'orphan:test:1');
    v_extra := jsonb_build_object('first', (select jsonb_build_object('severity', severity, 'blocks', blocks_recovery, 'status', status) from public.payment_discrepancies where dedupe_key='orphan:test:1'));
    update public.payment_discrepancies set status = 'acknowledged' where dedupe_key='orphan:test:1';
    perform private.open_payment_discrepancy(v_business, null, null, 'orphan_provider_payment', 'low', false, '1', '{"status":"pending"}', 'orphan:test:1');
    v_extra := v_extra || jsonb_build_object('sameSeverityStaysAcknowledged', (select status from public.payment_discrepancies where dedupe_key='orphan:test:1'));
    perform private.open_payment_discrepancy(v_business, null, null, 'orphan_provider_payment', 'critical', true, '1', '{"status":"approved"}', 'orphan:test:1');
    v_extra := v_extra || jsonb_build_object('escalated', (select jsonb_build_object('severity', severity, 'blocks', blocks_recovery, 'status', status, 'occurrences', occurrences, 'details', details) from public.payment_discrepancies where dedupe_key='orphan:test:1'));
    perform private.open_payment_discrepancy(v_business, null, null, 'orphan_provider_payment', 'low', false, '1', '{"status":"pending"}', 'orphan:test:1');
    v_extra := v_extra || jsonb_build_object('neverLowered', (select jsonb_build_object('severity', severity, 'blocks', blocks_recovery) from public.payment_discrepancies where dedupe_key='orphan:test:1'));
    update public.payment_discrepancies set status='resolved', resolved_at=clock_timestamp(), resolution='handled' where dedupe_key='orphan:test:1';
    perform private.open_payment_discrepancy(v_business, null, null, 'orphan_provider_payment', 'low', false, '1', '{"status":"refunded"}', 'orphan:test:1');
    v_extra := v_extra || jsonb_build_object('reopened', (select jsonb_build_object('status', status, 'severity', severity) from public.payment_discrepancies where dedupe_key='orphan:test:1'));`);
  assert.deepEqual(r.first, { severity: 'low', blocks: false, status: 'open' });
  assert.equal(r.sameSeverityStaysAcknowledged, 'acknowledged');
  assert.deepEqual([r.escalated.severity, r.escalated.blocks, r.escalated.status, r.escalated.details.status], ['critical', true, 'open', 'approved']);
  assert.deepEqual(r.neverLowered, { severity: 'critical', blocks: true });
  assert.deepEqual(r.reopened, { status: 'open', severity: 'critical' });
});

test('C9 the orphan inbox ignores the same provider version seen again and keeps the identity of the payment', () => {
  const r = out(`
    perform public.record_orphan_provider_payment(v_business, 'test', jsonb_build_object('id','771','status','approved','external_reference','taba2:checkout:00000000-0000-4000-8000-000000009001',
      'transaction_amount','2500.00','currency_id','ARS','collector_id','collector-retry','date_created','2026-10-20T10:00:00.000-03:00','date_last_updated','2026-10-22T10:00:00.000-03:00'));
    perform public.record_orphan_provider_payment(v_business, 'test', jsonb_build_object('id','771','status','approved','external_reference','taba2:checkout:00000000-0000-4000-8000-000000009001',
      'transaction_amount','2500.00','currency_id','ARS','collector_id','collector-retry','date_created','2026-10-20T10:00:00.000-03:00','date_last_updated','2026-10-22T10:00:00.000-03:00'));
    v_extra := (select jsonb_build_object('rows', count(*), 'occurrences', max(occurrences), 'seller', max(seller_id), 'payment', max(provider_payment_id), 'environment', max(environment),
      'amount', max(details ->> 'amount'), 'currency', max(details ->> 'currency'), 'reference', max(details ->> 'external_reference'), 'status', max(details ->> 'last_status_seen'))
      from public.payment_discrepancies where kind = 'orphan_provider_payment');`);
  assert.deepEqual(r, {
    rows: 1, occurrences: 1, seller: 'collector-retry', payment: '771', environment: 'test', amount: '2500.00', currency: 'ARS',
    reference: 'taba2:checkout:00000000-0000-4000-8000-000000009001', status: 'approved',
  });
});

test('C10 an approved order whose verification ladder is overdue is flagged, and verifying it closes the flag', () => {
  const r = out(`
${CONNECT}    perform ${snap('approved')};
    perform public.finalize_paid_checkout_session(v_session);
    update public.payment_provider_payments set first_seen_at = clock_timestamp() - interval '3 days', last_seen_at = clock_timestamp() - interval '3 days';
    v_extra := jsonb_build_object('checks', public.run_financial_integrity_checks());
    v_extra := v_extra || jsonb_build_object('open', (select count(*) from public.payment_discrepancies where kind='order_paid_unverified' and status<>'resolved'));
    update public.payment_provider_payments set last_seen_at = clock_timestamp();
    perform public.run_financial_integrity_checks();
    v_extra := v_extra || jsonb_build_object('afterVerification', (select count(*) from public.payment_discrepancies where kind='order_paid_unverified' and status<>'resolved'),
      'next', (select watch_state from public.payment_provider_payments limit 1));`);
  assert.equal(r.checks.order_paid_unverified, 1);
  assert.equal(r.open, 1);
  assert.equal(r.afterVerification, 0, 'verifying it again closes the finding');
  assert.equal(r.next, 'verify', 'and it stays on the ladder');
});

test('C11 a pending payment nobody re-read for an hour becomes a finding, and settles when it is read again', () => {
  const r = out(`
${CONNECT}    perform ${snap('pending')};
    update public.payment_provider_payments set first_seen_at = clock_timestamp() - interval '3 hours', last_seen_at = clock_timestamp() - interval '3 hours';
    v_extra := jsonb_build_object('checks', public.run_financial_integrity_checks());
    v_extra := v_extra || jsonb_build_object('open', (select count(*) from public.payment_discrepancies where kind='pending_payment_unchecked' and status<>'resolved'));
    update public.payment_provider_payments set last_seen_at = clock_timestamp();
    perform public.run_financial_integrity_checks();
    v_extra := v_extra || jsonb_build_object('afterRead', (select count(*) from public.payment_discrepancies where kind='pending_payment_unchecked' and status<>'resolved'));`);
  assert.equal(r.checks.pending_payment_unchecked, 1);
  assert.equal(r.open, 1);
  assert.equal(r.afterRead, 0);
});

test('C12 the pipeline health reports the follow-up schedule and interrupted jobs', () => {
  const r = out(`
    perform ${snap('pending')};
    ${insertJob('p1', 'retry_wait', null, 'null', 2, 'interruptions=1')}
    v_extra := public.payments_pipeline_health();`);
  assert.equal(r.watch.pending_payments, 1);
  assert.equal(r.watch.pending_overdue_over_1h, 0);
  assert.equal(r.outbox.interrupted_jobs, 1);
});

test('C13 a seller that is no longer connected is not followed: nothing is enqueued and no finding piles up', () => {
  // Contract changed on purpose (20261022140000): the pending payment of a seller that cannot be read used to vanish
  // from the findings ("disconnecting closes what can no longer be verified"). Pending money nobody can read is now
  // ONE finding that stays open; still nothing is enqueued and nothing piles up.
  const r = out(`
    perform ${snap('pending')};
    update public.payment_provider_payments set first_seen_at = clock_timestamp() - interval '3 hours', last_seen_at = clock_timestamp() - interval '3 hours';
    v_extra := jsonb_build_object('withoutSeller', public.enqueue_checkout_provider_probes(), 'findingsWithoutSeller', public.run_financial_integrity_checks(),
      'againWithoutSeller', public.run_financial_integrity_checks());
    insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
      values (v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '30 days');
    v_extra := v_extra || jsonb_build_object('withSeller', public.enqueue_checkout_provider_probes(), 'findingsWithSeller', public.run_financial_integrity_checks());
    update public.mp_seller_connections set status = 'disconnected', protected_tokens = null where business_id = v_business;
    perform public.run_financial_integrity_checks();
    v_extra := v_extra || jsonb_build_object('openAfterDisconnect', (select count(*) from public.payment_discrepancies where kind in ('pending_payment_unchecked','order_paid_unverified') and status <> 'resolved'),
      'rows', (select count(*) from public.payment_discrepancies));`);
  assert.equal(r.withoutSeller, 0, 'nothing is enqueued for a seller that cannot be read');
  assert.equal(r.findingsWithoutSeller.pending_payment_unchecked, 0);
  assert.equal(r.findingsWithoutSeller.pending_payment_unreadable, 1, 'the unreadable pending payment is a finding');
  assert.equal(r.againWithoutSeller.pending_payment_unreadable, 0, 'opened once: the next pass adds nothing');
  assert.equal(r.withSeller, 1, 'with a seller the due payment is read');
  assert.equal(r.findingsWithSeller.pending_payment_unchecked, 1, 'and an overdue read is a finding');
  assert.equal(r.openAfterDisconnect, 1, 'losing the link never closes a pending payment nobody verified');
  assert.equal(r.rows, 1, 'one finding for one payment');
});

test('C16 Mercado Pago revokes the link while a payment is pending: the finding stays open, alerts, and a person can close it', () => {
  // Red on 20261022130000: the finding was resolved as 'checked_again' although nobody read the payment, and since
  // the revocation also turns Mercado Pago off, MERCADOPAGO_SELLER_CANNOT_CHARGE did not fire either: no alert at all.
  const r = out(`
${CONNECT}    insert into public.business_payment_settings(business_id,provider,environment,enabled,collector_id,application_id)
      values (v_business,'mercadopago','test',true,'collector-retry','application-retry')
      on conflict do nothing;
    perform ${snap('pending')};
    update public.payment_provider_payments set first_seen_at = clock_timestamp() - interval '3 hours', last_seen_at = clock_timestamp() - interval '3 hours';
    perform public.run_financial_integrity_checks();
    v_extra := jsonb_build_object('revoked', public.mp_mark_seller_deauthorized(v_business, 'test'));
    perform public.run_financial_integrity_checks();
    perform public.reconcile_operational_alerts_for_business(v_business);
    v_extra := v_extra || jsonb_build_object(
      'finding', (select jsonb_build_object('status', status, 'resolution', resolution) from public.payment_discrepancies where kind = 'pending_payment_unchecked'),
      'enqueued', public.enqueue_checkout_provider_probes(),
      'alerts', (select coalesce(jsonb_agg(alert_code order by alert_code), '[]'::jsonb) from public.operational_alerts where business_id = v_business and status <> 'resolved'));
    update public.payment_discrepancies set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'checked in Mercado Pago by a person'
     where kind = 'pending_payment_unchecked';
    perform public.run_financial_integrity_checks();
    v_extra := v_extra || jsonb_build_object('afterPerson', (select status from public.payment_discrepancies where kind = 'pending_payment_unchecked'),
      'rows', (select count(*) from public.payment_discrepancies));`);
  assert.equal(r.revoked, true);
  assert.deepEqual(r.finding, { status: 'open', resolution: null }, 'nobody read the payment: the finding is not closed');
  assert.equal(r.enqueued, 0, 'and nothing is enqueued for the revoked seller');
  assert.ok(r.alerts.includes('PAYMENT_DISCREPANCY_OPEN'), 'Walter is alerted: ' + JSON.stringify(r.alerts));
  assert.equal(r.afterPerson, 'resolved', 'what a person resolved stays resolved while the seller stays disconnected');
  assert.equal(r.rows, 1);
});

test('C17 an overdue verification of a completed order closed by a disconnect says so instead of claiming a verification', () => {
  const r = out(`
${CONNECT}    perform ${snap('approved')};
    perform public.finalize_paid_checkout_session(v_session);
    update public.payment_provider_payments set first_seen_at = clock_timestamp() - interval '3 days', last_seen_at = clock_timestamp() - interval '3 days';
    perform public.run_financial_integrity_checks();
    update public.mp_seller_connections set status = 'disconnected', protected_tokens = null where business_id = v_business;
    perform public.run_financial_integrity_checks();
    v_extra := (select jsonb_build_object('status', status, 'resolution', resolution) from public.payment_discrepancies where kind = 'order_paid_unverified');`);
  assert.deepEqual(r, { status: 'resolved', resolution: 'seller_disconnected' });
});

test('C14 a payment that keeps failing is counted per payment and only the owner of the window can park it', () => {
  const r = out(`
    insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
      values (v_business,'test','collector-retry','application-retry','connected','SYNTHETIC_NONCREDENTIAL',clock_timestamp()+interval '30 days');
    perform public.claim_provider_ledger_window('owner-a', 120, 7, 120, 10);
    v_extra := jsonb_build_object(
      'one', public.record_ledger_item_failure('owner-a', v_business, 'test', '700'),
      'two', public.record_ledger_item_failure('owner-a', v_business, 'test', '700'),
      'other', public.record_ledger_item_failure('owner-a', v_business, 'test', '701'),
      'again', public.record_ledger_item_failure('owner-a', v_business, 'test', '700'),
      'foreign', public.record_ledger_item_failure('owner-b', v_business, 'test', '700'));
    v_extra := v_extra || jsonb_build_object('parked', public.record_ledger_item_unprocessable('owner-a', v_business, 'test',
      jsonb_build_object('id','700','status','approved','transaction_amount','2500.00','currency_id','ARS','collector_id','collector-retry',
        'external_reference','taba2:checkout:00000000-0000-4000-8000-000000009002','date_last_updated','2026-10-22T10:00:00.000-03:00'), 'payment_snapshot_not_verifiable') is not null);
    v_extra := v_extra || jsonb_build_object(
      'finding', (select jsonb_build_object('severity', severity, 'blocks', blocks_recovery, 'seller', seller_id, 'payment', provider_payment_id, 'amount', details ->> 'amount',
        'currency', details ->> 'currency', 'reference', details ->> 'external_reference') from public.payment_discrepancies where kind = 'ledger_item_unprocessable'),
      'reset', (select stuck_count from public.provider_ledger_cursors));
    begin
      perform public.record_ledger_item_unprocessable('owner-b', v_business, 'test', jsonb_build_object('id','1'), 'x');
      v_extra := v_extra || jsonb_build_object('foreignParked', true);
    exception when others then v_extra := v_extra || jsonb_build_object('foreignParked', false);
    end;`);
  assert.deepEqual([r.one, r.two, r.other, r.again, r.foreign], [1, 2, 1, 1, 0], 'consecutive failures of the SAME payment; another payment restarts the count');
  assert.equal(r.parked, true);
  assert.deepEqual(r.finding, { severity: 'critical', blocks: false, seller: 'collector-retry', payment: '700', amount: '2500.00', currency: 'ARS', reference: 'taba2:checkout:00000000-0000-4000-8000-000000009002' });
  assert.equal(r.reset, 0);
  assert.equal(r.foreignParked, false);
});

test('C15 an orphan finding recorded before this version (no update time) is not reopened when the same status is seen again', () => {
  const r = out(`
    perform private.open_payment_discrepancy(v_business, null, null, 'orphan_provider_payment', 'critical', true, '771',
      '{"status":"approved","amount":"2500.00"}', 'orphan:test:771', null, 'collector-retry', 'test');
    update public.payment_discrepancies set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'handled by a person' where dedupe_key = 'orphan:test:771';
    perform public.record_orphan_provider_payment(v_business, 'test', jsonb_build_object('id','771','status','approved','external_reference','taba2:checkout:00000000-0000-4000-8000-000000009001',
      'transaction_amount','2500.00','currency_id','ARS','collector_id','collector-retry','date_last_updated','2026-10-22T10:00:00.000-03:00'));
    v_extra := jsonb_build_object('afterSameStatus', (select status from public.payment_discrepancies where dedupe_key = 'orphan:test:771'));
    perform public.record_orphan_provider_payment(v_business, 'test', jsonb_build_object('id','771','status','refunded','external_reference','taba2:checkout:00000000-0000-4000-8000-000000009001',
      'transaction_amount','2500.00','currency_id','ARS','collector_id','collector-retry','date_last_updated','2026-10-23T10:00:00.000-03:00'));
    v_extra := v_extra || jsonb_build_object('afterChange', (select status from public.payment_discrepancies where dedupe_key = 'orphan:test:771'));`);
  assert.equal(r.afterSameStatus, 'resolved', 'what a person resolved stays resolved while the provider reports the same thing');
  assert.equal(r.afterChange, 'open', 'a new fact reopens it');
});
