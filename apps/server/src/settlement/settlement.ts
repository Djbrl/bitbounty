import { transition, type Bounty, type InternalEvent } from "@bitbounty/core";
import type { BountyRepo } from "../bounties/repo.js";
import type { EventBus } from "../github/pr/ports.js";
import type { PayoutRequest } from "../payouts/service.js";

/**
 * The glue between the blocks that move a bounty after the PR: nobody else listens for these.
 *
 *   verify.done (A2)          → records the verdict on the `submitted` bounty
 *   pr.merged / maintainer.pay → bounty `verified` → starts the payout (B2) after the objection window
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
 *   to `paying` before any Bitnob call, so a later merge or `/pay` (also after a restart) finds it
 *   `paying` / `paid` / `payout_failed` and starts nothing (the state machine refuses `/pay` there).
 *
 * Restart: the window timers live in this process (B6 persists them). A bounty whose timer was lost
 * stays `verified`; a maintainer restarts the window with `/hold` then `/pay`.
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
  /** The one objection-window timer per bounty allowed to start its payout. */
  private readonly pending = new Map<string, symbol>();
  /** Bounties whose `startPayout` call is running in this process. */
  private readonly starting = new Set<string>();

  constructor(private readonly deps: SettlementDeps) {
    this.log = deps.log ?? console;
    this.schedule = deps.schedule ?? ((fn, ms) => void (ms > 0 ? setTimeout(fn, ms) : queueMicrotask(fn)));
  }

  register(): this {
    const { bus } = this.deps;
    bus.subscribe("verify.done", (e) => this.onVerifyDone(e));
    bus.subscribe("pr.merged", (e) => this.payIfVerified(e.bountyId));
    bus.subscribe("maintainer.pay", (e) => this.payIfVerified(e.bountyId));
    // Leaving `verified` during the window cancels its timer (the timer re-checks the status anyway).
    bus.subscribe("maintainer.hold", (e) => void this.pending.delete(e.bountyId));
    bus.subscribe("maintainer.reject", (e) => void this.pending.delete(e.bountyId));
    for (const type of SYNC_ON) bus.subscribe(type, (e) => this.sync(e.bountyId));
    return this;
  }

  /**
   * B2's `emit`: applies its payout events to the bounty, then publishes them.
   * A payout event the bounty can't take (e.g. a replay after `paid`) is logged and dropped.
   */
  readonly applyPayoutEvent = async (event: InternalEvent): Promise<void> => {
    if (event.type !== "payout.started" && event.type !== "payout.succeeded" && event.type !== "payout.failed") {
      await this.deps.bus.publish(event);
      return;
    }
    const applied = await this.apply(event);
    if (applied) await this.deps.bus.publish(event);
  };

  private async onVerifyDone(event: Extract<InternalEvent, { type: "verify.done" }>) {
    const bounty = await this.deps.repo.findById(event.bountyId);
    // After the merge the verdict no longer matters: the bounty is verified or waiting for /pay.
    if (!bounty || bounty.status !== "submitted") return;
    await this.apply(event);
  }

  private async payIfVerified(bountyId: string) {
    const bounty = await this.deps.repo.findById(bountyId);
    if (!bounty || bounty.status !== "verified") return;
    if (!this.deps.startPayout) {
      this.log.warn(`[settlement] bounty ${bountyId} is verified but payouts aren't configured (Bitnob keys)`);
      return;
    }
    if (!(await this.deps.repo.activeClaimant(bountyId))) {
      this.log.error(`[settlement] bounty ${bountyId} is verified but has no claimant to pay`);
      return;
    }
    // A newer timer replaces an older one (redelivered merge, /hold then /pay): only it may pay.
    const token = Symbol(bountyId);
    this.pending.set(bountyId, token);
    this.schedule(() => void this.payAfterWindow(bountyId, token), this.deps.objectionMs ?? 0);
  }

  /** The end of the objection window: pays only if this is still the bounty's timer and it is still `verified`. */
  private async payAfterWindow(bountyId: string, token: symbol) {
    if (this.pending.get(bountyId) !== token) return;
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
      const claimant = await this.deps.repo.activeClaimant(bountyId);
      if (!claimant) {
        this.log.error(`[settlement] bounty ${bountyId} is verified but has no claimant to pay`);
        return;
      }
      await start({ bountyId, userId: claimant.userId, amountXof: bounty.amountXof });
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
