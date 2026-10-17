import { transition, type InternalEvent } from "@bitbounty/core";
import type { BountyRepo } from "../bounties/repo.js";
import type { EventBus } from "../github/pr/ports.js";

/**
 * The production `emit` for LightningFunding: applies `funding.paid` to the stored bounty
 * (`unfunded` → `funded`) and publishes it on the bus.
 * Idempotent, because the funding outbox delivers at least once: when the bounty already left
 * `unfunded` the event is treated as applied. Throws only when a retry can help (the bounty
 * changed under us, or isn't found), so the outbox delivers it again on the next poll.
 */
export function applyFundingPaid(
  repo: Pick<BountyRepo, "findById" | "update">,
  bus: Pick<EventBus, "publish">,
  log: Pick<Console, "info" | "error"> = console,
) {
  return async (event: InternalEvent): Promise<void> => {
    if (event.type !== "funding.paid") return;
    const bounty = await repo.findById(event.bountyId);
    if (!bounty) throw new Error(`bounty ${event.bountyId} not found`);
    if (bounty.status !== "unfunded") {
      log.info(`[funding] ${event.fundingId}: bounty ${bounty.id} already ${bounty.status}, funding.paid already applied`);
      return;
    }
    const r = transition(bounty, event);
    if (!r.ok) {
      // Permanent (e.g. UNDERFUNDED): retrying won't help, a human has to look.
      log.error(`[funding] ${event.fundingId}: funding.paid refused for bounty ${bounty.id}: ${r.message}`);
      return;
    }
    const saved = await repo.update(r.bounty, r.from);
    if (!saved) throw new Error(`bounty ${bounty.id} changed while applying funding.paid, will retry`);
    await bus.publish(event);
  };
}
