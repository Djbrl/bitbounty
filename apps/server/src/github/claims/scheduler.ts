/**
 * When claims run out. The interface is all the claim service sees, so pg-boss
 * (`send(..., { startAfter, singletonKey: claimId })`) or a DB poller can replace the
 * in-memory version without touching the expiry logic.
 */
export interface DueClaim {
  claimId: string;
  /** ISO date the claim runs out. */
  expiresAt: string;
}

export type DueHandler = (claim: DueClaim) => Promise<void>;

export interface ClaimScheduler {
  /** Arms (or re-arms, e.g. after `/extend`) the timer for a claim. */
  schedule(claim: DueClaim): void;
  /** Disarms it (`/unclaim`, PR linked). Unknown ids are a no-op. */
  cancel(claimId: string): void;
  /** Re-arms everything still pending (after a restart) and starts the periodic sweep. */
  start(onDue: DueHandler): Promise<void>;
  stop(): void;
}

export interface InMemorySchedulerOptions {
  /** Claims that should have a timer: the source of truth, read on start and every sweep. */
  pending: () => Promise<DueClaim[]>;
  /** How often the sweep runs. It catches timers lost to a restart, a sleep or a crash in a handler. */
  sweepMs: number;
  now?: () => number;
  log?: Pick<Console, "error">;
}

/** Node caps setTimeout at 2^31-1 ms (~24.8 days); longer waits fire early and re-arm. */
const MAX_DELAY = 2 ** 31 - 1;

/** setTimeout per claim, plus a sweep over `pending()` so a missed timer still fires. */
export class InMemoryClaimScheduler implements ClaimScheduler {
  private timers = new Map<string, { at: number; handle: ReturnType<typeof setTimeout> }>();
  private inFlight = new Set<string>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private onDue: DueHandler | null = null;
  /** After `stop()`, nothing arms a timer until `start()` again (I3: a stopped demo keeps its claims). */
  private stopped = false;

  constructor(private readonly opts: InMemorySchedulerOptions) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  schedule(claim: DueClaim): void {
    if (this.stopped) return;
    const at = Date.parse(claim.expiresAt);
    if (Number.isNaN(at)) return;
    this.cancel(claim.claimId);
    const handle = setTimeout(() => {
      this.timers.delete(claim.claimId);
      if (this.now() < at) this.schedule(claim); // capped delay: not due yet
      else void this.fire(claim);
    }, Math.min(Math.max(0, at - this.now()), MAX_DELAY));
    (handle as { unref?: () => void }).unref?.();
    this.timers.set(claim.claimId, { at, handle });
  }

  cancel(claimId: string): void {
    const t = this.timers.get(claimId);
    if (t) clearTimeout(t.handle);
    this.timers.delete(claimId);
  }

  /** Whether a timer is armed for this claim (tests). */
  armed(claimId: string): boolean {
    return this.timers.has(claimId);
  }

  async start(onDue: DueHandler): Promise<void> {
    this.onDue = onDue;
    this.stopped = false;
    await this.sweep();
    if (!this.sweeper) {
      this.sweeper = setInterval(() => void this.sweep(), this.opts.sweepMs);
      (this.sweeper as { unref?: () => void }).unref?.();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const id of [...this.timers.keys()]) this.cancel(id);
  }

  /** Fires what is due, arms what has no (or a stale) timer. */
  async sweep(): Promise<void> {
    let pending: DueClaim[];
    try {
      pending = await this.opts.pending();
    } catch (err) {
      this.opts.log?.error("[claims] sweep failed", err);
      return;
    }
    for (const c of pending) {
      const at = Date.parse(c.expiresAt);
      if (Number.isNaN(at)) continue;
      if (at <= this.now()) {
        this.cancel(c.claimId);
        await this.fire(c);
      } else if (this.timers.get(c.claimId)?.at !== at) {
        this.schedule(c);
      }
    }
  }

  private async fire(claim: DueClaim): Promise<void> {
    // The timer and the sweep can both see a due claim; run the handler once at a time.
    if (!this.onDue || this.inFlight.has(claim.claimId)) return;
    this.inFlight.add(claim.claimId);
    try {
      await this.onDue(claim);
    } catch (err) {
      this.opts.log?.error(`[claims] expiry of ${claim.claimId} failed; the sweep will retry`, err);
    } finally {
      this.inFlight.delete(claim.claimId);
    }
  }
}
