// The provider-ledger sweep (supabase/functions/_shared/ledger-sweep.ts): a keyset cursor that survives kills,
// payments that change while the window is being read, ties of the provider's timestamp and a wall-clock budget.
// Pure: the provider, the database and the clock are simulated here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceCursor, ledgerItemTime, providerDate, ProviderLedgerInconsistent, sweepLedgerWindow,
} from '../supabase/functions/_shared/ledger-sweep.ts';
import { Deadline, WorkerDeadlineExceeded } from '../supabase/functions/_shared/worker-deadline.ts';

const T0 = Date.parse('2026-10-22T12:00:00.000Z');
const END = T0 + 3_600_000;
const FOREVER = () => new Deadline(0, 1e12, () => 0);

class Killed extends Error {}

/** A provider ledger ordered by last update, filtered like the real search (begin <= date_last_updated <= end). */
function provider(items) {
  const state = { items, searches: [], onSearch: null };
  state.search = async (window, cursor, limit) => {
    state.searches.push({ at: cursor.at, skip: cursor.skip, limit });
    state.onSearch?.(state.searches.length);
    const rows = state.items
      .filter(item => item.dlu >= Date.parse(cursor.at) && item.dlu <= Date.parse(window.end))
      .sort((a, b) => a.dlu - b.dlu || a.id - b.id);
    return {
      total: rows.length,
      results: rows.slice(cursor.skip, cursor.skip + limit).map(item => ({ id: item.id, date_last_updated: new Date(item.dlu).toISOString() })),
    };
  };
  return state;
}

/** What the database keeps: a cursor that only moves forward, a done flag, and counters. */
function store(begin) {
  const state = { cursor: { at: begin, skip: 0 }, done: false, released: 0, checkpoints: 0, seen: 0 };
  state.checkpoint = async c => {
    state.checkpoints += 1;
    state.seen += c.seen;
    if (c.release) state.released += 1;
    if (c.done) { state.done = true; return true; }
    if (Date.parse(c.cursor.at) >= Date.parse(state.cursor.at)) state.cursor = { ...c.cursor };
    return true;
  };
  return state;
}

const windowFrom = (db, extra = {}) => ({
  business_id: 'b', environment: 'test', begin: new Date(T0).toISOString(), end: new Date(END).toISOString(),
  cursor_at: db.cursor.at, offset: db.cursor.skip, ...extra,
});

function depsFor(prov, db, handled, extra = {}) {
  return {
    search: (w, c, l) => prov.search(w, c, l),
    handle: async summary => { handled.push(summary.id); return { orphan: false, finalizeSessionId: null }; },
    finalize: async () => {},
    checkpoint: c => db.checkpoint(c),
    ...extra,
  };
}

test('every payment of a window is handled once, in order, never reading past a small offset', async () => {
  const prov = provider(Array.from({ length: 120 }, (_, i) => ({ id: i + 1, dlu: T0 + (i + 1) * 1000 })));
  const db = store(new Date(T0).toISOString());
  const handled = [];
  const run = await sweepLedgerWindow(depsFor(prov, db, handled), windowFrom(db), FOREVER());
  assert.equal(run.stopped, 'complete');
  assert.deepEqual(handled, Array.from({ length: 120 }, (_, i) => i + 1));
  assert.equal(db.done, true);
  assert.ok(prov.searches.every(s => s.skip <= 50), 'offset stays tiny: ' + JSON.stringify(prov.searches.map(s => s.skip)));
});

test('more payments at ONE timestamp than a page still make progress and none is lost', async () => {
  const prov = provider(Array.from({ length: 130 }, (_, i) => ({ id: i + 1, dlu: T0 + 5000 })));
  const db = store(new Date(T0).toISOString());
  const handled = [];
  const run = await sweepLedgerWindow(depsFor(prov, db, handled), windowFrom(db), FOREVER());
  assert.equal(run.stopped, 'complete');
  assert.equal(new Set(handled).size, 130);
  assert.equal(handled.length, 130, 'each exactly once');
});

