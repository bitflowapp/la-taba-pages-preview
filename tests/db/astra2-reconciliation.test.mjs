// Second independent audit (Astra), finding 1: the reconciliation can miss LATE changes of payments.
// Real worker + real adapter + real PostgreSQL, SIMULATED Mercado Pago, virtual clock. No network, no real money.
// Red on the audited revision (TABA_LOCAL_DB=taba_local_work + the audited functions), green on the fixed one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from '../support/astra2-run.mjs';

test('A1 a refund made in the provider panel days after the payment is found without any webhook', () => {
  const s = scenario('refund_after_completion_is_seen');
  assert.equal(s.afterFirst.orders, 1, 'the approved payment became an order the first time');
  assert.equal(s.afterFirst.intent.status, 'completed');
  assert.ok(s.state.intent.refunded > 0, 'the late refund reached the books: ' + JSON.stringify(s.state.intent));
  assert.notEqual(s.hold, null, 'a refunded order must carry a financial hold');
  assert.ok(s.searches.some(x => x.range === 'date_last_updated'), 'the ledger is read by LAST UPDATE, not only by creation');
});

test('A2 a pending offline payment approved days later is found and the orphan becomes critical', () => {
  const s = scenario('orphan_pending_then_approved_is_escalated');
  const orphan = s.afterFirst.discrepancies.find(d => d.kind === 'orphan_provider_payment');
  assert.ok(orphan, 'the pending orphan was recorded the first time');
  assert.notEqual(orphan.severity, 'critical', 'pending money is not yet critical');
  const later = s.state.discrepancies.filter(d => d.kind === 'orphan_provider_payment');
  assert.equal(later.length, 1, 'one durable row for the payment, not one per sighting');
  assert.equal(later[0].severity, 'critical', 'approved money without a checkout is critical');
  assert.equal(later[0].blocks, true);
});

test('A3 the orphan inbox escalates when the same provider payment later carries money', () => {
  const s = scenario('orphan_severity_escalation_sql');
  assert.notEqual(s.pending[0].severity, 'critical');
  assert.equal(s.approved.length, 1);
  assert.equal(s.approved[0].severity, 'critical');
  assert.equal(s.approved[0].blocks, true);
  assert.equal(s.approved[0].status, 'open');
});

test('A4 a provider window larger than the provider pagination ceiling is still read completely', () => {
  const s = scenario('ledger_offset_ceiling');
  assert.equal(s.state.orders, 1, 'the payment behind 300 foreign rows was reached');
  assert.equal(s.state.cursor.window_end, null, 'the window completed');
  assert.ok(s.state.cursor.last_completed_at);
  assert.equal(s.state.cursor.consecutive_failures, 0);
  assert.ok(s.maxOffsetSeen <= 150, 'never asks past the provider ceiling (asked ' + s.maxOffsetSeen + ')');
});

test('A5 a payment that changes while the window is being paged is neither skipped nor left stale', () => {
  const s = scenario('ledger_update_during_sweep_no_skip');
  assert.equal(s.rows.length, 130, 'every one of the 130 provider payments has its row');
  const changed = s.rows.find(r => r.pid === '500003');
  assert.equal(changed.severity, 'critical', 'the payment that was approved mid-sweep ends critical');
  assert.equal(s.rows.filter(r => r.severity === 'critical').length, 1, 'nothing else changed');
  assert.equal(s.state.cursor.window_end, null);
});

test('A6 the ledger asks the provider with the documented ISO-8601 millisecond dates', () => {
  const s = scenario('ledger_date_format');
  assert.equal(s.state.orders, 1);
  assert.equal(s.state.cursor.consecutive_failures, 0);
  for (const search of s.searches) {
    assert.match(search.begin, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}[:][0-9]{2}[:][0-9]{2}[.][0-9]{3}Z$/);
    assert.match(search.end, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}[:][0-9]{2}[:][0-9]{2}[.][0-9]{3}Z$/);
  }
});

test('A7 a pending payment is re-read on a backoff until the provider settles it, then approved late', () => {
  const s = scenario('pending_revisited_with_backoff_until_terminal');
  assert.equal(s.e1, 1, 'the first read is scheduled');
  assert.equal(s.afterPending.intent.status, 'pending');
  assert.equal(s.e2, 0, 'one tick later the provider has just said "pending": no storm of reads');
  assert.equal(s.e3, 1, 'after the backoff it is read again');
  assert.equal(s.state.orders, 1, 'the late approval became an order');
  assert.equal(s.state.intent.status, 'completed');
});

test('A8 a checkout with only rejected payments closes with evidence instead of being read forever', () => {
  const s = scenario('rejected_checkout_closes_with_evidence');
  // The first read (a manual reconcile before the loop) is the first of the three required after the grace period.
  const total = s.enqueues.reduce((a, b) => a + b, 0);
  assert.equal(s.enqueues[0], 1, 'still being verified: ' + s.enqueues);
  assert.equal(total, 2, 'two more reads complete the three required readings, then it stops: ' + s.enqueues);
  assert.deepEqual(s.enqueues.slice(-3), [0, 0, 0], 'closed with evidence, not re-read forever');
});

test('A9 paid orders stay verified on a ladder and a refund made later in the panel is found', () => {
  const s = scenario('ladder_verifies_paid_orders_and_finds_late_refund');
  assert.equal(s.afterPaid.orders, 1);
  assert.ok(s.queued >= 1, 'an aged paid order is scheduled for verification');
  assert.equal(s.unverifiedAfterVerification, 0, 'verification closes the "unverified" finding');
  assert.ok(s.queuedLate >= 1, 'it keeps being verified');
  assert.ok(s.state.intent.refunded > 0, 'the late refund was found: ' + JSON.stringify(s.state.intent));
});

test('A10 a payment that fails for its OWN data again and again is stepped over, on record, and the window completes', () => {
  const s = scenario('ledger_poison_item_is_stepped_over');
  assert.equal(s.state.cursor.window_end, null, 'the window completed instead of freezing on the poison payment');
  assert.equal(s.state.payments.filter(p => p.status === 'rejected').length, 2, 'the payments before and AFTER the poison one were read');
  assert.deepEqual(s.stuck, [{ pid: '710000002', severity: 'critical', blocks: false, reason: s.stuck[0]?.reason }], 'one critical finding for a person');
  assert.match(s.stuck[0].reason, /payment/i);
  assert.ok(s.runs >= 5, 'it takes five failing runs, spaced by the backoff, before stepping over: ' + s.runs);
});

test('A11 the provider being down is never a reason to step over a payment', () => {
  const s = scenario('ledger_outage_never_steps_over');
  assert.equal(s.stuck, 0, 'no payment was parked');
  assert.equal(s.state.cursor.window_end !== null, true, 'the window stays open for when the provider is back');
  assert.ok(s.state.cursor.consecutive_failures >= 1);
});

test('A12 a probe is evidence only after the payments it read were persisted', () => {
  const s = scenario('probe_is_evidence_only_after_persisting');
  assert.equal(s.afterFailure, 0, 'a read whose persistence failed proves nothing');
  assert.equal(s.failed.retried, 1);
  assert.equal(s.recovered.completed, 1);
  assert.equal(s.afterSuccess, 1, 'recorded once the payments were persisted');
});
