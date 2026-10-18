import { transition, type Bounty, type InternalEvent } from "@bitbounty/core";
import type { BountyRepo } from "../bounties/repo.js";
import type { EventBus } from "../github/pr/ports.js";
import type { PayoutRequest } from "../payouts/service.js";

/** `payout.started` couldn't move the bounty to `paying`: the payout must not go out. */
export class PayoutNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutNotAllowedError";
  }
}

/**
 * The glue between the blocks that move a bounty after the PR: nobody else listens for these.
 *
 *   verify.done (A2)          → records the verdict on the `submitted` bounty
 *   pr.merged / maintainer.pay → bounty `verified` → starts the payout (B2) after the objection window
 *                                (`/pay now` → no window; `/pay @user` → pays @user, not the claimant)
 *   payout.started/succeeded/failed (B2) → `paying` / `paid` / `payout_failed`, published on the bus
 *   funding.paid, pr.linked, verify.done, pr.merged, payout.* → status comment re-rendered (`sync`)
 *
 * Every status change goes through `transition()` and a compare-and-set `repo.update()`.
 *
 * Why the objection window can't pay a bounty that was put on hold:
 * - when the timer fires, the bounty is read again and the payout starts only if it is still
 *   `verified` (a `/hold` or `/reject` during the window leaves it `on_hold` / `funded`);
 * - only the latest timer per bounty may start a payout: `/hold` and `/reject` cancel the
 *   pending one, and a new `/pay` or a redelivered merge replaces it (one start, not two);
 * - `PayoutService.start()` keeps one payout row per bounty, and `payout.started` moves the bounty
 *   to `paying` before any Bitnob call (B6: if that save fails, `applyPayoutEvent` throws and the
 *   payout service sends nothing), so a later merge or `/pay` (also after a restart) finds it
 *   `paying` / `paid` / `payout_failed` and starts nothing (the state machine refuses `/pay` there).
 *
 * Who is paid: the active claimant, unless the `/pay @user` that verified the bounty named someone
 * else (the comment handler only lets that through when @user has a payout account). The recipient
 * travels with the window timer; a redelivered merge that replaces the timer keeps it.
 *
 * Restart: payouts are in Postgres when DATABASE_URL is set (B6, `DrizzlePayoutStore`) and resume
 * on boot. The window timers still live in this process: a bounty whose timer was lost stays
 * `verified`; a maintainer restarts the window with `/hold` then `/pay`.
 */
export interface SettlementDeps {
  repo: Pick<BountyRepo, "findById" | "update" | "activeClaimant">;
  bus: EventBus;
  /** B2's `PayoutService.start`. Absent → verified bounties wait (no Bitnob keys). */
  startPayout?: (req: PayoutRequest) => Promise<unknown>;
  /** Re-renders the GitHub status comment + label for the bounty. */
  sync?: (bounty: Bounty) => Promise<void>;
  /** Delay between `verified` and the payout (product: 24 h; demo: 0). */
  objectionMs?: number;
  schedule?: (fn: () => void, ms: number) => void;
  log?: Pick<Console, "info" | "warn" | "error">;
}

/** Bus events after which the status comment should be re-rendered (G3 and G5 sync their own). */
const SYNC_ON = ["funding.paid", "pr.linked", "verify.done", "pr.merged", "payout.started", "payout.succeeded", "payout.failed"] as const;

export class Settlement {
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private readonly schedule: (fn: () => void, ms: number) => void;
  /** The one objection-window timer per bounty allowed to start its payout, and who it pays (`/pay @user`). */
  private readonly pending = new Map<string, { token: symbol; toLogin?: string }>();
  /** Bounties whose `startPayout` call is running in this process. */
  private readonly starting = new Set<string>();

  constructor(private readonly deps: SettlementDeps) {
    this.log = deps.log ?? console;
    this.schedule = deps.schedule ?? ((fn, ms) => void (ms > 0 ? setTimeout(fn, ms) : queueMicrotask(fn)));
  }

  register(): this {
    const { bus } = this.deps;
    bus.subscribe("verify.done", (e) => this.onVerifyDone(e));
    // A (redelivered) merge keeps the recipient of the timer it replaces.
    bus.subscribe("pr.merged", (e) => this.payIfVerified(e.bountyId, { toLogin: this.pending.get(e.bountyId)?.toLogin }));
    // `/pay now` skips the objection window; plain `/pay` waits it like a merge. `/pay @user` pays @user.
    bus.subscribe("maintainer.pay", (e) => this.payIfVerified(e.bountyId, { now: e.now === true, toLogin: e.toLogin }));
    // Leaving `verified` during the window cancels its timer (the timer re-checks the status anyway).
    bus.subscribe("maintainer.hold", (e) => void this.pending.delete(e.bountyId));
    bus.subscribe("maintainer.reject", (e) => void this.pending.delete(e.bountyId));
    for (const type of SYNC_ON) bus.subscribe(type, (e) => this.sync(e.bountyId));
    return this;
  }

