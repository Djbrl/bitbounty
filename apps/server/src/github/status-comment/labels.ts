import type { BountyStatus } from "@bitbounty/core";
import { groupThousands } from "./format.js";

export interface GithubLabel {
  name: string;
  /** Hex without `#`, as the GitHub API wants it. */
  color: string;
  description: string;
}

/**
 * One label per status. G3 sets `labelFor(bounty.status)` and removes every other
 * name in `STATUS_LABEL_NAMES`, so an issue carries exactly one status label.
 * Typed as a Record so a new status in F2 fails the typecheck until it gets a label.
 */
export const STATUS_LABELS: Readonly<Record<BountyStatus, GithubLabel>> = {
  unfunded: { name: "bounty: waiting for funding", color: "bf8700", description: "BitBounty: bounty set, not funded yet" },
  funded: { name: "bounty: open", color: "1a7f37", description: "BitBounty: funded and open to claim" },
  claimed: { name: "bounty: claimed", color: "0969da", description: "BitBounty: someone is working on it" },
  submitted: { name: "bounty: in review", color: "8250df", description: "BitBounty: PR submitted, being checked" },
  verified: { name: "bounty: validated", color: "1a7f37", description: "BitBounty: validated, payout queued" },
  paying: { name: "bounty: paying", color: "1a7f37", description: "BitBounty: payout in progress" },
  paid: { name: "bounty: paid", color: "116329", description: "BitBounty: developer paid" },
  on_hold: { name: "bounty: on hold", color: "d1242f", description: "BitBounty: the maintainer needs to decide" },
  payout_failed: { name: "bounty: payout failed", color: "d1242f", description: "BitBounty: payout failed, money still reserved" },
  refunded: { name: "bounty: refunded", color: "6e7781", description: "BitBounty: refunded to the funder" },
  cancelled: { name: "bounty: cancelled", color: "6e7781", description: "BitBounty: cancelled before funding" },
};

export const STATUS_LABEL_NAMES: readonly string[] = Object.values(STATUS_LABELS).map((l) => l.name);

export function labelFor(status: BountyStatus): GithubLabel {
  return STATUS_LABELS[status];
}

/** The amount label from the mockup, `💰 10 000 FCFA`, that everyone can filter on. */
export function amountLabel(amountXof: number): GithubLabel {
  return {
    name: `💰 ${groupThousands(amountXof).replace(/\u00A0/g, " ")} FCFA`,
    color: "f2c94c",
    description: "BitBounty: what the developer receives",
  };
}
