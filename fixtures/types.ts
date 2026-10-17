// Fixture types for BitBounty.
// TEMPORARY: mirrors docs/plan.md §3 and TASKS.md "Interfaces".
// Replace with `@bitbounty/core` once F2 merges (keep the page DTOs at the bottom,
// or move them to packages/core if F2 does not define them).
//
// Money is always an integer in the smallest unit: FCFA (XOF has no minor unit),
// sats, USDT cents, NGN kobo. Never floats.
// Written without enums / runtime TS features so Node can strip the types and
// fixtures/check.mjs can import the const arrays directly.

export const BOUNTY_STATUSES = [
  'unfunded',
  'funded',
  'claimed',
  'submitted',
  'verified',
  'paying',
  'paid',
  'payout_failed',
  'on_hold',
  'refunded',
  'cancelled',
] as const;
export type BountyStatus = (typeof BOUNTY_STATUSES)[number];

/** Internal events (TASKS.md "Interfaces"). The last four are proposed for F2: needed for side states. */
export const EVENT_TYPES = [
  'bounty.created',
  'funding.paid',
  'claim.created',
  'claim.expired',
  'pr.linked',
  'pr.merged',
  'verify.done',
  'payout.succeeded',
  'payout.failed',
  // proposed
  'claim.released',
  'bounty.held',
  'bounty.cancelled',
  'bounty.refunded',
  'payout.started',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const RAILS = ['lightning', 'usdt', 'ngn'] as const;
export type Rail = (typeof RAILS)[number];

export const SOURCE_CURRENCIES = ['SAT', 'USDT_CENT', 'NGN_KOBO'] as const;
export type SourceCurrency = (typeof SOURCE_CURRENCIES)[number];

export const FUNDING_STATUSES = ['pending', 'paid', 'expired', 'refunded'] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export const CLAIM_STATUSES = ['active', 'released', 'expired', 'done'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const VERDICTS = ['pass', 'fail', 'unsure'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CI_STATUSES = ['pending', 'success', 'failure'] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

export const PAYOUT_STATUSES = ['pending', 'processing', 'succeeded', 'failed'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PROVIDERS = ['wave', 'orange', 'free'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ACCOUNT_STATUSES = ['pending', 'sms_ok', 'verified'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type FunderKind = 'human' | 'agent';
export type ISODate = string; // e.g. "2026-10-17T16:42:00Z"

// ---------- core entities (docs/plan.md tables) ----------

export interface User {
  id: string;
  github_id: number;
  login: string;
  name: string;
  avatar_url: string;
  city: string;
  created_at: ISODate;
}

export interface PayoutAccount {
  user_id: string;
  country: 'SN';
  provider: Provider;
  /** Never the full number in API output: "+221 77 ••• •• 42". */
  phone_masked: string;
  account_name: string;
  status: AccountStatus;
  verified_at: ISODate | null;
  locked_until: ISODate | null;
}

export interface Bounty {
  id: string;
  repo: string; // owner/name
  issue_number: number;
  issue_title: string;
  issue_url: string;
  amount_xof: number; // what the developer receives
  status: BountyStatus;
  criteria: string[];
  criteria_confirmed: boolean;
  funder_kind: FunderKind;
  funder_login: string;
  labels: string[];
  status_comment_id: number | null;
  created_at: ISODate;
  updated_at: ISODate;
  expires_at: ISODate | null;
}

export interface Funding {
  id: string;
  bounty_id: string;
  rail: Rail;
  source_amount: number; // integer, unit given by source_currency
  source_currency: SourceCurrency;
  fee_xof: number; // 5%
  buffer_xof: number; // 3% FX buffer
  bitnob_ref: string;
  payment_hash: string | null; // lightning only
  status: FundingStatus;
  created_at: ISODate;
  paid_at: ISODate | null;
}

export interface Claim {
  id: string;
  bounty_id: string;
  user_login: string;
  status: ClaimStatus;
  extended: boolean;
  created_at: ISODate;
  expires_at: ISODate;
}

export interface CriterionResult {
  text: string;
  met: boolean;
  evidence: string;
}

/** Verifier output, docs/plan.md §5. */
export interface VerifierReport {
  criteria: CriterionResult[];
  verdict: Verdict;
  summary: string;
  risk_flags: string[];
}

export interface Submission {
  id: string;
  bounty_id: string;
  pr_number: number;
  pr_url: string;
  author_login: string;
  head_sha: string;
  ci: CiStatus;
  verdict: Verdict | null; // null while the check runs
  report: VerifierReport | null;
  spam_score: number; // 0..100 integer
  created_at: ISODate;
  merged_at: ISODate | null;
}

export interface Payout {
  id: string;
  bounty_id: string;
  user_login: string;
  amount_xof: number;
  provider: Provider;
  phone_masked: string;
  quote_id: string;
  bitnob_payout_id: string | null;
  reference: string; // "pay-<bountyId>"
  status: PayoutStatus;
  attempts: number;
  last_error: string | null;
  created_at: ISODate;
  paid_at: ISODate | null;
}

export interface TimelineEvent {
  at: ISODate;
  type: EventType;
  actor: string; // github login, "bitbounty" or "bitnob"
  text: string;
}

// ---------- page DTOs (what each /api/* route returns) ----------

/** GET /api/bounties/:id — /b/[id] */
export interface BountyDetail extends Bounty {
  fundings: Funding[];
  claims: Claim[];
  submission: Submission | null;
  payout: Payout | null;
  timeline: TimelineEvent[];
}

/** GET /api/bounties — list rows */
export type BountySummary = Bounty & { claimed_by: string | null; pr_number: number | null };

export interface ExternalBounty {
  title: string;
  repo: string;
  url: string;
  amount_usd_cents: number;
  source: string;
}

/** GET /api/board — / (public board) */
export interface Board {
  stats: { paid_count: number; paid_total_xof: number; median_minutes_merge_to_pay: number; developers_paid: number };
  bounties: BountySummary[];
  external: ExternalBounty[];
}

export interface BacklogSuggestion {
  id: string;
  repo: string;
  issue_number: number;
  issue_title: string;
  criteria: string[];
  price_xof: number;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  selected: boolean;
}

/** GET /api/dashboard — /dashboard */
export interface Dashboard {
  maintainer: string;
  repos: { full_name: string; open_issues: number; active_bounties: number; paid_pct: number }[];
  stats: {
    budget_xof: number;
    held_xof: number;
    spent_xof: number;
    active_count: number;
    paid_count: number;
    median_minutes_merge_to_pay: number;
  };
  bounty_ids: string[];
  needs_action: { bounty_id: string; action: 'pay_or_reject' | 'update_account' | 'confirm_criteria' | 'fund'; text: string }[];
  backlog: BacklogSuggestion[];
}

export interface FeeBreakdown {
  amount_xof: number;
  fee_xof: number;
  buffer_xof: number;
  total_xof: number;
}

/** POST /api/bounties/:id/funding {rail} — /pay/[id] */
export type FundingSession =
  | (FeeBreakdown & { rail: 'lightning'; invoice: string; payment_hash: string; amount_sats: number; expires_at: ISODate })
  | (FeeBreakdown & { rail: 'usdt'; address: string; network: 'TRON' | 'ETHEREUM' | 'BSC'; amount_usdt_cents: number; expires_at: ISODate })
  | (FeeBreakdown & {
      rail: 'ngn';
      virtual_account: { bank_name: string; account_number: string; account_name: string };
      amount_kobo: number;
      expires_at: ISODate;
    });

/** GET /api/me — /me */
export interface Me {
  user: User;
  payout_account: PayoutAccount | null;
  earnings: { total_xof: number; paid_count: number };
  active_claims: { bounty_id: string; issue_title: string; repo: string; expires_at: ISODate }[];
  payouts: { bounty_id: string; amount_xof: number; status: PayoutStatus; paid_at: ISODate | null; receipt_id: string | null }[];
}

/** GET /api/users/:login — /u/[login] */
export interface Profile {
  user: User;
  stats: { paid_count: number; total_xof: number; repos: number; accepted_pct: number; median_minutes_merge_to_pay: number };
  languages: string[];
  work: { bounty_id: string; repo: string; issue_title: string; pr_number: number; amount_xof: number; paid_at: ISODate; receipt_id: string }[];
}

/** GET /api/receipts/:id — /r/[id] */
export interface Receipt {
  id: string;
  bounty_id: string;
  repo: string;
  issue_number: number;
  issue_title: string;
  pr_number: number;
  pr_url: string;
  recipient_login: string;
  amount_xof: number;
  provider: Provider;
  phone_masked: string;
  funded_with: { rail: Rail; source_amount: number; source_currency: SourceCurrency; funder_login: string };
  merged_at: ISODate;
  paid_at: ISODate;
  minutes_merge_to_pay: number;
  bitnob_reference: string;
  signature: string;
}

/** GET /api/live (SSE) — /live */
export interface LiveEvent {
  delay_ms: number;
  bounty_id: string;
  from: BountyStatus;
  to: BountyStatus;
  text: string;
}
export interface Live {
  columns: BountyStatus[];
  cards: { bounty_id: string; status: BountyStatus; repo: string; issue_title: string; amount_xof: number; who: string | null; city: string | null }[];
  events: LiveEvent[];
}
