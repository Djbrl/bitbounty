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

/**
 * L1: the two views of the app. One GitHub account can do both; the mode only picks the
 * default view (`/app/hunt` or `/app/maintain`). Permissions come from GitHub, never from the mode.
 */
export const WORKSPACE_MODES = ["hunt", "maintain"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

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
}

export interface User {
  id: string;
  githubId: number;
  login: string;
  avatarUrl: string | null;
  createdAt: string;
  /** L1: view `/app` opens on; null until onboarding (`/welcome`) is done. */
  defaultMode?: WorkspaceMode | null;
  /** L1: when the user finished onboarding; null = not onboarded yet. */
  onboardedAt?: string | null;
}

/** L1: what `/api/me/preferences` reads and writes (the onboarding fields of `User`). */
export interface UserPreferences {
  defaultMode: WorkspaceMode | null;
  onboardedAt: string | null;
}

export interface PayoutAccount {
  userId: string;
  country: string;
  provider: PayoutProvider;
  phoneE164: string;
  accountName: string;
  status: "pending" | "sms_ok" | "verified";
  testAmountXof: Xof | null;
  verifiedAt: string | null;
  lockedUntil: string | null;
}
