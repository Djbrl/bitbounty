import type { BountyCreated, EventType, InternalEvent } from "./events.js";
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
    "maintainer.reject": ["funded"],
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

export type TransitionErrorCode = "ILLEGAL_TRANSITION" | "WRONG_BOUNTY" | "UNDERFUNDED";

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
  return TRANSITIONS[status]?.[event] ?? [];
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

  switch (event.type) {
    case "funding.paid":
      if (!isAmount(event.amountXof) || event.amountXof < bounty.amountXof) {
        return fail(
          "UNDERFUNDED",
          `funding of ${String(event.amountXof)} FCFA doesn't cover ${bounty.amountXof} FCFA`,
        );
      }
      break;
    case "pr.linked":
      verdict = null;
      break;
    case "verify.done":
      verdict = event.verdict;
      break;
    case "pr.merged":
      to = verdict === "pass" && event.ciGreen ? "verified" : "on_hold";
      break;
    case "maintainer.reject":
      verdict = null;
      break;
  }

  return { ok: true, bounty: { ...bounty, status: to, verdict }, from, to, event };
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
