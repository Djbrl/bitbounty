import { BOUNTY_STATUSES, type BountyStatus } from "@bitbounty/core";
import type { Tone } from "./tone";

export interface StatusMeta {
  tone: Tone;
  /** English label (maintainer surfaces). */
  label: string;
  /** French label (developer surfaces). */
  labelFr: string;
  /** One-line explanation, used as the badge title. */
  hint: string;
}

/**
 * Visual mapping for every bounty status of the F2 contract.
 * Typed as Record<BountyStatus, …>, so adding a status in @bitbounty/core breaks the build here.
 * One colour per status, no two alike (U0), in the landing's families: amber = waiting on money,
 * green = money held / checked / landed (soft, then bright, then solid as it gets closer to the phone),
 * ink = payout in flight, blue = a developer is on it, red = payout failed, grey = closed without payout.
 */
export const STATUS_META: Record<BountyStatus, StatusMeta> = {
  unfunded: { tone: "amber", label: "Awaiting funds", labelFr: "En attente de fonds", hint: "Bounty posted, fund link live, can't be claimed yet." },
  funded: { tone: "money", label: "Funded", labelFr: "Financé", hint: "Money held. Open to claims." },
  claimed: { tone: "claim", label: "Claimed", labelFr: "Réservé", hint: "A developer has 72 h to open a PR." },
  submitted: { tone: "claim-solid", label: "PR submitted", labelFr: "PR soumise", hint: "PR linked. Claude checks the criteria." },
  verified: { tone: "bright", label: "Verified", labelFr: "Vérifié", hint: "Merged, CI green, verdict pass. Objection window." },
  paying: { tone: "ink", label: "Paying out", labelFr: "Paiement en cours", hint: "Bitnob payout to mobile money in flight." },
  paid: { tone: "money-solid", label: "Paid", labelFr: "Payé", hint: "Paid out. Receipt everywhere." },
  on_hold: { tone: "pending", label: "On hold", labelFr: "En pause", hint: "Maintainer put the payout on hold." },
  payout_failed: { tone: "danger", label: "Payout failed", labelFr: "Paiement échoué", hint: "Retrying. Money stays reserved for the developer." },
  refunded: { tone: "neutral", label: "Refunded", labelFr: "Remboursé", hint: "Money returned to the funder." },
  cancelled: { tone: "outline", label: "Cancelled", labelFr: "Annulé", hint: "Bounty withdrawn before any submission." },
};

export function statusMeta(status: BountyStatus): StatusMeta {
  return STATUS_META[status];
}

export { BOUNTY_STATUSES };
export type { BountyStatus };
