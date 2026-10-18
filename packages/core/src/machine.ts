import { isEventType, type BountyCreated, type EventType, type InternalEvent } from "./events.js";
import { assertAmount, isAmount } from "./money.js";
import type { Bounty, BountyStatus, Criterion, FunderKind } from "./types.js";

/**
 * Allowed transitions: status → event → possible next statuses.
 * Anything not listed is illegal. When an entry lists two targets,
 * `transition()` picks one from the event (see `pr.merged`).
 * Only `transition()` decides a status; the AI never does.
 */
export const TRANSITIONS: Readonly<
  Record<BountyStatus, Partial<Record<EventType, readonly BountyStatus[]>>>
> = {
  unfunded: {
    "funding.paid": ["funded"],
    "bounty.cancelled": ["cancelled"],
  },
  funded: {
    "claim.created": ["claimed"],
    "bounty.cancelled": ["refunded"],
  },
  claimed: {
    "claim.released": ["funded"],
    "claim.expired": ["funded"],
    "pr.linked": ["submitted"],
    // Merge without "Fixes #n": the maintainer confirms by hand.
    "maintainer.pay": ["verified"],
    // Allowed before a PR exists; the developer is notified.
    "bounty.cancelled": ["refunded"],
  },
  submitted: {
    // Records the verdict, status unchanged.
    "verify.done": ["submitted"],
    // verified only if verdict = pass and CI green, otherwise the maintainer decides.
    "pr.merged": ["verified", "on_hold"],
    "maintainer.pay": ["verified"],
    "maintainer.hold": ["on_hold"],
    // Back to funded for a new claimant. `hadSubmission` stays set, so no refund afterwards.
    "maintainer.reject": ["funded"],
    // New push (or a new PR) from the claimant: the verdict is reset, status unchanged.
    "pr.linked": ["submitted"],
    // No bounty.cancelled: once a PR is in, the funder can't take the money back.
  },
  verified: {
    "maintainer.hold": ["on_hold"],
    "payout.started": ["paying"],
  },
  paying: {
    "payout.succeeded": ["paid"],
    "payout.failed": ["payout_failed"],
  },
  payout_failed: {
    // Retry. The money stays reserved for the developer.
    "payout.started": ["paying"],
  },
  on_hold: {
    "maintainer.pay": ["verified"],
    "maintainer.reject": ["funded"],
  },
  paid: {},
  refunded: {},
  cancelled: {},
};

export type TransitionErrorCode =
  | "ILLEGAL_TRANSITION"
  | "WRONG_BOUNTY"
  | "UNDERFUNDED"
  /** `bounty.cancelled` after a PR was submitted (product.md: no refund after a PR without `/dispute`). */
  | "SUBMISSION_LOCKED"
  /** `verify.done` / `pr.merged` about another PR or commit than the one linked. */
  | "STALE_EVENT";

export type TransitionResult =
  | { ok: true; bounty: Bounty; from: BountyStatus; to: BountyStatus; event: InternalEvent }
  | {
      ok: false;
      code: TransitionErrorCode;
      message: string;
      from: BountyStatus;
      event: InternalEvent;
    };

/** The statuses `event` can lead to from `status`; empty when illegal. */
export function nextStatuses(status: BountyStatus, event: EventType): readonly BountyStatus[] {
  // Own keys only: "constructor", "__proto__", "hasOwnProperty"… must not match the prototype.
  if (typeof status !== "string" || !isEventType(event) || !Object.hasOwn(TRANSITIONS, status)) return [];
  const byEvent = TRANSITIONS[status];
  return Object.hasOwn(byEvent, event) ? (byEvent[event] ?? []) : [];
}

export function canTransition(status: BountyStatus, event: EventType): boolean {
  return nextStatuses(status, event).length > 0;
}

/**
 * Applies `event` to `bounty`. Pure: returns a new bounty, never mutates the input,
 * never throws for a bad move (returns `ok: false` instead) so callers can reply
 * on GitHub with the reason.
 */
