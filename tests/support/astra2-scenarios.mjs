// node --experimental-vm-modules tests/support/astra2-scenarios.mjs <scenario> [arg]
// Second independent audit (Astra): late payment changes, worker time budget, recovery from kills.
// Drives the REAL payment worker + adapter against REAL PostgreSQL with a SIMULATED Mercado Pago and a VIRTUAL
// clock. Prints one JSON document (RESULT_JSON ...). Asserted by tests/db/astra2-*.test.mjs.
import { createFixture, dropDatabases, query as q, RECOVERY_ENV, FIXTURE_IDS } from './worker-fixture.mjs';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = ms => new Date(ms).toISOString();
const ago = ms => iso(Date.now() - ms);
const orphanRef = i => `taba2:checkout:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const hasColumn = (t, table, column) => q(t.db, `select to_jsonb(exists(select 1 from information_schema.columns where table_schema='public' and table_name='${table}' and column_name='${column}'))`) === true;

/** Runs the worker until the ledger window is complete (or the attempts run out); returns what each run did. */
async function drainLedger(t, { max = 8, killAfterMs = null } = {}) {
  const history = [];
  for (let i = 0; i < max; i += 1) {
    t.expireLeases();
    t.ledgerDue();
    const run = await t.worker.invoke({ killAfterMs });
    const state = t.state();
    history.push({ run: run.killed ? { killed: true } : { ledger: run.body?.ledger, claimed: run.body?.claimed }, cursor: state.cursor });
    if (!run.killed && state.cursor && state.cursor.window_end === null && state.cursor.last_completed_at) break;
  }
  return history;
}

/** Ages the money tracking of the fixture purchase: time passes for the provider verification rows. */
function agePayments(t, ms) {
  const x = `interval '${Math.round(ms / 1000)} seconds'`;
  const watch = hasColumn(t, 'payment_provider_payments', 'next_check_at') ? `, next_check_at = case when next_check_at is null then null else next_check_at - ${x} end` : '';
  t.sql(`set session_replication_role = replica;
    update public.payment_provider_payments set first_seen_at = first_seen_at - ${x}, last_seen_at = last_seen_at - ${x}${watch};
    update public.payment_events set server_recorded_at = server_recorded_at - ${x} where payment_intent_id = '${t.ids.intent}';`);
}

const scenarios = {
  // The seller refunds an approved, already completed payment from the Mercado Pago panel, days after it was
  // created. No webhook arrives. The only way to learn is to read the provider for CHANGES, not for creations.
  async refund_after_completion_is_seen() {
    const t = await createFixture('astra-refund', { connect: true });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved', created: ago(3 * DAY) });
    const first = await t.worker.invoke();
    const afterFirst = t.state();
    const refundedAt = iso(Date.now() - MINUTE);
    t.provider.addRefundTo(991000001, { id: 881000001, amount: 2500 }, refundedAt);
    t.provider.setStatus(991000001, 'refunded', refundedAt);
    const history = await drainLedger(t, { max: 3 });
    const hold = q(t.db, `select to_jsonb(private.payment_financial_hold('${t.ids.intent}'))`);
    return { first, afterFirst, history, state: t.state(), hold, searches: t.provider.searches };
  },

  // An offline (ticket) payment sits `pending` for days. It is approved long after the creation window. Meanwhile
  // nobody has a local checkout for it (orphan), so only the provider ledger can tell.
  async orphan_pending_then_approved_is_escalated() {
    const t = await createFixture('astra-orphan', { connect: true });
    const ref = orphanRef(7001);
    t.provider.addPayment({ id: 771000001, reference: ref, status: 'pending', created: ago(2 * DAY) });
    const first = await t.worker.invoke();
    const afterFirst = t.state();
    t.provider.setStatus(771000001, 'approved', iso(Date.now() - MINUTE));
    const history = await drainLedger(t, { max: 3 });
    return { first, afterFirst, history, state: t.state() };
  },

  // SQL contract of the orphan inbox: the same payment seen again with money must become critical and blocking.
  async orphan_severity_escalation_sql() {
    const t = await createFixture('astra-orphan-sql');
    const record = status => q(t.db, `select jsonb_build_object('id', public.record_orphan_provider_payment('${FIXTURE_IDS.business}','test',
      jsonb_build_object('id','771000009','status','${status}','external_reference','${orphanRef(7002)}','transaction_amount','2500.00','currency_id','ARS','collector_id','collector-retry','date_created',now()::text)))`);
    record('pending');
    const pending = t.state().discrepancies;
    record('approved');
    const approved = t.state().discrepancies;
    return { pending, approved };
  },

  // Provider window larger than the provider's own pagination ceiling: offset paging can never read past it.
  async ledger_offset_ceiling() {
    const t = await createFixture('astra-ceiling', { connect: true, providerOptions: { maxOffset: 150 } });
    const base = Date.now() - 3 * HOUR;
    for (let i = 0; i < 220; i += 1) t.provider.addPayment({ id: 100000 + i, reference: `someone-elses-order-${i}`, status: 'approved', created: iso(base + i * 1000) });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved', created: iso(base + 300 * 1000) });
    const history = await drainLedger(t, { max: 8 });
    return { history, state: t.state(), maxOffsetSeen: Math.max(...t.provider.searches.map(s => s.offset)) };
  },

  // A payment that was ALREADY read changes while the window is being paged: the rows after it shift, and a reader
  // that pages by position skips one. Orphans make every row observable (one discrepancy each).
  async ledger_update_during_sweep_no_skip() {
    const t = await createFixture('astra-shift', { connect: true });
    const base = Date.now() - 3 * HOUR;
    for (let i = 1; i <= 130; i += 1) t.provider.addPayment({ id: 500000 + i, reference: orphanRef(i), status: 'pending', created: iso(base + i * 1000) });
    t.provider.onCall(/\/v1\/payments\/search/, n => {
      // Payment #3 was already read; it changes now, just inside the open window (the provider stamps it "now").
      if (n === 2) {
        const end = q(t.db, `select to_jsonb(window_end) from public.provider_ledger_cursors where business_id='${FIXTURE_IDS.business}'`);
        t.provider.setStatus(500003, 'approved', iso(Date.parse(end) - 5));
      }
    });
    const history = await drainLedger(t, { max: 10 });
    const rows = q(t.db, `select coalesce(jsonb_agg(jsonb_build_object('pid',provider_payment_id,'severity',severity) order by provider_payment_id),'[]') from public.payment_discrepancies where kind='orphan_provider_payment'`);
    return { history, rows, state: t.state() };
  },

  // The documented date format (ISO-8601 with milliseconds): the begin/end sent to the provider must be exactly that.
  async ledger_date_format() {
    const t = await createFixture('astra-dates', { connect: true, providerOptions: { strictDates: true } });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    const history = await drainLedger(t, { max: 2 });
    return { history, state: t.state(), searches: t.provider.searches };
  },

  // A pending payment is re-read on a backoff (not on every scheduler tick) until the provider settles it.
  async pending_revisited_with_backoff_until_terminal() {
    const t = await createFixture('astra-pending');
    t.sql(`set session_replication_role = replica; update public.checkout_sessions set created_at = clock_timestamp() - interval '20 minutes' where id = '${t.ids.session}';`);
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'pending', created: ago(10 * MINUTE) });
    const enqueue = () => q(t.db, `select to_jsonb(public.enqueue_checkout_provider_probes())`);
    const e1 = enqueue();
    const r1 = await t.worker.invoke();
    const afterPending = t.state();
    const e2 = enqueue(); // one scheduler tick later: the provider answered "pending" a moment ago
    const r2 = await t.worker.invoke();
    // Time passes (past every backoff) and the provider approves it. No webhook arrives.
    agePayments(t, 3 * HOUR);
    t.provider.setStatus(991000001, 'approved', iso(Date.now() - MINUTE));
    const e3 = enqueue();
    const r3 = await t.worker.invoke();
    return { e1, e2, e3, r1: r1.body, r2: r2.body, r3: r3.body, afterPending, state: t.state() };
  },

  // A checkout whose only payments were rejected must reach a closed state WITH evidence (after the preference
  // expired, a 24 h grace and three later reads), not be re-read on every tick forever.
  async rejected_checkout_closes_with_evidence() {
    const t = await createFixture('astra-rejected');
    t.sql(`set session_replication_role = replica;
      update public.checkout_sessions set created_at = clock_timestamp() - interval '70 hours', expires_at = clock_timestamp() - interval '60 hours' where id = '${t.ids.session}';
      update public.inventory_reservations set created_at = clock_timestamp() - interval '70 hours', expires_at = clock_timestamp() - interval '60 hours' where checkout_session_id = '${t.ids.session}';`);
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'rejected', created: ago(65 * HOUR) });
    t.enqueueReconcile();
    await t.worker.invoke();
    const enqueues = [];
    for (let i = 0; i < 7; i += 1) {
      agePayments(t, 3 * HOUR);
      const n = q(t.db, `select to_jsonb(public.enqueue_checkout_provider_probes())`);
      enqueues.push(n);
      if (n > 0) await t.worker.invoke();
    }
    return { enqueues, state: t.state() };
  },

  // An approved, completed order keeps being verified against the provider on a ladder: it must not drift into
  // "unverified" just because time passed, and a late refund made in the provider panel must be found.
  async ladder_verifies_paid_orders_and_finds_late_refund() {
    const t = await createFixture('astra-ladder');
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved', created: ago(3 * DAY) });
    t.enqueueReconcile();
    await t.worker.invoke();
    const afterPaid = t.state();
    agePayments(t, 3 * DAY);
    const enqueue = () => q(t.db, `select to_jsonb(public.enqueue_checkout_provider_probes())`);
    const checks0 = q(t.db, `select to_jsonb(public.run_financial_integrity_checks())`);
    const unverifiedBefore = t.state().discrepancies.filter(d => d.kind === 'order_paid_unverified' && d.status !== 'resolved').length;
    t.sql(`update public.payment_discrepancies set status='resolved', resolved_at=now(), resolution='test_reset' where kind='order_paid_unverified' and status<>'resolved';`);
    const queued = enqueue();
    await t.worker.invoke();
    const checks1 = q(t.db, `select to_jsonb(public.run_financial_integrity_checks())`);
    const unverifiedAfterVerification = t.state().discrepancies.filter(d => d.kind === 'order_paid_unverified' && d.status !== 'resolved').length;
    // Now the seller refunds it from the Mercado Pago panel; no webhook.
    const at = iso(Date.now() - MINUTE);
    t.provider.addRefundTo(991000001, { id: 881000001, amount: 2500 }, at);
    t.provider.setStatus(991000001, 'refunded', at);
    agePayments(t, 5 * DAY); // the next rung of the ladder (7 days after the first sighting) is now due
    const queuedLate = enqueue();
    await t.worker.invoke();
    return { afterPaid, checks0, unverifiedBefore, queued, checks1, unverifiedAfterVerification, queuedLate, state: t.state() };
  },

  // ---- Worker time budget -------------------------------------------------------------------------------------

  // 50 slow payments on one ledger page: a page that does not fit in the wall clock must still make progress.
  async slow_ledger_page_makes_progress() {
    const t = await createFixture('astra-slowpage', { connect: true });
    const base = Date.now() - 2 * HOUR;
    for (let i = 0; i < 50; i += 1) t.provider.addPayment({ id: 300000 + i, reference: t.ids.reference, status: 'rejected', created: iso(base + i * 1000) });
    t.provider.slow(/\/v1\/payments\/\d+$/, 4000);
    const history = await drainLedger(t, { max: 8, killAfterMs: 150_000 });
    return { history, state: t.state(), fetched: t.provider.calls.filter(c => /\/v1\/payments\/\d+$/.test(c.path)).length };
  },

  // A reconcile job that can never finish inside one wall clock must not starve the queue (one job per invocation).
  async poison_job_does_not_starve_queue() {
    const t = await createFixture('astra-poison', { env: RECOVERY_ENV });
    for (let i = 0; i < 60; i += 1) t.provider.addPayment({ id: 400000 + i, reference: t.ids.reference, status: 'rejected', created: ago(HOUR - i * 1000) });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved', created: ago(30 * MINUTE) });
    t.provider.slow(/\/v1\/payments\/\d+$/, 3000);
    t.enqueueReconcile(); // poison: 61 slow reads, > 150 s
    t.enqueuePaymentJob('991000001'); // healthy: one read
    const history = [];
    for (let i = 0; i < 6; i += 1) {
      t.expireLeases();
      t.dueNow();
      const run = await t.worker.invoke({ killAfterMs: 150_000 });
      history.push({ killed: Boolean(run.killed), claimed: run.body?.claimed, completed: run.body?.completed, orders: t.state().orders });
    }
    return { history, state: t.state() };
  },

  // A batch of claimed jobs larger than the lease allows: nothing may be left claimed-but-never-run.
  async claimed_batch_outlives_lease() {
    const t = await createFixture('astra-batch');
    for (let i = 0; i < 12; i += 1) {
      t.provider.addPayment({ id: 200000 + i, reference: t.ids.reference, status: 'rejected', created: ago(HOUR - i * 1000) });
      t.enqueuePaymentJob(String(200000 + i));
    }
    t.provider.slow(/\/v1\/payments\/\d+$/, 11_000);
    const run = await t.worker.invoke({ killAfterMs: 150_000 });
    const afterFirst = t.state();
    const rest = [];
    for (let i = 0; i < 4 && !run.killed; i += 1) {
      t.expireLeases();
      t.dueNow();
      const next = await t.worker.invoke({ killAfterMs: 150_000 });
      rest.push({ killed: Boolean(next.killed), completed: next.body?.completed });
    }
    return { run: run.killed ? { killed: true } : run.body, afterFirst, rest, state: t.state(), virtualElapsedMs: t.clock.now() - t.clock.startedAt };
  },

  // ---- Kill at every boundary ---------------------------------------------------------------------------------

  // Count the boundary calls of one clean run, then replay killing at each one.
  async crash_count_jobs() {
    const t = await createFixture('astra-count-jobs');
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.enqueueReconcile();
    const run = await t.worker.invoke();
    return { calls: run.calls, state: t.state() };
  },
  async crash_at_jobs(point) {
    const t = await createFixture('astra-crash-jobs');
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.enqueueReconcile();
    const killedRun = await t.worker.invoke({ killAtCall: Number(point) });
    const afterKill = t.state();
    const runs = [];
    for (let i = 0; i < 6; i += 1) {
      t.expireLeases();
      t.dueNow();
      const run = await t.worker.invoke();
      runs.push({ killed: Boolean(run.killed), completed: run.body?.completed, retried: run.body?.retried });
      const active = t.state().jobs.filter(j => ['pending', 'claimed', 'processing', 'retry_wait'].includes(j.status)).length;
      if (!active) break;
    }
    return { killedRun, afterKill, runs, state: t.state() };
  },
  async crash_count_ledger() {
    const t = await createFixture('astra-count-ledger', { connect: true });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.provider.addPayment({ id: 991000002, reference: t.ids.reference, status: 'rejected' });
    t.provider.addPayment({ id: 771000001, reference: orphanRef(7101), status: 'approved' });
    const run = await t.worker.invoke();
    return { calls: run.calls, state: t.state() };
  },
  async crash_at_ledger(point) {
    const t = await createFixture('astra-crash-ledger', { connect: true });
    t.provider.addPayment({ id: 991000001, reference: t.ids.reference, status: 'approved' });
    t.provider.addPayment({ id: 991000002, reference: t.ids.reference, status: 'rejected' });
    t.provider.addPayment({ id: 771000001, reference: orphanRef(7101), status: 'approved' });
    const killedRun = await t.worker.invoke({ killAtCall: Number(point) });
    const afterKill = t.state();
    const history = await drainLedger(t, { max: 6 });
    // Recovery may also need the retry sweeps a scheduler would run.
    return { killedRun, afterKill, history, state: t.state() };
  },
};

const [, , name, arg] = process.argv;
if (!scenarios[name]) { console.error('unknown scenario ' + name); process.exit(2); }
try {
  const out = await scenarios[name](arg);
  console.log('RESULT_JSON ' + JSON.stringify(out));
} finally {
  dropDatabases();
}
