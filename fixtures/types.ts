// Fixture types for BitBounty.
// TEMPORARY MIRROR of the F2 contract (packages/core, PR #44): statuses, events, TRANSITIONS
// and entity shapes are copied verbatim from packages/core/src/{types,events,machine}.ts.
// Replace with import from @bitbounty/core once #44 merges (keep the view/page DTOs below,
// or move them to packages/core).
//
// Money is always an integer in the smallest unit: FCFA (XOF has no minor unit),
// sats, USDT base units (1 USDT = 1_000_000), NGN kobo. Never floats.
// Written without enums / runtime TS features so Node can strip the types and
// fixtures/check.mjs can import the const arrays directly.

// ===================== mirror of @bitbounty/core (#44) =====================
// Replace with import from @bitbounty/core once #44 merges.

export type Xof = number;
export type Currency = 'XOF' | 'BTC' | 'USDT' | 'NGN';

export const BOUNTY_STATUSES = [
  'unfunded',
  'funded',
  'claimed',
  'submitted',
  'verified',
  'paying',
  'paid',
  'on_hold',
  'payout_failed',
  'refunded',
  'cancelled',
] as const;
export type BountyStatus = (typeof BOUNTY_STATUSES)[number];

export const TERMINAL_STATUSES: readonly BountyStatus[] = ['paid', 'refunded', 'cancelled'];

