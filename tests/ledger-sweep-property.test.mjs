// Property test for the provider-ledger sweep: a hostile provider (ties re-shuffled on EVERY query, short pages,
// payments appearing while the window is paged, transient failures) and a worker that is killed at random points.
//
// Oracle: a run may only report the window as complete when every payment that existed when the window was claimed
// (and was inside it) was handled at least once. Handling is idempotent in the database, so duplicates are fine;
// a payment that was never handled is money the system never looked at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepLedgerWindow, ProviderLedgerInconsistent } from '../supabase/functions/_shared/ledger-sweep.ts';
import { Deadline } from '../supabase/functions/_shared/worker-deadline.ts';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (list, rand) => { const a = [...list]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const BEGIN = Date.parse('2026-10-25T00:00:00.000Z');
const END = BEGIN + 60 * 60 * 1000;

function scenario(seed, { shortPages, inserts, flaky, kills }) {
  const rand = rng(seed);
  // Heavily clumped timestamps: a few instants own most of the payments (some groups exceed a page).
  const instants = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => BEGIN + Math.floor(rand() * 20) * 1000);
  const payments = Array.from({ length: 1 + Math.floor(rand() * 40) }, (_, i) => ({ id: `P${i}`, t: instants[Math.floor(rand() * instants.length)] }));
  const initial = payments.map(p => p.id);
  return { rand, payments, initial, shortPages, inserts, flaky, kills };
}

async function drive(seed, mode, pageSize) {
  const sc = scenario(seed, mode);
  const { rand, payments } = sc;
  const handled = new Set();
  let persisted = null;      // last durable cursor
  let completedAt = null;
  let nextId = 1000;
  let handles = 0;
  let killAt = mode.kills ? 1 + Math.floor(rand() * 12) : Infinity;
  let sinceKill = 0;
  const search = async (w, cursor, limit) => {
    if (mode.flaky && rand() < 0.08) throw new Error('transient provider failure');
    const begin = Date.parse(cursor.at);
    const end = Date.parse(w.end);
    const inRange = payments.filter(p => p.t >= begin && p.t <= end);
    const ordered = [...inRange].sort((a, b) => a.t - b.t || 0);
    // Ties: a fresh arbitrary order for every query (documented: no secondary key).
    const groups = new Map();
    for (const p of ordered) { if (!groups.has(p.t)) groups.set(p.t, []); groups.get(p.t).push(p); }
    const flat = [...groups.keys()].sort((a, b) => a - b).flatMap(t => shuffle(groups.get(t), rand));
    let take = limit;
    if (mode.shortPages) take = Math.max(1, Math.min(limit, 1 + Math.floor(rand() * limit)));
    const slice = flat.slice(cursor.skip, cursor.skip + take);
    if (mode.inserts && rand() < 0.3) {
      // A payment that changes/appears NOW has a last-update >= everything already read: inside [cursor, end].
      const t = Math.max(begin, ...slice.map(p => p.t)) + Math.floor(rand() * 3) * 1000;
      if (t <= END) payments.push({ id: `N${nextId++}`, t });
    }
    return { total: flat.length, results: slice.map(p => ({ id: p.id, date_last_updated: new Date(p.t).toISOString() })) };
  };
  const deps = {
    search,
    handle: async row => {
      if (sinceKill++ >= killAt) { sinceKill = 0; killAt = 1 + Math.floor(rand() * 12); throw new Error('process killed'); }
      handles += 1; handled.add(row.id); return { orphan: false, finalizeSessionId: null };
    },
    finalize: async () => {},
    checkpoint: async c => { persisted = c.cursor; if (c.done) completedAt = true; return true; },
  };
  let outcome = 'running';
  for (let run = 0; run < 400 && !completedAt; run += 1) {
    try {
      const window = { business_id: 'synthetic', environment: 'test', begin: new Date(BEGIN).toISOString(), end: new Date(END).toISOString(), cursor_at: persisted?.at ?? null, offset: persisted?.skip ?? 0 };
      const result = await sweepLedgerWindow(deps, window, new Deadline(Date.now(), 60000), { pageSize, checkpointEvery: 1 + Math.floor(rand() * 5) });
      outcome = result.stopped;
    } catch (error) {
      outcome = error instanceof ProviderLedgerInconsistent ? 'inconsistent' : 'error';
    }
  }
  return { sc, handled, completedAt: !!completedAt };
}

const MODES = [
  ['plain ties', { shortPages: false, inserts: false, flaky: false, kills: false }],
  ['short pages', { shortPages: true, inserts: false, flaky: false, kills: false }],
  ['inserts during the walk', { shortPages: false, inserts: true, flaky: false, kills: false }],
  ['transient errors', { shortPages: false, inserts: false, flaky: true, kills: false }],
  ['kills and restarts', { shortPages: false, inserts: false, flaky: false, kills: true }],
  ['everything at once', { shortPages: true, inserts: true, flaky: true, kills: true }],
];

for (const [label, mode] of MODES) {
  test(`ledger sweep never completes a window with an unseen payment: ${label}`, async () => {
    const violations = [];
    let completed = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      for (const pageSize of [2, 3, 50]) {
        const { sc, handled, completedAt } = await drive(seed * 7919 + pageSize, mode, pageSize);
        if (!completedAt) continue; // never closing is safe (it is an availability problem, not a financial one)
        completed += 1;
        const missing = sc.initial.filter(id => !handled.has(id));
        if (missing.length) violations.push({ seed, pageSize, missing });
      }
    }
    console.log(JSON.stringify({ mode: label, completedRuns: completed, violations: violations.length, first: violations[0] }));
    assert.deepEqual(violations, [], 'a window was reported complete while payments were never handled');
    assert.ok(completed > 0, 'the scenario never completed, so it proved nothing');
  });
}