  /**
   * The payout service's `emit`: applies its payout events to the bounty, then publishes them.
   *
   * `payout.started` is the gate before any money moves: if the bounty can't be moved to `paying`
   * (on hold, gone, or the compare-and-set kept failing), this **throws** `PayoutNotAllowedError`
   * and the payout service sends nothing to Bitnob. A bounty already `paying` (the same attempt
   * resumed after a restart) is accepted without publishing the event again.
   *
   * `payout.succeeded` / `payout.failed` the bounty can't take (e.g. a replay after `paid`) are
   * logged and dropped: they report money that already moved, they don't gate it.
   */
  readonly applyPayoutEvent = async (event: InternalEvent): Promise<void> => {
    if (event.type !== "payout.started" && event.type !== "payout.succeeded" && event.type !== "payout.failed") {
      await this.deps.bus.publish(event);
      return;
    }
    const applied = await this.apply(event);
    if (applied) {
      await this.deps.bus.publish(event);
      return;
    }
    if (event.type === "payout.started") {
      const now = await this.deps.repo.findById(event.bountyId);
      if (now?.status === "paying") return;
      throw new PayoutNotAllowedError(`bounty ${event.bountyId} is ${now?.status ?? "missing"}, not moved to paying`);
    }
  };

  private async onVerifyDone(event: Extract<InternalEvent, { type: "verify.done" }>) {
    const bounty = await this.deps.repo.findById(event.bountyId);
    // After the merge the verdict no longer matters: the bounty is verified or waiting for /pay.
    if (!bounty || bounty.status !== "submitted") return;
    await this.apply(event);
  }

  private async payIfVerified(bountyId: string, opts: { now?: boolean; toLogin?: string } = {}) {
    const bounty = await this.deps.repo.findById(bountyId);
    if (!bounty || bounty.status !== "verified") return;
    if (!this.deps.startPayout) {
      this.log.warn(`[settlement] bounty ${bountyId} is verified but payouts aren't configured (Bitnob keys)`);
      return;
    }
    const toLogin = opts.toLogin?.trim() || undefined;
    if (!toLogin && !(await this.deps.repo.activeClaimant(bountyId))) {
      this.log.error(`[settlement] bounty ${bountyId} is verified but has no claimant to pay`);
      return;
    }
    // A newer timer replaces an older one (redelivered merge, /hold then /pay): only it may pay.
    const token = Symbol(bountyId);
    this.pending.set(bountyId, toLogin ? { token, toLogin } : { token });
    const delay = opts.now ? 0 : (this.deps.objectionMs ?? 0);
    this.schedule(() => void this.payAfterWindow(bountyId, token), delay);
  }

  /** The end of the objection window: pays only if this is still the bounty's timer and it is still `verified`. */
  private async payAfterWindow(bountyId: string, token: symbol) {
    const timer = this.pending.get(bountyId);
    if (timer?.token !== token) return;
    this.pending.delete(bountyId);
    const start = this.deps.startPayout;
    if (!start || this.starting.has(bountyId)) return;
    this.starting.add(bountyId);
    try {
      const bounty = await this.deps.repo.findById(bountyId);
      if (!bounty || bounty.status !== "verified") {
        this.log.info(`[settlement] bounty ${bountyId} is ${bounty?.status ?? "gone"} at the end of the objection window, no payout`);
        return;
      }
      let userId: string;
      if (timer.toLogin) {
        userId = `github:${timer.toLogin}`;
      } else {
        const claimant = await this.deps.repo.activeClaimant(bountyId);
        if (!claimant) {
          this.log.error(`[settlement] bounty ${bountyId} is verified but has no claimant to pay`);
          return;
        }
        userId = claimant.userId;
      }
      await start({ bountyId, userId, amountXof: bounty.amountXof });
    } catch (err) {
      this.log.error(`[settlement] payout for ${bountyId} failed to start: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.starting.delete(bountyId);
    }
  }

  /** transition() + compare-and-set, retried once if the bounty moved under us. */
  private async apply(event: InternalEvent): Promise<Bounty | undefined> {
    for (let i = 0; i < 2; i++) {
      const bounty = await this.deps.repo.findById(event.bountyId);
      if (!bounty) {
        this.log.error(`[settlement] ${event.type}: bounty ${event.bountyId} not found`);
        return undefined;
      }
      const r = transition(bounty, event);
      if (!r.ok) {
        this.log.warn(`[settlement] ${event.type} ignored for bounty ${bounty.id}: ${r.message}`);
        return undefined;
      }
      const saved = await this.deps.repo.update(r.bounty, r.from);
      if (saved) return saved;
    }
    this.log.error(`[settlement] ${event.type}: bounty ${event.bountyId} kept changing, not applied`);
    return undefined;
  }

  private async sync(bountyId: string) {
    if (!this.deps.sync) return;
    const bounty = await this.deps.repo.findById(bountyId);
    if (!bounty) return;
    await this.deps.sync(bounty).catch((err) =>
      this.log.error(`[settlement] status comment for ${bountyId} not updated: ${err instanceof Error ? err.message : err}`),
    );
  }
}

/** Longest delay `setTimeout` honours (~24.8 days); above it, Node fires the timer at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * `OBJECTION_WINDOW_MINUTES` in ms. Empty = 0 (the demo). Anything that isn't a number of minutes
 * from 0 to ~24.8 days throws at boot: a typo must never turn into "pay at once".
 */
export function readObjectionWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OBJECTION_WINDOW_MINUTES?.trim();
  if (!raw) return 0;
  const minutes = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  const ms = Math.round(minutes * 60_000);
  if (!Number.isFinite(ms) || ms > MAX_TIMER_MS) {
    throw new Error(
      `OBJECTION_WINDOW_MINUTES must be a number of minutes from 0 to ${Math.floor(MAX_TIMER_MS / 60_000)} (got "${raw}")`,
    );
  }
  return ms;
}
