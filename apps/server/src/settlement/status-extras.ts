import type { Bounty } from "@bitbounty/core";
import type { BountyRepo } from "../bounties/repo.js";
import type { PayoutFailureReason, StatusCommentExtras } from "../github/status-comment/index.js";
import type { PayoutStore } from "../payouts/store.js";

/**
 * I3: what the status comment needs besides the bounty, so every re-render (settlement, G5)
 * says who holds the claim, which PR is linked and, for payouts, the attempt and why the last
 * one failed ("We retry automatically" then means something) or the receipt once paid.
 * The issue is public: the failure goes out as a short reason, never the raw error (hosts, env
 * var names, account details). The raw text stays in the server log and the payout row.
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
          reason: bounty.status === "payout_failed" && payout.lastError ? publicPayoutReason(payout.lastError) : null,
          receiptId: payout.status === "succeeded" ? payout.id : null,
          // B2 marks the row `failed` only when it won't retry by itself.
          final: payout.status === "failed",
        }
      : null,
  };
}

/** Maps the payout service's raw `lastError` (B2, B6 Lightning) to a reason safe to show on a public issue. */
export function publicPayoutReason(raw: string): PayoutFailureReason {
  const e = raw.toLowerCase();
  if (e.includes("no payout account") || e.includes("has no lightning address")) return "no_account";
  // B6: LNURL-pay against the developer's own wallet, before anything reaches Bitnob.
  if (e.startsWith("lnurl unreachable")) return "wallet_unreachable";
  if (e.startsWith("lnurl refused")) return "wallet_refused";
  if (/feature_not_enabled|less than 1 sat/.test(e)) return "setup";
  if (e.includes("expired")) return "expired";
  if (/network error|timed out|fetch failed|econn|enotfound|etimedout|eai_again|failed: 5\d\d|has no payout/.test(e)) return "unreachable";
  if (/bank_code|bank_codes|payout_accounts|settles .* expected|missing bitnob|config|failed: 40[13] /.test(e)) return "setup";
  if (/failed: 4\d\d|bitnob report/.test(e)) return "rejected";
  return "other";
}
