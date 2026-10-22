// The time budget of one Edge Function invocation (supabase/functions/_shared/worker-deadline.ts).
// Supabase kills a worker at 150 s (Free) / 400 s (paid); the worker must plan to end well before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Deadline, WorkerDeadlineExceeded, workerTimeBudget, DEFAULT_WALL_CLOCK_MS } from '../supabase/functions/_shared/worker-deadline.ts';

const env = values => name => values[name];

test('the default budget ends 40 s before the Free plan wall clock; paid plans get proportionally more', () => {
  const free = workerTimeBudget(env({}));
  assert.equal(free.wallClockMs, 150_000);
  assert.equal(free.budgetMs, 110_000);
  assert.equal(free.jobBudgetMs, 66_000, 'one job may use at most 60% of the budget');
  const paid = workerTimeBudget(env({ PAYMENT_WORKER_WALL_CLOCK_MS: '400000' }));
  assert.equal(paid.budgetMs, 360_000);
  assert.equal(DEFAULT_WALL_CLOCK_MS, 150_000);
});

test('a missing, malformed or out-of-range wall clock falls back to the Free plan limit', () => {
  // Below 90 s the budget could not hold the time needed to start a job in the jobs phase: not a real plan limit.
  for (const bad of ['', 'abc', '-1', '1000', '30000', '89999', '999999', '1.5']) {
    assert.equal(workerTimeBudget(env({ PAYMENT_WORKER_WALL_CLOCK_MS: bad })).wallClockMs, 150_000, bad);
  }
  assert.equal(workerTimeBudget(env({ PAYMENT_WORKER_WALL_CLOCK_MS: '90000' })).budgetMs, 50_000);
});

test('remaining time, reserves and the provider call timeout never exceed the budget', () => {
  const clock = { now: 1_000 };
  const deadline = new Deadline(1_000, 100_000, () => clock.now);
  assert.equal(deadline.remainingMs(), 100_000);
  assert.equal(deadline.callTimeoutMs(12_000), 12_000);
  clock.now += 90_000;
  assert.equal(deadline.remainingMs(), 10_000);
  assert.equal(deadline.callTimeoutMs(12_000), 8_000, 'clamped to what is left minus the reserve to persist');
  clock.now += 7_500;
  assert.throws(() => deadline.callTimeoutMs(12_000), WorkerDeadlineExceeded, 'not enough time to even try');
  assert.equal(deadline.expired(5_000), true);
  assert.equal(deadline.expired(1_000), false);
  assert.throws(() => deadline.assertTime(5_000), WorkerDeadlineExceeded);
  clock.now += 10_000;
  assert.equal(deadline.expired(), true);
});

test('a slice starts now and never outlives its parent', () => {
  const clock = { now: 0 };
  const parent = new Deadline(0, 100_000, () => clock.now);
  clock.now = 70_000;
  const slice = parent.slice(66_000);
  assert.equal(slice.remainingMs(), 30_000, 'capped by the parent');
  const small = parent.slice(10_000);
  assert.equal(small.remainingMs(), 10_000);
  clock.now = 85_000;
  assert.equal(small.remainingMs(), -5_000 + 0, 'ends at its own limit');
  assert.equal(parent.remainingMs(), 15_000);
});
