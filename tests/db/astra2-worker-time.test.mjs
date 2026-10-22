// Second independent audit (Astra), finding 2: the worker can outlive the time the platform gives it.
// Supabase Edge Functions are killed at a hard wall clock (150 s Free, 400 s paid; 2 s CPU, I/O wait excluded).
// Real worker + real PostgreSQL + SIMULATED provider on a VIRTUAL clock, with kills at a chosen second or at any
// chosen database/provider call. Red on the audited revision, green on the fixed one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from '../support/astra2-run.mjs';

const ACTIVE = ['pending', 'claimed', 'processing', 'retry_wait'];

test('B1 a ledger page that does not fit in one wall clock still makes progress and nothing is killed', () => {
  const s = scenario('slow_ledger_page_makes_progress');
  assert.equal(s.history.filter(h => h.run.killed).length, 0, 'the worker stops by itself before the platform kills it: ' + JSON.stringify(s.history.map(h => h.run.killed ?? h.run.ledger)));
  assert.equal(s.state.cursor.window_end, null, 'the window completed');
  assert.equal(s.state.payments.length, 50, 'every payment was recorded');
  assert.ok(s.fetched <= 60, 'finished work is not repeated after every stop: ' + s.fetched + ' reads for 50 payments');
});

test('B2 a job that cannot finish inside one wall clock does not starve the queue (one job per invocation)', () => {
  const s = scenario('poison_job_does_not_starve_queue');
  assert.equal(s.state.orders, 1, 'the healthy job behind the heavy one was processed: ' + JSON.stringify(s.history));
  assert.equal(s.history.filter(h => h.killed).length, 0, 'no invocation reached the platform kill');
});

test('B3 a batch of claimed jobs never leaves jobs claimed-but-never-run behind', () => {
  const s = scenario('claimed_batch_outlives_lease');
  assert.ok(!s.run.killed, 'the invocation ended on its own');
  assert.ok(s.virtualElapsedMs <= 150_000, 'inside the wall clock: ' + s.virtualElapsedMs);
  assert.equal(s.afterFirst.jobs.filter(j => j.status === 'claimed' || j.status === 'processing').length, 0, 'no job is held by a finished invocation');
  assert.ok(s.afterFirst.jobs.every(j => j.status === 'completed' || (ACTIVE.includes(j.status) && j.attempts === 0)), 'a job that never ran keeps its attempts: ' + JSON.stringify(s.afterFirst.jobs.map(j => [j.status, j.attempts])));
  assert.equal(s.state.jobs.filter(j => j.status === 'completed').length, 12, 'all twelve end completed');
  assert.ok(s.state.jobs.every(j => j.attempts <= 2), 'and none burned its retry budget on waiting: ' + JSON.stringify(s.state.jobs.map(j => j.attempts)));
});

function crashMatrix(kind) {
  const count = scenario(`crash_count_${kind}`);
  assert.ok(count.calls >= 5, 'the scenario has boundaries to cut: ' + count.calls);
  return { calls: count.calls, clean: count.state };
}

test('B4 killing the job path at EVERY boundary leaves exactly one order, one stock movement and no stuck job', () => {
  const { calls, clean } = crashMatrix('jobs');
  assert.equal(clean.orders, 1);
  const failures = [];
  for (let point = 1; point <= calls; point += 1) {
    const s = scenario('crash_at_jobs', point);
    const st = s.state;
    const problems = [];
    if (st.orders !== 1) problems.push(`orders=${st.orders}`);
    if (st.stock !== 8) problems.push(`stock=${st.stock}`);
    if (st.reservations.filter(r => r.status === 'converted').length !== 1) problems.push('reservations ' + JSON.stringify(st.reservations));
    if (st.intent.status !== 'completed') problems.push(`intent=${st.intent.status}`);
    if (st.payments.length !== 1) problems.push(`payments=${st.payments.length}`);
    if (st.jobs.some(j => ACTIVE.includes(j.status))) problems.push('active jobs ' + JSON.stringify(st.jobs.map(j => [j.status, j.attempts])));
    if (st.jobs.some(j => j.status === 'dead_letter' || j.status === 'failed')) problems.push('dead job');
    if (st.discrepancies.some(d => d.status !== 'resolved')) problems.push('discrepancy ' + JSON.stringify(st.discrepancies));
    if (problems.length) failures.push(`kill at call ${point}: ${problems.join('; ')}`);
  }
  assert.deepEqual(failures, [], 'recovery after a kill at any of ' + calls + ' boundaries');
});

test('B5 killing the ledger path at EVERY boundary loses nothing and duplicates nothing', () => {
  const { calls, clean } = crashMatrix('ledger');
  assert.equal(clean.orders, 1);
  const failures = [];
  for (let point = 1; point <= calls; point += 1) {
    const s = scenario('crash_at_ledger', point);
    const st = s.state;
    const problems = [];
    if (st.orders !== 1) problems.push(`orders=${st.orders}`);
    if (st.stock !== 8) problems.push(`stock=${st.stock}`);
    if (st.reservations.filter(r => r.status === 'converted').length !== 1) problems.push('reservations ' + JSON.stringify(st.reservations));
    if (st.payments.length !== 2) problems.push(`payments=${st.payments.length}`);
    const orphans = st.discrepancies.filter(d => d.kind === 'orphan_provider_payment');
    if (orphans.length !== 1 || orphans[0].severity !== 'critical') problems.push('orphans ' + JSON.stringify(orphans));
    if (st.discrepancies.some(d => d.kind === 'multiple_approved_payments' || d.kind === 'provider_payment_inconsistent')) problems.push('spurious discrepancy');
    if (!st.cursor || st.cursor.window_end !== null || !st.cursor.last_completed_at) problems.push('window not completed ' + JSON.stringify(st.cursor));
    if (st.jobs.some(j => ACTIVE.includes(j.status))) problems.push('active jobs');
    if (problems.length) failures.push(`kill at call ${point}: ${problems.join('; ')}`);
  }
  assert.deepEqual(failures, [], 'recovery after a kill at any of ' + calls + ' boundaries');
});
