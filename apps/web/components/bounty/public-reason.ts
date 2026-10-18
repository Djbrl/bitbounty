// U5: public pages never show a raw payout error (hosts, env names, account details).
// The real server already sends I3's short reason in `payout.lastError` (apps/server/src/api/views.ts);
// fixtures mode (and any older server) can still carry the raw text, so the page maps it here too.
// Same rules and copy as the server's `publicPayoutReason` + `COPY.en.payoutReasons`
// (apps/server/src/settlement/status-extras.ts); public-reason.test.ts checks they stay in sync.

export type PayoutFailureReason =
  | "unreachable"
  | "expired"
  | "rejected"
  | "no_account"
  | "setup"
  | "other"
  | "wallet_unreachable"
  | "wallet_refused";

export const PAYOUT_REASONS: Record<PayoutFailureReason, string> = {
  unreachable: "Bitnob didn't answer",
  expired: "Bitnob reported the payment expired",
  rejected: "Bitnob refused the payment",
  no_account: "the developer hasn't set a payout account yet",
  setup: "a payout setup problem on BitBounty's side",
  other: "the payment didn't complete",
  wallet_unreachable: "the developer's Lightning wallet didn't answer",
  wallet_refused: "the developer's Lightning Address can't receive this payment",
};

/** Raw payout error → reason code (mirror of the server's `publicPayoutReason`). */
export function payoutReasonCode(raw: string): PayoutFailureReason {
  const e = raw.toLowerCase();
  if (e.startsWith("setup:")) return "setup";
  if (e.includes("no payout account") || e.includes("has no lightning address")) return "no_account";
  if (e.startsWith("lnurl unreachable")) return "wallet_unreachable";
  if (e.startsWith("lnurl refused")) return "wallet_refused";
  if (/feature_not_enabled|less than 1 sat/.test(e)) return "setup";
  if (e.includes("expired")) return "expired";
  if (/network error|timed out|fetch failed|econn|enotfound|etimedout|eai_again|failed: 5\d\d|has no payout/.test(e)) return "unreachable";
  if (/bank_code|bank_codes|payout_accounts|settles .* expected|missing bitnob|config|failed: 40[13] /.test(e)) return "setup";
  if (/failed: 4\d\d|bitnob report/.test(e)) return "rejected";
  return "other";
}

const KNOWN = new Set(Object.values(PAYOUT_REASONS));

/** What a public page shows for `payout.lastError`: the server's reason as is, anything else mapped. */
export function publicPayoutText(lastError: string): string {
  return KNOWN.has(lastError) ? lastError : PAYOUT_REASONS[payoutReasonCode(lastError)];
}