export const EVENT_TYPES = [
  'bounty.created',
  'funding.paid',
  'claim.created',
  'claim.released',
  'claim.expired',
  'pr.linked',
  'verify.done',
  'pr.merged',
  'maintainer.pay',
  'maintainer.hold',
  'maintainer.reject',
  'bounty.cancelled',
  'payout.started',
  'payout.succeeded',
  'payout.failed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Mirror of core's machine.ts TRANSITIONS: status → event → possible next statuses. */
export const TRANSITIONS: Readonly<Record<BountyStatus, Partial<Record<EventType, readonly BountyStatus[]>>>> = {
  unfunded: {
    'funding.paid': ['funded'],
    'bounty.cancelled': ['cancelled'],
  },
  funded: {
    'claim.created': ['claimed'],
    'bounty.cancelled': ['refunded'],
  },
  claimed: {
    'claim.released': ['funded'],
    'claim.expired': ['funded'],
    'pr.linked': ['submitted'],
    'maintainer.pay': ['verified'],
    'bounty.cancelled': ['refunded'],
  },
  submitted: {
    'verify.done': ['submitted'],
    // verified only if verdict = pass and CI green, otherwise on_hold.
    'pr.merged': ['verified', 'on_hold'],
    'maintainer.pay': ['verified'],
    'maintainer.hold': ['on_hold'],
    'maintainer.reject': ['funded'],
  },
  verified: {
    'maintainer.hold': ['on_hold'],
    'payout.started': ['paying'],
  },
  paying: {
    'payout.succeeded': ['paid'],
    'payout.failed': ['payout_failed'],
  },
  payout_failed: {
    'payout.started': ['paying'],
  },
  on_hold: {
    'maintainer.pay': ['verified'],
    'maintainer.reject': ['funded'],
  },
  paid: {},
  refunded: {},
  cancelled: {},
};

export const RAILS = ['lightning', 'usdt', 'ngn'] as const;
export type FundingRail = (typeof RAILS)[number];
export const SOURCE_CURRENCIES = ['BTC', 'USDT', 'NGN'] as const; // Exclude<Currency, 'XOF'>
export const FUNDING_STATUSES = ['pending', 'paid', 'expired'] as const;
export const CLAIM_STATUSES = ['active', 'released', 'expired', 'done'] as const;
export const VERDICTS = ['pass', 'fail', 'unsure'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const PAYOUT_STATUSES = ['pending', 'processing', 'succeeded', 'failed'] as const;
export const PROVIDERS = ['wave', 'orange', 'free'] as const;
export type PayoutProvider = (typeof PROVIDERS)[number];
export const ACCOUNT_STATUSES = ['pending', 'sms_ok', 'verified'] as const;
export type FunderKind = 'human' | 'agent';

export interface Criterion {
  text: string;
}

export interface Bounty {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  amountXof: Xof;
  status: BountyStatus;
  criteria: Criterion[];
  funderKind: FunderKind;
  funderId: string;
  verdict: Verdict | null;
  statusCommentId: number | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface Funding {
  id: string;
  bountyId: string;
  rail: FundingRail;
  sourceAmount: number;
  sourceCurrency: Exclude<Currency, 'XOF'>;
  bitnobRef: string;
  paymentHash: string | null;
  status: 'pending' | 'paid' | 'expired';
  paidAt: string | null;
}

export interface Claim {
  id: string;
  bountyId: string;
  userId: string;
  status: 'active' | 'released' | 'expired' | 'done';
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
  reference: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
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
}

export interface PayoutAccount {
  userId: string;
  country: string;
  provider: PayoutProvider;
  phoneE164: string;
  accountName: string;
  status: 'pending' | 'sms_ok' | 'verified';
  testAmountXof: Xof | null;
  verifiedAt: string | null;
  lockedUntil: string | null;
}

// ===================== view shapes (API output, not in core) =====================
// Core entities plus the display fields pages need. Every core field is kept as-is.

export type ISODate = string; // e.g. "2026-10-17T16:42:00Z"
export type PayoutStatus = Payout['status'];

export type UserView = User & { name: string; city: string };

/** API never returns the full number nor the test amount: phoneE164/testAmountXof → phoneMasked. */
export type PayoutAccountView = Omit<PayoutAccount, 'phoneE164' | 'testAmountXof'> & {
  /** "+221 77 ••• •• 42" */
  phoneMasked: string;
};

export type BountyView = Bounty & {
  issueUrl: string;
  /** false while the criteria are Claude's draft (`/criteria ok` pending). */
  criteriaConfirmed: boolean;
  funderLogin: string;
  labels: string[];
  updatedAt: ISODate;
};

export type FundingView = Funding & { feeXof: Xof; bufferXof: Xof; createdAt: ISODate };
export type ClaimView = Claim & { userLogin: string; extended: boolean; createdAt: ISODate };
export type SubmissionView = Submission & { prUrl: string; ci: 'pending' | 'success' | 'failure'; createdAt: ISODate };
export type PayoutView = Payout & { userLogin: string; provider: PayoutProvider; phoneMasked: string; createdAt: ISODate };

/** One applied event, with the status it led to (`to` must be allowed by TRANSITIONS). */
export interface TimelineEvent {
  occurredAt: ISODate;
  type: EventType;
  to: BountyStatus;
  actor: string; // github login, "bitbounty" or "bitnob"
  text: string;
}

// ---------- page DTOs (what each /api/* route returns) ----------

/** GET /api/bounties/:id — /b/[id] */
export interface BountyDetail extends BountyView {
  fundings: FundingView[];
  claims: ClaimView[];
  submission: SubmissionView | null;
  payout: PayoutView | null;
  timeline: TimelineEvent[];
}

/** GET /api/bounties — list rows */
export type BountySummary = BountyView & { claimedBy: string | null; prNumber: number | null };

export interface ExternalBounty {
  title: string;
  repoFullName: string;
  url: string;
  amountUsdCents: number;
  source: string;
}

/** GET /api/board — / (public board) */
export interface Board {
  stats: { paidCount: number; paidTotalXof: Xof; medianMinutesMergeToPay: number; developersPaid: number };
  bounties: BountySummary[];
  external: ExternalBounty[];
}

export interface BacklogSuggestion {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  criteria: Criterion[];
  priceXof: Xof;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  selected: boolean;
}

/** GET /api/dashboard — /dashboard */
export interface Dashboard {
  maintainer: string;
  repos: { fullName: string; openIssues: number; activeBounties: number; paidPct: number }[];
  stats: {
    budgetXof: Xof;
    heldXof: Xof;
    spentXof: Xof;
    activeCount: number;
    paidCount: number;
    medianMinutesMergeToPay: number;
  };
  bountyIds: string[];
  needsAction: { bountyId: string; action: 'pay_or_reject' | 'update_account' | 'confirm_criteria' | 'fund'; text: string }[];
  backlog: BacklogSuggestion[];
}

export interface FeeBreakdown {
  amountXof: Xof;
  feeXof: Xof;
  bufferXof: Xof;
  totalXof: Xof;
}

/** POST /api/bounties/:id/funding {rail} — /pay/[id] */
export type FundingSession =
  | (FeeBreakdown & { rail: 'lightning'; invoice: string; paymentHash: string; amountSats: number; expiresAt: ISODate })
  | (FeeBreakdown & { rail: 'usdt'; address: string; network: 'TRON' | 'ETHEREUM' | 'BSC'; amountUsdtUnits: number; expiresAt: ISODate })
  | (FeeBreakdown & {
      rail: 'ngn';
      virtualAccount: { bankName: string; accountNumber: string; accountName: string };
      amountKobo: number;
      expiresAt: ISODate;
    });

/** GET /api/me — /me */
export interface Me {
  user: UserView;
  payoutAccount: PayoutAccountView | null;
  earnings: { totalXof: Xof; paidCount: number };
  activeClaims: { bountyId: string; issueTitle: string; repoFullName: string; expiresAt: ISODate }[];
  payouts: { bountyId: string; amountXof: Xof; status: PayoutStatus; paidAt: ISODate | null; receiptId: string | null }[];
}

/** GET /api/users/:login — /u/[login] */
export interface Profile {
  user: UserView;
  stats: { paidCount: number; totalXof: Xof; repos: number; acceptedPct: number; medianMinutesMergeToPay: number };
  languages: string[];
  work: { bountyId: string; repoFullName: string; issueTitle: string; prNumber: number; amountXof: Xof; paidAt: ISODate; receiptId: string }[];
}

/** GET /api/receipts/:id — /r/[id] */
export interface Receipt {
  id: string;
  bountyId: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prUrl: string;
  recipientLogin: string;
  amountXof: Xof;
  provider: PayoutProvider;
  phoneMasked: string;
  fundedWith: { rail: FundingRail; sourceAmount: number; sourceCurrency: Exclude<Currency, 'XOF'>; funderLogin: string };
  mergedAt: ISODate;
  paidAt: ISODate;
  minutesMergeToPay: number;
  bitnobReference: string;
  signature: string;
}

/** GET /api/live (SSE) — /live */
export interface LiveEvent {
  delayMs: number;
  bountyId: string;
  event: EventType;
  from: BountyStatus;
  to: BountyStatus;
  text: string;
}
export interface Live {
  columns: BountyStatus[];
  cards: { bountyId: string; status: BountyStatus; repoFullName: string; issueTitle: string; amountXof: Xof; who: string | null; city: string | null }[];
  events: LiveEvent[];
}