export function transition(bounty: Bounty, event: InternalEvent): TransitionResult {
  const from = bounty.status;
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: "the event is not an object",
      from,
      event,
    };
  }
  const fail = (code: TransitionErrorCode, message: string): TransitionResult => ({
    ok: false,
    code,
    message,
    from,
    event,
  });

  if (event.bountyId !== bounty.id) {
    return fail("WRONG_BOUNTY", `event is for bounty ${event.bountyId}, not ${bounty.id}`);
  }
  const targets = nextStatuses(from, event.type);
  if (targets.length === 0) {
    return fail("ILLEGAL_TRANSITION", `${event.type} is not allowed when the bounty is ${from}`);
  }

  let to = targets[0]!;
  let verdict = bounty.verdict;
  let { hadSubmission, prNumber, headSha, payeeLogin } = bounty;

  switch (event.type) {
    case "funding.paid":
      if (!isAmount(event.amountXof) || event.amountXof < bounty.amountXof) {
        return fail(
          "UNDERFUNDED",
          `funding of ${String(event.amountXof)} FCFA doesn't cover ${bounty.amountXof} FCFA`,
        );
      }
      break;
    case "bounty.cancelled":
      if (bounty.hadSubmission === true) {
        return fail(
          "SUBMISSION_LOCKED",
          "a PR was already submitted for this bounty: the funder can't take the money back without a dispute",
        );
      }
      break;
    case "pr.linked":
      // Exact replay (same PR, same commit): no-op, the verdict on that commit still holds.
      if (from === "submitted" && event.prNumber === prNumber && event.headSha === headSha) break;
      verdict = null;
      hadSubmission = true;
      prNumber = event.prNumber;
      headSha = event.headSha;
      break;
    case "verify.done":
      // Bound to the linked commit; skipped when the bounty predates these fields.
      if (prNumber != null && event.prNumber !== prNumber) {
        return fail("STALE_EVENT", `verify.done is for PR #${event.prNumber}, the linked PR is #${prNumber}`);
      }
      if (headSha != null && event.headSha !== headSha) {
        return fail("STALE_EVENT", `verify.done is for commit ${event.headSha}, the linked commit is ${headSha}`);
      }
      verdict = event.verdict;
      break;
    case "pr.merged":
      if (prNumber != null && event.prNumber !== prNumber) {
        return fail("STALE_EVENT", `pr.merged is for PR #${event.prNumber}, the linked PR is #${prNumber}`);
      }
      to = verdict === "pass" && event.ciGreen ? "verified" : "on_hold";
      hadSubmission = true;
      break;
    case "maintainer.pay":
      // From claimed this is a merge without "Fixes #n": work was delivered all the same.
      hadSubmission = true;
      payeeLogin = event.toLogin ?? null;
      break;
    case "maintainer.reject":
      verdict = null;
      prNumber = null;
      headSha = null;
      payeeLogin = null;
      break;
  }

  const next: Bounty = { ...bounty, status: to, verdict };
  if (hadSubmission !== undefined) next.hadSubmission = hadSubmission;
  if (prNumber !== undefined) next.prNumber = prNumber;
  if (headSha !== undefined) next.headSha = headSha;
  if (payeeLogin !== undefined) next.payeeLogin = payeeLogin;
  return { ok: true, bounty: next, from, to, event };
}

export interface NewBounty {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  amountXof: number;
  criteria: Criterion[];
  funderKind: FunderKind;
  funderId: string;
  createdAt: string;
  expiresAt?: string | null;
}

/** Creates a bounty in `unfunded` with its `bounty.created` event. Throws on a non-integer amount. */
export function createBounty(input: NewBounty): { bounty: Bounty; event: BountyCreated } {
  assertAmount(input.amountXof, "amountXof");
  const bounty: Bounty = {
    ...input,
    status: "unfunded",
    verdict: null,
    statusCommentId: null,
    expiresAt: input.expiresAt ?? null,
  };
  return {
    bounty,
    event: {
      type: "bounty.created",
      bountyId: bounty.id,
      occurredAt: input.createdAt,
      amountXof: bounty.amountXof,
    },
  };
}
