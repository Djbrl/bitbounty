import type { Bounty } from "@bitbounty/core";
import type { BountyRepo } from "../bounties/repo.js";
import type { StatusCommentExtras } from "../github/status-comment/index.js";
import type { PayoutStore } from "../payouts/store.js";

/**
 * I3: what the status comment needs besides the bounty, so every re-render (settlement, G5)
 * says who holds the claim, which PR is linked and, for payouts, the attempt and why the last
 * one failed ("We retry automatically" then means something) or the receipt once paid.
 */
export async function statusExtras(
  bounty: Bounty,
  deps: { repo: Pick<BountyRepo, "activeClaim" | "currentSubmission">; payouts?: Pick<PayoutStore, "getByBounty"> | null },
): Promise<Omit<StatusCommentExtras, "baseUrl">> {
  const [claim, sub, payout] = await Promise.all([
    deps.repo.activeClaim(bounty.id),
    deps.repo.currentSubmission(bounty.id),
    deps.payouts?.getByBounty(bounty.id) ?? Promise.resolve(undefined),
  ]);
  return {
    claim: claim ? { login: claim.login, expiresAt: claim.expiresAt } : null,
    pr: sub ? { number: sub.prNumber, authorLogin: sub.authorLogin } : null,
    payout: payout
      ? {
          reference: payout.bitnobPayoutId ?? null,
          attempts: payout.attempts,
          lastError: bounty.status === "payout_failed" ? payout.lastError : null,
          receiptId: payout.status === "succeeded" ? payout.id : null,
          // B2 marks the row `failed` only when it won't retry by itself.
          final: payout.status === "failed",
        }
      : null,
  };
}
