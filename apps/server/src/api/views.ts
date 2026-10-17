import type { Bounty, BountyStatus, Payout, Submission } from "@bitbounty/core";
import type { ClaimRecord } from "../bounties/repo.js";
import type { FundingRecord } from "../funding/store.js";
import type { ActivityEntry } from "./activity.js";
import { groupThousands } from "./format.js";

/**
 * Page shapes, as declared in fixtures/types.ts (the contract the web pages were built on).
 * Kept structural here so the server doesn't import the web fixtures.
 */
export type BountyView = Bounty & {
  issueUrl: string;
  criteriaConfirmed: boolean;
  funderLogin: string;
  labels: string[];
  updatedAt: string;
};
export type BountySummary = BountyView & { claimedBy: string | null; prNumber: number | null };
export interface TimelineEvent {
  occurredAt: string;
  type: ActivityEntry["type"];
  to: BountyStatus;
  actor: string;
  text: string;
}
export type BountyDetail = BountyView & {
  fundings: (Omit<FundingRecord, "funderId" | "amountXof" | "paymentRequest" | "expiresAt" | "fundsBounty" | "notifiedAt"> & {
    feeXof: number;
    bufferXof: number;
    createdAt: string;
  })[];
  claims: (ClaimRecordView & { userLogin: string; extended: boolean; createdAt: string })[];
  submission: (Submission & { prUrl: string; ci: "pending" | "success" | "failure"; createdAt: string }) | null;
  payout: (Payout & { userLogin: string; provider: "wave" | "orange" | "free"; phoneMasked: string; createdAt: string }) | null;
  timeline: TimelineEvent[];
};
type ClaimRecordView = Omit<ClaimRecord, "login" | "extensions">;

/** Shown wherever the real number isn't known to this module (the payout account lives with B3). */
export const MASKED_PHONE = "+221 •• ••• •• ••";

export const loginOf = (id: string): string | null => (id.startsWith("github:") ? id.slice(7) : null);

export function funderLogin(b: Bounty): string {
  if (b.funderKind === "agent") return `agent ${b.funderId.slice(0, 8)}`;
  return loginOf(b.funderId) ?? b.funderId;
}

export function bountyView(b: Bounty, updatedAt?: string): BountyView {
  return {
    ...b,
    issueUrl: `https://github.com/${b.repoFullName}/issues/${b.issueNumber}`,
    // Criteria exist only once a maintainer (or the agent) wrote them; there's no draft state stored yet.
    criteriaConfirmed: b.criteria.length > 0,
    funderLogin: funderLogin(b),
    labels: [`bounty: ${b.status}`, `💰 ${groupThousands(b.amountXof)} FCFA`],
    updatedAt: updatedAt ?? b.createdAt,
  };
}

export function bountySummary(
  b: Bounty,
  extra: { claimedBy: string | null; prNumber: number | null; updatedAt?: string },
): BountySummary {
  return { ...bountyView(b, extra.updatedAt), claimedBy: extra.claimedBy, prNumber: extra.prNumber };
}

export function timelineOf(b: Bounty, entries: ActivityEntry[]): TimelineEvent[] {
  const events = entries.map((e) => ({ occurredAt: e.occurredAt, type: e.type, to: e.to, actor: e.actor, text: e.text }));
  // Bounties created before this server process started have no recorded events: show the creation at least.
  if (!events.some((e) => e.type === "bounty.created")) {
    events.unshift({
      occurredAt: b.createdAt,
      type: "bounty.created",
      to: events[0]?.to ?? b.status,
      actor: funderLogin(b),
      text: `Bounty created: ${groupThousands(b.amountXof)} FCFA`,
    });
  }
  return events;
}

export function fundingView(f: FundingRecord): BountyDetail["fundings"][number] {
  const { funderId: _funder, amountXof: _amount, paymentRequest: _pr, expiresAt: _exp, fundsBounty: _first, notifiedAt: _n, ...rest } = f;
  return { ...rest, feeXof: f.feeXof, bufferXof: f.bufferXof, createdAt: f.createdAt };
}

/** Once the work is merged, the claim did its job: show it `done`, not still `active` (I3). */
const WORK_DONE: readonly BountyStatus[] = ["verified", "paying", "paid", "payout_failed"];

export function claimView(c: ClaimRecord, createdAt: string, bountyStatus?: BountyStatus): BountyDetail["claims"][number] {
  const { login, extensions, ...rest } = c;
  const status = c.status === "active" && bountyStatus && WORK_DONE.includes(bountyStatus) ? "done" : c.status;
  return { ...rest, status, userLogin: login, extended: (extensions ?? 0) > 0, createdAt };
}

export function submissionView(
  s: Submission,
  b: Bounty,
  createdAt: string,
): NonNullable<BountyDetail["submission"]> {
  // The verdict lands on the bounty (verify.done → settlement); the stored submission may not carry it.
  const verdict = s.verdict ?? b.verdict;
  const ci = verdict === "pass" ? "success" : verdict === "fail" ? "failure" : "pending";
  return { ...s, verdict, prUrl: `https://github.com/${b.repoFullName}/pull/${s.prNumber}`, ci, createdAt };
}

export function payoutView(p: Payout, createdAt: string): NonNullable<BountyDetail["payout"]> {
  return { ...p, userLogin: loginOf(p.userId) ?? p.userId, provider: "wave", phoneMasked: MASKED_PHONE, createdAt };
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
