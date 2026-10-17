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

  constructor(private readonly deps: SettlementDeps) {
    this.log = deps.log ?? console;
    this.schedule = deps.schedule ?? ((fn, ms) => void (ms > 0 ? setTimeout(fn, ms) : queueMicrotask(fn)));
  }

  register(): this {
    const { bus } = this.deps;
    bus.subscribe("verify.done", (e) => this.onVerifyDone(e));
    bus.subscribe("pr.merged", (e) => this.payIfVerified(e.bountyId));
    bus.subscribe("maintainer.pay", (e) => this.payIfVerified(e.bountyId));
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
    const claimant = await this.deps.repo.activeClaimant(bountyId);
    if (!claimant) {
      this.log.error(`[settlement] bounty ${bountyId} is verified but has no claimant to pay`);
      return;
    }
    const start = this.deps.startPayout;
    this.schedule(() => {
      void start({ bountyId, userId: claimant.userId, amountXof: bounty.amountXof }).catch((err) =>
        this.log.error(`[settlement] payout for ${bountyId} failed to start: ${err instanceof Error ? err.message : err}`),
      );
    }, this.deps.objectionMs ?? 0);
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