test('a payment that changes after it was read is read again at its new position and nothing shifts away', async () => {
  const items = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, dlu: T0 + (i + 1) * 1000 }));
  const prov = provider(items);
  // After the first page, payment #3 (already handled) changes: it now sorts last, every later row moves up one place.
  prov.onSearch = n => { if (n === 2) items.find(item => item.id === 3).dlu = END - 1; };
  const db = store(new Date(T0).toISOString());
  const handled = [];
  const run = await sweepLedgerWindow(depsFor(prov, db, handled), windowFrom(db), FOREVER());
  assert.equal(run.stopped, 'complete');
  assert.equal(new Set(handled).size, 130, 'no payment skipped');
  assert.equal(handled.filter(id => id === 3).length, 2, 'the changed payment was handled again');
  assert.equal(handled.at(-1), 3, 'at its new position');
});

test('the window is only closed after the last row, and only the empty tail ends an empty window', async () => {
  const prov = provider([]);
  const db = store(new Date(T0).toISOString());
  const handled = [];
  const run = await sweepLedgerWindow(depsFor(prov, db, handled), windowFrom(db), FOREVER());
  assert.equal(run.stopped, 'complete');
  assert.equal(db.done, true);
  assert.equal(handled.length, 0);
});

test('a kill at ANY dependency call loses nothing, never rewinds the cursor and never closes the window early', async () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, dlu: T0 + Math.floor(i / 3) * 1000 })); // ties of three
  // Count the calls of one clean run.
  const clean = provider(items);
  const cleanDb = store(new Date(T0).toISOString());
  let calls = 0;
  const counting = { ...depsFor(clean, cleanDb, []) };
  for (const key of ['search', 'handle', 'finalize', 'checkpoint']) {
    const inner = counting[key];
    counting[key] = (...args) => { calls += 1; return inner(...args); };
  }
  await sweepLedgerWindow(counting, windowFrom(cleanDb), FOREVER(), { pageSize: 5, checkpointEvery: 2 });
  assert.ok(calls > 15);

  for (let point = 1; point <= calls; point += 1) {
    const prov = provider(items);
    const db = store(new Date(T0).toISOString());
    const handled = [];
    let count = 0;
    let dead = false;
    const guard = fn => async (...args) => {
      if (dead) throw new Killed('process gone');
      count += 1;
      if (count === point) { dead = true; throw new Killed('killed'); }
      return fn(...args);
    };
    const base = depsFor(prov, db, handled);
    const killedDeps = { search: guard(base.search), handle: guard(base.handle), finalize: guard(base.finalize), checkpoint: guard(base.checkpoint) };
    let before = Date.parse(db.cursor.at);
    await assert.rejects(sweepLedgerWindow(killedDeps, windowFrom(db), FOREVER(), { pageSize: 5, checkpointEvery: 2 }), Killed);
    assert.equal(db.done && handled.length < items.length, false, `kill at ${point}: closed before the last row`);
    assert.ok(Date.parse(db.cursor.at) >= before);
    // The next worker resumes from what the database kept.
    for (let resume = 0; resume < 10 && !db.done; resume += 1) {
      before = Date.parse(db.cursor.at);
      const run = await sweepLedgerWindow(depsFor(prov, db, handled), windowFrom(db), FOREVER(), { pageSize: 5, checkpointEvery: 2 });
      assert.ok(Date.parse(db.cursor.at) >= before, `kill at ${point}: cursor rewound`);
      if (run.stopped === 'complete') break;
    }
    assert.equal(db.done, true, `kill at ${point}: window completes after resuming`);
    assert.deepEqual([...new Set(handled)].sort((a, b) => a - b), items.map(i => i.id), `kill at ${point}: every payment handled`);
  }
});

