// Real worker + real adapter + real PostgreSQL, SIMULATED Mercado Pago (no network, no real money).
// Each scenario runs in a child node (the vm-modules flag is needed) on a throw-away database cloned from
// TABA_LOCAL_DB. Findings covered: F06, F07, F08, F09, plus crash/duplicate/storm behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function scenario(name) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', path.join(ROOT, 'tests/support/worker-scenarios.mjs'), name], {
    encoding: 'utf8', timeout: 280000, maxBuffer: 32 * 1024 * 1024, env: process.env,
  });
  const line = r.stdout.split('\n').find(l => l.startsWith('RESULT_JSON '));
  if (!line) throw new Error(`scenario ${name} failed:\n${r.stderr.slice(0, 3000)}\n${r.stdout.slice(0, 1000)}`);
  return JSON.parse(line.slice('RESULT_JSON '.length));
}

test('F06 the worker finds the approved retry even though a rejected payment id is already pinned', () => {
  const s = scenario('f06_rejected_pinned_then_approved_retry');
  assert.equal(s.state.orders, 1);
  assert.equal(s.state.stock, 8);
  assert.equal(s.state.intent.provider_id, '991000002');
  assert.equal(s.state.intent.provider_status, 'approved');
  assert.equal(s.state.intent.status, 'completed');
  assert.ok(s.calls.some(c => c.startsWith('/v1/payments/search')), 'the reference is searched, not only the pinned id');
});

test('F07 a merchant-order 503 retries the job: no review, no lost payment, one order once it recovers', () => {
  const s = scenario('f07_merchant_order_503_then_ok');
  assert.equal(s.first.body.retried, 1);
  assert.equal(s.afterFirst.orders, 0);
  assert.notEqual(s.afterFirst.intent.status, 'security_review_required');
  assert.equal(s.afterFirst.intent.review, null);
  assert.equal(s.state.orders, 1);
  assert.equal(s.state.stock, 8);
  assert.equal(s.state.intent.status, 'completed');
});

test('F08 an approved payment on the second page of the provider search is found', () => {
  const s = scenario('f08_approved_on_second_page');
  assert.ok(s.searches.length >= 2, 'pagination is followed');
  assert.equal(s.state.orders, 1);
  assert.equal(s.state.intent.provider_id, '991000001');
  assert.equal(s.state.payments.length, 61, 'every attempt is recorded');
});

test('F04/F06 two approved payments: both recorded, one order, a critical discrepancy', () => {
  const s = scenario('two_approved_payments');
  assert.equal(s.state.orders, 1);
  assert.equal(s.state.stock, 8);
  assert.equal(s.state.payments.length, 2);
  assert.equal(s.state.payments.filter(p => p.financing).length, 1);
  assert.ok(s.state.discrepancies.some(d => d.kind === 'multiple_approved_payments' && d.status === 'open' && d.severity === 'critical'));
});

test('F09 a refund with a lost identity is parked: no POST, recovery blocked, a critical discrepancy, job completed', () => {
  const s = scenario('f09_unknown_refund_identity');
  assert.equal(s.run.body.completed, 1);
  assert.equal(s.run.body.retried, 0);
  assert.equal(s.refund.status, 'ambiguous');
  assert.equal(s.refund.provider_refund_id, null, 'the id is never guessed');
  assert.equal(s.posts.length, 0, 'nothing is sent to the provider');
  assert.equal(s.hold, 'refund_in_flight');
  assert.ok(s.state.discrepancies.some(d => d.kind === 'refund_identity_unknown' && d.status === 'open'));
});

test('F08 the ledger sweep finds an approved payment with no webhook, no job and no browser, and flags the orphan', () => {
  const s = scenario('f08_ledger_sweep_without_webhook');
  assert.equal(s.afterFirst.orders, 1, 'the purchase was materialized from the provider ledger alone');
  assert.equal(s.afterFirst.stock, 8);
  assert.ok(s.afterFirst.discrepancies.some(d => d.kind === 'orphan_provider_payment' && d.severity === 'critical'));
  assert.equal(s.state.orders, 1, 'a second pass does not duplicate');
  assert.equal(s.state.discrepancies.filter(d => d.kind === 'orphan_provider_payment').length, 1);
  assert.ok(s.state.cursor.last_completed_at, 'the window completed');
  assert.equal(s.state.cursor.window_end, null);
  assert.deepEqual(s.outsideCalls, [], 'payments of other commerce references are not even fetched');
});

test('a crash between recording and finalizing is completed by the next run exactly once', () => {
  const s = scenario('crash_before_finalize_then_retry');
  assert.equal(s.first.body.retried, 1);
  assert.equal(s.afterFirst.orders, 0);
  assert.equal(s.afterFirst.intent.status, 'approved_order_pending');
  assert.equal(s.state.orders, 1);
  assert.equal(s.state.stock, 8);
  assert.equal(s.state.reservations.filter(r => r.status === 'converted').length, 1);
});

test('a provider outage during the ledger window leaves the cursor in place and backs off', () => {
  const s = scenario('ledger_provider_down');
  assert.equal(s.first.body.ledger.ok, false);
  assert.equal(s.state.cursor.consecutive_failures, 1);
  assert.equal(s.state.cursor.last_completed_at, null);
  assert.ok(s.state.cursor.window_end, 'the unfinished window is preserved');
  assert.equal(s.second.body.ledger, null, 'inside the backoff the next run does not hammer the provider');
  assert.equal(s.searches, 1);
});

test('replaying the same reconciliation five times never double-books and stays cheap', () => {
  const s = scenario('replay_storm_is_idempotent');
  assert.equal(s.state.orders, 1);
  assert.equal(s.state.stock, 8);
  assert.equal(s.state.reservations.filter(r => r.status === 'converted').length, 1);
  assert.ok(s.providerCalls <= 5 * 6, 'bounded provider calls: ' + s.providerCalls);
});
