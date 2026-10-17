// Data access for the public board (W6).
// getBoard()/getRecentPayouts() read the F4 fixtures through the pure mock handler, so the page
// builds with no server running. I1 swaps these two functions for the real API; the shaping
// helpers in shape.ts only depend on the /api/board and /api/live shapes.
import board from "../../../../fixtures/board.json";
import bounties from "../../../../fixtures/bounties.json";
import type { Board, BountyDetail } from "../../../../fixtures/types";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { issueIndex, PROVIDER_LABEL, type PayoutRow } from "./shape";

const fx = { board, bounties } as unknown as Fixtures;

/** GET /api/board */
export async function getBoard(): Promise<Board> {
  const res = handleMock(fx, "GET", ["board"], new URLSearchParams());
  if (!("json" in res) || res.status !== 200) throw new Error("board_unavailable");
  return res.json as Board;
}

/** Succeeded payouts, newest first (seed for the live column). */
export async function getRecentPayouts(limit = 6): Promise<PayoutRow[]> {
  return (bounties as unknown as BountyDetail[])
    .filter((b) => b.payout?.status === "succeeded" && b.payout.paidAt)
    .sort((a, b) => (b.payout!.paidAt! < a.payout!.paidAt! ? -1 : 1))
    .slice(0, limit)
    .map((b) => ({
      bountyId: b.id,
      login: b.payout!.userLogin,
      provider: PROVIDER_LABEL[b.payout!.provider] ?? b.payout!.provider,
      repoFullName: b.repoFullName,
      issueNumber: b.issueNumber,
      amountXof: b.payout!.amountXof,
    }));
}

export async function getIssueIndex(): Promise<Record<string, number>> {
  return issueIndex(bounties as unknown as BountyDetail[]);
}