test('out of time: it stops BEFORE starting what it cannot finish, keeps the progress and releases the lease', async () => {
  const prov = provider(Array.from({ length: 50 }, (_, i) => ({ id: i + 1, dlu: T0 + (i + 1) * 1000 })));
  const db = store(new Date(T0).toISOString());
  const clock = { now: 0 };
  const deadline = new Deadline(0, 110_000, () => clock.now);
  const handled = [];
  const deps = depsFor(prov, db, handled, {
    handle: async summary => { clock.now += 4_000; handled.push(summary.id); return { orphan: false, finalizeSessionId: null }; },
  });
  const run = await sweepLedgerWindow(deps, windowFrom(db), deadline);
  assert.equal(run.stopped, 'deadline');
  assert.ok(clock.now <= 110_000, 'never past the budget: ' + clock.now);
  assert.ok(handled.length >= 20 && handled.length < 50, 'about a hundred seconds of work: ' + handled.length);
  assert.equal(db.released, 1, 'the lease is released so the next run resumes immediately');
  assert.equal(db.done, false);
  // The next run starts where the first stopped: nothing is read twice.
  clock.now = 0;
  const next = await sweepLedgerWindow(depsFor(prov, db, handled, {
    handle: async summary => { clock.now += 4_000; handled.push(summary.id); return { orphan: false, finalizeSessionId: null }; },
  }), windowFrom(db), new Deadline(0, 110_000, () => clock.now));
  assert.ok(['complete', 'deadline'].includes(next.stopped));
  assert.equal(handled.length, new Set(handled).size, 'no payment handled twice across the two runs');
});

test('a provider call that runs out of time is a stop, not a failure', async () => {
  const prov = provider(Array.from({ length: 5 }, (_, i) => ({ id: i + 1, dlu: T0 + (i + 1) * 1000 })));
  const db = store(new Date(T0).toISOString());
  const handled = [];
  const deps = depsFor(prov, db, handled, { handle: async () => { throw new WorkerDeadlineExceeded(); } });
  const run = await sweepLedgerWindow(deps, windowFrom(db), FOREVER());
  assert.equal(run.stopped, 'deadline');
  assert.equal(db.released, 1);
  assert.equal(db.cursor.at, new Date(T0).toISOString(), 'no item was completed, the cursor did not move');
});

test('rows out of order (the provider ignored the query) fail loudly and never advance the cursor', async () => {
  const db = store(new Date(T0).toISOString());
  const deps = {
    search: async () => ({ total: 2, results: [
      { id: 1, date_last_updated: new Date(T0 + 5000).toISOString() },
      { id: 2, date_last_updated: new Date(T0 + 1000).toISOString() },
    ] }),
    handle: async () => ({ orphan: false, finalizeSessionId: null }),
    finalize: async () => {},
    checkpoint: c => db.checkpoint(c),
  };
  await assert.rejects(sweepLedgerWindow(deps, windowFrom(db), FOREVER()), ProviderLedgerInconsistent);
  assert.equal(db.done, false);
});

test('a lost lease stops the sweep without another write', async () => {
  const prov = provider(Array.from({ length: 30 }, (_, i) => ({ id: i + 1, dlu: T0 + (i + 1) * 1000 })));
  const db = store(new Date(T0).toISOString());
  const handled = [];
  let calls = 0;
  const run = await sweepLedgerWindow(depsFor(prov, db, handled, { checkpoint: async () => { calls += 1; return false; } }), windowFrom(db), FOREVER());
  assert.equal(run.stopped, 'lease_lost');
  assert.equal(calls, 1);
  assert.ok(handled.length <= 5);
});

test('provider dates: ISO-8601 with milliseconds in UTC; the cursor advances by timestamp and counts ties', () => {
  assert.equal(providerDate('2026-10-22T09:00:00.123456-03:00'), '2026-10-22T12:00:00.123Z');
  assert.throws(() => providerDate('not a date'), ProviderLedgerInconsistent);
  assert.equal(ledgerItemTime({ date_last_updated: '2026-10-22T12:00:00.000Z', date_created: '2026-10-01T00:00:00.000Z' }), T0);
  assert.equal(ledgerItemTime({ date_last_updated: null, date_created: '2026-10-22T12:00:00.000Z' }), T0);
  assert.throws(() => ledgerItemTime({}), ProviderLedgerInconsistent);
  assert.deepEqual(advanceCursor({ at: new Date(T0).toISOString(), skip: 0 }, T0 + 5), { at: new Date(T0 + 5).toISOString(), skip: 1 });
  assert.deepEqual(advanceCursor({ at: new Date(T0 + 5).toISOString(), skip: 1 }, T0 + 5), { at: new Date(T0 + 5).toISOString(), skip: 2 });
});
