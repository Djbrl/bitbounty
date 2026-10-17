import type { Xof } from "./money.js";
import type { FundingRail, Verdict } from "./types.js";

/**
 * Internal events: the only way modules talk to each other (pg-boss queue).
 * Every event carries the bounty it is about and when it happened.
 * New event types may be added; existing ones are never renamed.
 */
export const EVENT_TYPES = [
  "bounty.created",
  "funding.paid",
  "claim.created",
  "claim.released",
  "claim.expired",
  "pr.linked",
  "verify.done",
  "pr.merged",
  "maintainer.pay",
  "maintainer.hold",
  "maintainer.reject",
  "bounty.cancelled",
  "payout.started",
  "payout.succeeded",
  "payout.failed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

interface Base<T extends EventType> {
  type: T;
  bountyId: string;
  occurredAt: string;
}

/** A new bounty exists (status `unfunded`). Emitted by `createBounty`, not a transition. */
export interface BountyCreated extends Base<"bounty.created"> {
  amountXof: Xof;
}
/** Money for the full bounty amount has arrived on Bitnob. */
export interface FundingPaid extends Base<"funding.paid"> {
  fundingId: string;
  rail: FundingRail;
  /** FCFA value reserved for the bounty. Must cover `bounty.amountXof`. */
  amountXof: Xof;
}
export interface ClaimCreated extends Base<"claim.created"> {
  claimId: string;
  userId: string;
}
/** `/unclaim` by the developer. */
export interface ClaimReleased extends Base<"claim.released"> {
  claimId: string;
}
/** The claim timer ran out without a PR. */
export interface ClaimExpired extends Base<"claim.expired"> {
  claimId: string;
}
/** A PR saying "Fixes #n" was opened by the claimant. */
export interface PrLinked extends Base<"pr.linked"> {
  prNumber: number;
  authorLogin: string;
  headSha: string;
}
/** The verifier finished on a commit. A signal: it never moves the bounty by itself. */
export interface VerifyDone extends Base<"verify.done"> {
  prNumber: number;
  headSha: string;
  verdict: Verdict;
}
export interface PrMerged extends Base<"pr.merged"> {
  prNumber: number;
  /** All required CI checks green on the merged commit. */
  ciGreen: boolean;
}
/** `/pay [@user]`: the maintainer approves the payout by hand. */
export interface MaintainerPay extends Base<"maintainer.pay"> {
  actorLogin: string;
  toLogin?: string;
}
/** `/hold`: freeze before the payout goes out. */
export interface MaintainerHold extends Base<"maintainer.hold"> {
  actorLogin: string;
  reason?: string;
}
/** `/reject <reason>`: the submission doesn't count, the bounty is open again. */
export interface MaintainerReject extends Base<"maintainer.reject"> {
  actorLogin: string;
  reason: string;
}
/** `/cancel` by the funder, or an automatic refund (issue closed, nobody claimed). */
export interface BountyCancelled extends Base<"bounty.cancelled"> {
  actorId: string;
  reason: string;
}
/** The payout pipeline starts an attempt (first try or retry). */
export interface PayoutStarted extends Base<"payout.started"> {
  payoutId: string;
  attempt: number;
}
export interface PayoutSucceeded extends Base<"payout.succeeded"> {
  payoutId: string;
  bitnobPayoutId: string;
}
export interface PayoutFailed extends Base<"payout.failed"> {
  payoutId: string;
  attempt: number;
  error: string;
}

export type InternalEvent =
  | BountyCreated
  | FundingPaid
  | ClaimCreated
  | ClaimReleased
  | ClaimExpired
  | PrLinked
  | VerifyDone
  | PrMerged
  | MaintainerPay
  | MaintainerHold
  | MaintainerReject
  | BountyCancelled
  | PayoutStarted
  | PayoutSucceeded
  | PayoutFailed;

/** The event of a given type, e.g. `EventOf<"pr.merged">`. */
export type EventOf<T extends EventType> = Extract<InternalEvent, { type: T }>;

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}
