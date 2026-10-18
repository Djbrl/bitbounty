import type { Currency, Xof } from "./money.js";

/**
 * The contract every module codes against. It can only grow: add fields and
 * statuses, never rename or remove them. Dates are ISO 8601 strings.
 */

export const BOUNTY_STATUSES = [
  "unfunded",
  "funded",
  "claimed",
  "submitted",
  "verified",
  "paying",
  "paid",
  "on_hold",
  "payout_failed",
  "refunded",
  "cancelled",
] as const;
export type BountyStatus = (typeof BOUNTY_STATUSES)[number];

/** Statuses a bounty never leaves. */
export const TERMINAL_STATUSES: readonly BountyStatus[] = ["paid", "refunded", "cancelled"];

export type FunderKind = "human" | "agent";
export type FundingRail = "lightning" | "usdt" | "ngn";
export type Verdict = "pass" | "fail" | "unsure";
export type PayoutProvider = "wave" | "orange" | "free";
/** L1: the role is a mode, not an account type. It only picks the default view (/app redirects there). */
export const USER_MODES = ["maintain", "hunt"] as const;
export type UserMode = (typeof USER_MODES)[number];

export interface Criterion {
  text: string;
}

export interface Bounty {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  /** What the developer receives, in whole FCFA. */
  amountXof: Xof;
  status: BountyStatus;
  criteria: Criterion[];
  funderKind: FunderKind;
  funderId: string;
  /** Latest verifier verdict on the submitted PR, null until one exists. A signal only. */
  verdict: Verdict | null;
  /** The GitHub comment the bot keeps editing. */
  statusCommentId: number | null;
  /**
   * True once a PR was submitted (or a merge confirmed by `/pay`). Stays true after `/reject`:
   * the funder can't cancel any more (product.md, "Funder cancels after a PR"). Missing = false.
   */
  hadSubmission?: boolean;
  /** The PR and commit `pr.linked` recorded. `verify.done` / `pr.merged` must match them. Missing = not checked. */
  prNumber?: number | null;
  headSha?: string | null;
  /** CR15: Stored recipient when /pay @user overrode the claimant */
  payeeLogin?: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface Funding {
  id: string;
  bountyId: string;
  rail: FundingRail;
  /** Integer in the rail's smallest unit: sats, USDT base units, or kobo. */
  sourceAmount: number;
  sourceCurrency: Exclude<Currency, "XOF">;
  bitnobRef: string;
  paymentHash: string | null;
  status: "pending" | "paid" | "expired";
  paidAt: string | null;
}

export interface Claim {
  id: string;
  bountyId: string;
  userId: string;
  status: "active" | "released" | "expired" | "done";
  expiresAt: string;
}

export interface CriterionResult {
  text: string;
  met: boolean;
  evidence: string;
}

export interface VerificationReport {
  criteria: CriterionResult[];
  verdict: Verdict;
  summary: string;
  riskFlags: string[];
}

export interface Submission {
  id: string;
  bountyId: string;
  prNumber: number;
  authorLogin: string;
  headSha: string;
  verdict: Verdict | null;
  report: VerificationReport | null;
  spamScore: number | null;
  mergedAt: string | null;
}

export interface Payout {
  id: string;
  bountyId: string;
  userId: string;
  amountXof: Xof;
  quoteId: string | null;
  bitnobPayoutId: string | null;
  /** Idempotency key sent to Bitnob: `pay-<bountyId>`. */
  reference: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  attempts: number;
  lastError: string | null;
  paidAt: string | null;
  /**
   * B6 (Lightning payouts), all optional so older rows and callers stay valid.
   * The current attempt's Lightning details: what we asked the developer's Lightning Address
   * for, the invoice it returned and the rate used. Reset at each new attempt.
   */
  rail?: "lightning" | "mobile_money";
  /** The Lightning Address paid by the current attempt, e.g. `awa@blink.sv`. */
  lightningAddress?: string | null;
  /** Sats sent: `floor(amountXof / xofPerBtc * 1e8)`. */
  amountSats?: number | null;
  /** FCFA per 1 BTC used for `amountSats` (kept for the receipt). */
  xofPerBtc?: number | null;
  /** BOLT11 invoice obtained through LNURL-pay for exactly `amountSats`. */
  paymentRequest?: string | null;
  paymentHash?: string | null;
  invoiceExpiresAt?: string | null;
  /** Set just before the pay request leaves; from then on only Bitnob can say it failed. */
  sentAt?: string | null;
  /** Proof of payment, when Bitnob returns it. */
  preimage?: string | null;
}

export interface User {
  id: string;
  githubId: number;
  login: string;
  avatarUrl: string | null;
  createdAt: string;
  /** L1: default view after sign-in; null until onboarding (U1) sets it. */
  defaultMode?: UserMode | null;
  /** L1: when onboarding was finished; null means /welcome still applies. */
  onboardedAt?: string | null;
}

export interface PayoutAccount {
  userId: string;
  /**
   * B6: where payouts go, a Lightning Address (`user@domain`, LUD-16). The mobile money
   * fields below are the legacy rail (B3) and are no longer needed to get paid.
   */
  lightningAddress?: string | null;
  country: string;
  provider: PayoutProvider;
  phoneE164: string;
  accountName: string;
  status: "pending" | "sms_ok" | "verified";
  testAmountXof: Xof | null;
  verifiedAt: string | null;
  lockedUntil: string | null;
}
