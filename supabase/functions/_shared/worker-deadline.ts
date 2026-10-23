// The time one Edge Function invocation may use.
//
// Supabase kills an Edge Function worker at a hard wall clock: 150 s on the Free plan, 400 s on paid plans (CPU time
// is a separate 2 s per request, I/O wait excluded). Anything that runs past it dies mid-write, so the worker plans
// for a budget that ends well before the kill and treats "out of time" as a normal, resumable outcome — never as a
// failure of the job or of the ledger window it was working on.
export const DEFAULT_WALL_CLOCK_MS = 150_000;
const SAFETY_MARGIN_MS = 40_000;
const MIN_BUDGET_MS = 20_000;

export class WorkerDeadlineExceeded extends Error {
  constructor() {
    super('worker time budget exhausted');
    this.name = 'WorkerDeadlineExceeded';
  }
}

export class Deadline {
  readonly startedAt: number;
  readonly budgetMs: number;
  private readonly clock: () => number;

  // Plain fields (no parameter properties) so the module also loads where TypeScript is only type-stripped.
  constructor(startedAt: number, budgetMs: number, clock: () => number = () => Date.now()) {
    this.startedAt = startedAt;
    this.budgetMs = budgetMs;
    this.clock = clock;
  }

  remainingMs(): number {
    return this.startedAt + this.budgetMs - this.clock();
  }

  /** True when less than `reserveMs` is left (the time needed to finish what would be started now). */
  expired(reserveMs = 0): boolean {
    return this.remainingMs() <= reserveMs;
  }

  assertTime(reserveMs = 0): void {
    if (this.expired(reserveMs)) throw new WorkerDeadlineExceeded();
  }

  /**
   * Timeout for one provider call: the usual cap, never more than what is left, and always leaving `reserveMs`
   * to persist the outcome. Throws when there is not enough time to even try.
   */
  callTimeoutMs(maxMs: number, reserveMs = 2_000): number {
    const available = this.remainingMs() - reserveMs;
    if (available < 1_000) throw new WorkerDeadlineExceeded();
    return Math.min(maxMs, available);
  }

  /** A deadline that starts now and ends at the earlier of `maxMs` from now and this deadline. */
  slice(maxMs: number): Deadline {
    return new Deadline(this.clock(), Math.max(0, Math.min(maxMs, this.remainingMs())), this.clock);
  }
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/**
 * PAYMENT_WORKER_WALL_CLOCK_MS is the platform limit of the plan the function runs on (150000 Free, 400000 paid).
 * The budget leaves a safety margin for the response, the last write and platform jitter.
 */
export function workerTimeBudget(read: (name: string) => string | undefined) {
  // Below 90 s the budget (wall clock - 40 s) could not hold the 15 s needed to start a job in the first 60%.
  const wallClockMs = integer(read('PAYMENT_WORKER_WALL_CLOCK_MS'), DEFAULT_WALL_CLOCK_MS, 90_000, 400_000);
  const budgetMs = Math.max(MIN_BUDGET_MS, wallClockMs - SAFETY_MARGIN_MS);
  return {
    wallClockMs,
    budgetMs,
    // A single job may use at most this share, so the ledger sweep and the next jobs always get their turn.
    jobBudgetMs: Math.floor(budgetMs * 0.6),
  };
}
