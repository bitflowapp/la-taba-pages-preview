// A virtual clock for driving the REAL payment worker through slow providers and platform kills.
//
// The worker reads `Date.now()` for its budget; the simulated provider advances this clock by its latency instead
// of sleeping, so a scenario that "takes" 400 seconds runs in milliseconds. The Edge Functions platform kills a
// worker at a hard wall clock (150 s Free / 400 s paid): `killAfterMs` reproduces that kill — the very next boundary
// call (provider fetch or database call) fails with ProcessKilled and every later one fails too, as if the process
// was gone. Nothing the worker would have written after the kill reaches the database.
//
// Database leases are computed by PostgreSQL's real clock, which does not move with the virtual one. `onShift`
// is called (lazily, before the next database call) with the milliseconds that passed, so the scenario can age
// leases the same amount.

export class ProcessKilled extends Error {
  constructor(reason = 'process killed') { super(reason); this.name = 'ProcessKilled'; }
}

export class VirtualClock {
  constructor(start = Date.now()) {
    this.t = start;
    this.startedAt = start;
    this.killAfterMs = null;
    this.killAtCall = null;
    this.calls = 0;
    this.killed = false;
    this.pendingShiftMs = 0;
    this.timers = [];
    this.nextTimerId = 1;
  }

  now() { return this.t; }

  /** setTimeout / clearTimeout on virtual time (the adapter aborts slow provider calls with one). */
  setTimeout = (fn, ms) => {
    const id = this.nextTimerId++;
    this.timers.push({ id, at: this.t + Math.max(0, Number(ms) || 0), fn });
    return id;
  };

  clearTimeout = id => { this.timers = this.timers.filter(timer => timer.id !== id); };

  /** Starts one worker invocation: resets the kill watchdog. */
  begin({ killAfterMs = null, killAtCall = null } = {}) {
    this.startedAt = this.t;
    this.killAfterMs = killAfterMs;
    this.killAtCall = killAtCall;
    this.calls = 0;
    this.killed = false;
  }

  /**
   * Time passes inside the invocation (a provider answered slowly). Virtual timers that come due fire in order;
   * `stopWhen` lets the caller (a fetch) stop waiting as soon as one of them aborted it. Returns the ms that passed.
   */
  advance(ms, { stopWhen = null } = {}) {
    const target = this.t + ms;
    const from = this.t;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      const killAt = this.killAfterMs === null ? Infinity : this.startedAt + this.killAfterMs;
      if (next && next.at <= target && next.at <= killAt) {
        this.t = Math.max(this.t, next.at);
        this.timers.shift();
        next.fn();
        if (stopWhen && stopWhen()) break;
        continue;
      }
      this.t = Math.min(target, Math.max(this.t, killAt));
      break;
    }
    this.pendingShiftMs += this.t - from;
    if (this.killAfterMs !== null && this.t - this.startedAt >= this.killAfterMs) this.die('wall clock');
    return this.t - from;
  }

  /** Time passes between invocations (cron cadence, lease expiry, backoff). */
  idle(ms) {
    this.t += ms;
    this.pendingShiftMs += ms;
  }

  /** Counts a boundary call and kills the process when it is the chosen one. */
  boundary(kind) {
    if (this.killed) throw new ProcessKilled('process is gone');
    this.calls += 1;
    if (this.killAtCall !== null && this.calls === this.killAtCall) this.die(`call ${this.calls} (${kind})`);
  }

  die(reason) {
    this.killed = true;
    throw new ProcessKilled(reason);
  }

  takeShift() { const ms = this.pendingShiftMs; this.pendingShiftMs = 0; return ms; }
}

/** A Date whose "now" is the virtual clock (everything else behaves like Date). */
export function virtualDate(clock) {
  return class VirtualDate extends Date {
    constructor(...args) { if (args.length === 0) super(clock.now()); else super(...args); }
    static now() { return clock.now(); }
  };
}
