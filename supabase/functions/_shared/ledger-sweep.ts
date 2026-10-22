// Reads one provider-ledger window by LAST UPDATE with a keyset cursor.
//
// Why a keyset (timestamp + how many rows at that exact timestamp are done) and not a page position:
//  - the provider caps `offset` (10 000), a busy window can exceed it;
//  - a payment that was already read and changes while the window is being paged leaves the ordered list, which
//    shifts every later row up by one: paging by position skips one payment per change;
//  - the cursor must survive the process being killed at any instant, so it is persisted every few items and at the
//    end of every page, not only when a page is complete.
// Every handled item is idempotent in the database, so re-reading a few items after a kill is safe; what is never
// allowed is moving the cursor past an item that was not handled.
import { Deadline, WorkerDeadlineExceeded } from './worker-deadline.ts';

export const LEDGER_PAGE_SIZE = 50; // provider maximum
export const LEDGER_CHECKPOINT_EVERY = 5;
export const LEDGER_ITEM_RESERVE_MS = 8_000;
export const LEDGER_PAGE_RESERVE_MS = 10_000;

export type LedgerWindow = {
  business_id: string;
  environment: string;
  begin: string;
  end: string;
  cursor_at?: string | null;
  offset: number;
};
export type LedgerCursor = { at: string; skip: number };
export type LedgerPage = { results: Record<string, unknown>[]; total: number };
export type LedgerItemOutcome = { orphan: boolean; finalizeSessionId: string | null };
export type LedgerCheckpoint = { cursor: LedgerCursor; seen: number; orphans: number; done: boolean; release: boolean };
export type LedgerDeps = {
  search(window: LedgerWindow, cursor: LedgerCursor, limit: number): Promise<LedgerPage>;
  handle(summary: Record<string, unknown>): Promise<LedgerItemOutcome>;
  finalize(checkoutSessionId: string): Promise<void>;
  /** Persists progress and extends the lease. Returns false when the lease was lost (another worker owns it). */
  checkpoint(checkpoint: LedgerCheckpoint): Promise<boolean>;
};
export type LedgerRun = {
  stopped: 'complete' | 'deadline' | 'lease_lost';
  pages: number;
  seen: number;
  orphans: number;
  cursor: LedgerCursor;
};

export class ProviderLedgerInconsistent extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderLedgerInconsistent';
  }
}

/** The provider date format: ISO-8601 with milliseconds, UTC. */
export function providerDate(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new ProviderLedgerInconsistent('provider ledger date is not valid');
  return new Date(ms).toISOString();
}

/** The instant a provider payment last changed (falls back to its creation). */
export function ledgerItemTime(summary: Record<string, unknown>): number {
  for (const key of ['date_last_updated', 'date_created']) {
    const raw = summary[key];
    const ms = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    if (Number.isFinite(ms)) return ms;
  }
  throw new ProviderLedgerInconsistent('provider payment without a usable last-update date');
}

/** The cursor after one more item was handled. */
export function advanceCursor(cursor: LedgerCursor, itemMs: number): LedgerCursor {
  const at = Date.parse(cursor.at);
  if (itemMs > at) return { at: new Date(itemMs).toISOString(), skip: 1 };
  return { at: cursor.at, skip: cursor.skip + 1 };
}

export async function sweepLedgerWindow(
  deps: LedgerDeps,
  window: LedgerWindow,
  deadline: Deadline,
  options: { pageSize?: number; checkpointEvery?: number; itemReserveMs?: number; pageReserveMs?: number } = {},
): Promise<LedgerRun> {
  const pageSize = options.pageSize ?? LEDGER_PAGE_SIZE;
  const every = options.checkpointEvery ?? LEDGER_CHECKPOINT_EVERY;
  const itemReserve = options.itemReserveMs ?? LEDGER_ITEM_RESERVE_MS;
  const pageReserve = options.pageReserveMs ?? LEDGER_PAGE_RESERVE_MS;

  let cursor: LedgerCursor = {
    at: providerDate(window.cursor_at || window.begin),
    skip: Math.max(0, Number(window.offset) || 0),
  };
  const windowEnd = Date.parse(window.end);
  let pages = 0;
  let seen = 0;
  let orphans = 0;
  let pendingSeen = 0;
  let pendingOrphans = 0;
  let sinceCheckpoint = 0;

  const flush = async (done: boolean, release: boolean): Promise<boolean> => {
    const ok = await deps.checkpoint({ cursor, seen: pendingSeen, orphans: pendingOrphans, done, release });
    pendingSeen = 0;
    pendingOrphans = 0;
    sinceCheckpoint = 0;
    return ok;
  };
  // Progress made before an error is kept: the next run resumes there, not at the previous checkpoint.
  const flushBeforeFailing = async () => {
    if (sinceCheckpoint === 0) return; // no progress: the failure must count on its own
    try { await flush(false, false); } catch (_) { /* the original failure is what matters */ }
  };
  const stop = async (stopped: LedgerRun['stopped'], done: boolean, release: boolean): Promise<LedgerRun> => {
    if (stopped === 'lease_lost') return { stopped, pages, seen, orphans, cursor };
    const ok = await flush(done, release);
    return { stopped: ok ? stopped : 'lease_lost', pages, seen, orphans, cursor };
  };

  for (;;) {
    if (deadline.expired(pageReserve)) return await stop('deadline', false, true);

    let page: LedgerPage;
    try {
      page = await deps.search(window, cursor, pageSize);
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) return await stop('deadline', false, true);
      await flushBeforeFailing();
      throw error;
    }
    pages += 1;
    const skipAtQuery = cursor.skip;
    if (!page.results.length) return await stop('complete', true, false);

    let previousMs = Date.parse(cursor.at);
    for (const summary of page.results) {
      if (deadline.expired(itemReserve)) return await stop('deadline', false, true);
      try {
        const itemMs = ledgerItemTime(summary);
        // Rows must come back ordered by last update and never before the cursor; anything else means the provider
        // ignored the query, and moving the cursor on would hide payments.
        if (itemMs < previousMs || itemMs > windowEnd + 1) {
          throw new ProviderLedgerInconsistent('provider ledger rows are out of order');
        }
        previousMs = itemMs;
        const outcome = await deps.handle(summary);
        if (outcome.finalizeSessionId) await deps.finalize(outcome.finalizeSessionId);
        cursor = advanceCursor(cursor, itemMs);
        seen += 1;
        pendingSeen += 1;
        if (outcome.orphan) { orphans += 1; pendingOrphans += 1; }
        sinceCheckpoint += 1;
      } catch (error) {
        if (error instanceof WorkerDeadlineExceeded) return await stop('deadline', false, true);
        await flushBeforeFailing();
        throw error;
      }
      if (sinceCheckpoint >= every && !(await flush(false, false))) {
        return { stopped: 'lease_lost', pages, seen, orphans, cursor };
      }
    }

    // Every row the provider reported for [cursor, end] has been handled.
    if (skipAtQuery + page.results.length >= page.total) return await stop('complete', true, false);
    if (!(await flush(false, false))) return { stopped: 'lease_lost', pages, seen, orphans, cursor };
  }
}
