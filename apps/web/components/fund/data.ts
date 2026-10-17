// Server-side data for /pay/[id]: reads the fixtures through the pure mock handler (works in
// `next build` with no server running). Browser calls live in api.ts.
// I1: swap these bodies for the real API, the page only depends on the shapes below.
import bounties from "../../../../fixtures/bounties.json";
import dashboard from "../../../../fixtures/dashboard.json";
import funding from "../../../../fixtures/funding.json";
import type { BountyDetail, BountyStatus, FundingRail, FundingSession } from "../../../../fixtures/types";
import { handleMock, type Fixtures } from "../../lib/mock-api";

export type { FundingRail, FundingSession };

/** What the fund page needs to know about the bounty (summary card + "already funded"). */
export interface FundBounty {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  amountXof: number;
  status: BountyStatus;
  funderLogin: string;
}

export type PollResult = { status: "pending" | "paid"; bountyStatus: BountyStatus };

export function toFundBounty(d: BountyDetail): FundBounty {
  const { id, repoFullName, issueNumber, issueTitle, amountXof, status, funderLogin } = d;
  return { id, repoFullName, issueNumber, issueTitle, amountXof, status, funderLogin };
}

/** Server: GET /api/bounties/:id, shaped for the page. `null` when unknown. */
export function getFundBounty(id: string): FundBounty | null {
  const fx = { bounties, dashboard, funding } as unknown as Fixtures;
  const res = handleMock(fx, "GET", ["bounties", id], new URLSearchParams());
  if (!("json" in res) || res.status !== 200) return null;
  return toFundBounty(res.json as BountyDetail);
}
