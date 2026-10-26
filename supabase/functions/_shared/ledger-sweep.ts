// Reads one provider-ledger window by LAST UPDATE with a keyset cursor.
//
// Why a keyset (a timestamp, plus a position only inside one timestamp) and not a page position:
//  - the provider caps `offset` (10 000), a busy window can exceed it;
//  - a payment that was already read and changes while the window is being paged leaves the ordered list, which
//    shifts every later row up by one: paging by position skips one payment per change;
//  - the cursor must survive the process being killed at any instant, so it is persisted every few items and at the
//    end of every page, not only when a page is complete.
// Every handled item is idempotent in the database, so re-reading a few items after a kill is safe; what is never
// allowed is moving the cursor past an item that was not handled.
//
// Ties have no guaranteed secondary ordering. A dense group is enumerated in an
// exact timestamp window, and advances only after its unique IDs cover the
// provider's stable total. Durable checkpoints always replay the last timestamp.
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

/**
 * The cursor after `handled` rows of a page that was read at `queried` were handled, the last of them at `itemMs`.
 * While every handled row shares the timestamp the page was read at, the position inside that group is all there is;
 * as soon as a later timestamp is reached the cursor is that timestamp at position 0.
 */
export function nextCursor(queried: LedgerCursor, handled: number, onlyQueriedTimestamp: boolean, itemMs: number): LedgerCursor {
  if (onlyQueriedTimestamp) return { at: queried.at, skip: queried.skip + handled };
  return { at: new Date(itemMs).toISOString(), skip: 0 };
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
    skip: 0, // An offset from a previous process cannot prove coverage of reordered ties.
  };
  const windowEnd = Date.parse(window.end);
  let pages = 0;
  let seen = 0;
  let orphans = 0;
  let pendingSeen = 0;
  let pendingOrphans = 0;
  let sinceCheckpoint = 0;

  const flush = async (done: boolean, release: boolean): Promise<boolean> => {
    const ok = await deps.checkpoint({ cursor: { at: cursor.at, skip: 0 }, seen: pendingSeen, orphans: pendingOrphans, done, release });
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

    const queried = cursor;
    let page: LedgerPage;
    try {
      page = await deps.search(window, queried, pageSize);
    } catch (error) {
      if (error instanceof WorkerDeadlineExceeded) return await stop('deadline', false, true);
      await flushBeforeFailing();
      throw error;
    }
    pages += 1;
    if (!page.results.length) {
      // An empty page is the end of the window only when the provider's own total agrees. Otherwise its index is
      // inconsistent right now and closing the window would hide the rows it still reports.
      if (queried.skip < page.total) {
        await flushBeforeFailing();
        throw new ProviderLedgerInconsistent('provider ledger returned an empty page before its total');
      }
      return await stop('complete', true, false);
    }

    const queriedMs = Date.parse(queried.at);
    // An incomplete page made only of the cursor timestamp may hide more members of that group, whether the page was
    // full or the provider answered short (a partial response with an honest total). Offset alone can return the
    // same IDs twice and skip others. Query exactly this timestamp, keep unique IDs in memory, and require complete
    // coverage. A crash replays this entire group; database effects are idempotent.
    if (page.total > page.results.length && page.results.every(row => ledgerItemTime(row) === queriedMs)) {
      const covered = new Set<string>();
      const groupWindow = { ...window, begin: queried.at, end: queried.at, cursor_at: queried.at, offset: 0 };
      let expected: number | null = null;
      let offset = 0;
      let rounds = 0;
      while (expected === null || covered.size < expected) {
        if (deadline.expired(pageReserve)) return await stop('deadline', false, true);
        let group: LedgerPage;
        try { group = await deps.search(groupWindow, { at: queried.at, skip: offset }, pageSize); }
        catch (error) {
          if (error instanceof WorkerDeadlineExceeded) return await stop('deadline', false, true);
          await flushBeforeFailing(); throw error;
        }
        pages += 1;
        if (!Number.isSafeInteger(group.total) || group.total <= 0 || group.total > 10_000
            || (expected !== null && group.total !== expected)) {
          await flushBeforeFailing();
          throw new ProviderLedgerInconsistent('provider timestamp group total changed or exceeds safe pagination');
        }
        expected = group.total;
        for (const summary of group.results) {
          if (deadline.expired(itemReserve)) return await stop('deadline', false, true);
          const id = String(summary.id ?? '');
          if (!id || ledgerItemTime(summary) !== queriedMs) {
            await flushBeforeFailing();
            throw new ProviderLedgerInconsistent('provider ignored exact timestamp window');
          }
          if (covered.has(id)) continue;
          try {
            const outcome = await deps.handle(summary);
            if (outcome.finalizeSessionId) await deps.finalize(outcome.finalizeSessionId);
            covered.add(id);
            seen += 1; pendingSeen += 1; sinceCheckpoint += 1;
            if (outcome.orphan) { orphans += 1; pendingOrphans += 1; }
          } catch (error) {
            if (error instanceof WorkerDeadlineExceeded) return await stop('deadline', false, true);
            await flushBeforeFailing(); throw error;
          }
          if (sinceCheckpoint >= every && !(await flush(false, false))) {
            return { stopped: 'lease_lost', pages, seen, orphans, cursor };
          }
        }
        if (covered.size > expected) throw new ProviderLedgerInconsistent('provider timestamp group exceeds reported total');
        // Advance by what the provider actually returned: a short page must not leave an unread gap behind it.
        offset += group.results.length || pageSize;
        if (offset >= expected && covered.size < expected) {
          offset = 0; rounds += 1;
          if (rounds >= 3) {
            await flushBeforeFailing();
            throw new ProviderLedgerInconsistent('provider timestamp group coverage incomplete');
          }
        }
      }
      // Date filters use inclusive milliseconds. Every member of this instant
      // was handled, so the next instant is the first safe forward position.
      if (queriedMs >= windowEnd) return await stop('complete', true, false);
      cursor = { at: new Date(queriedMs + 1).toISOString(), skip: 0 };
      if (!(await flush(false, false))) return { stopped: 'lease_lost', pages, seen, orphans, cursor };
      continue;
    }
    let previousMs = queriedMs;
    let handledInPage = 0;
    let onlyQueriedTimestamp = true;
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
        handledInPage += 1;
        if (itemMs !== queriedMs) onlyQueriedTimestamp = false;
        cursor = nextCursor(queried, handledInPage, onlyQueriedTimestamp, itemMs);
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
    if (queried.skip + page.results.length >= page.total) return await stop('complete', true, false);
    if (!(await flush(false, false))) return { stopped: 'lease_lost', pages, seen, orphans, cursor };
  }
}
