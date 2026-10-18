// Data access for the public board (W6).
// getBoard()/getRecentPayouts() read the F4 fixtures through the pure mock handler, so the page
// builds with no server running. I1 swaps these two functions for the real API; the shaping
// helpers in shape.ts only depend on the /api/board and /api/live shapes.
import board from "../../../../fixtures/board.json";
import bounties from "../../../../fixtures/bounties.json";
import type { Board, BountyDetail } from "../../../../fixtures/types";
import { apiBaseUrl, apiGet, load } from "../../lib/api";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { issueIndex, payoutVia, type PayoutRow } from "./shape";

const fx = { board, bounties } as unknown as Fixtures;

/** GET /api/board */
export async function getBoard(): Promise<Board> {
  const board = await load<Board>("/api/board", () => {
    const res = handleMock(fx, "GET", ["board"], new URLSearchParams());
    return "json" in res && res.status === 200 ? (res.json as Board) : null;
  });
  if (!board) throw new Error("board_unavailable");
  return board;
}

/** Real server: details of the latest paid bounties (the board API carries summaries only). */
async function paidDetails(limit: number): Promise<BountyDetail[]> {
  const paid = (await apiGet<{ id: string }[]>("/api/bounties?status=paid")) ?? [];
  const details = await Promise.all(paid.slice(0, limit).map((b) => apiGet<BountyDetail>(`/api/bounties/${encodeURIComponent(b.id)}`)));
  return details.filter((d): d is BountyDetail => d !== null);
}

/** Succeeded payouts, newest first (seed for the live column). */
export async function getRecentPayouts(limit = 6): Promise<PayoutRow[]> {
  const source = apiBaseUrl() ? await paidDetails(limit) : (bounties as unknown as BountyDetail[]);
  return source
    .filter((b) => b.payout?.status === "succeeded" && b.payout.paidAt)
    .sort((a, b) => (b.payout!.paidAt! < a.payout!.paidAt! ? -1 : 1))
    .slice(0, limit)
    .map((b) => ({
      bountyId: b.id,
      login: b.payout!.userLogin,
      via: payoutVia(b.payout!.amountSats),
      repoFullName: b.repoFullName,
      issueNumber: b.issueNumber,
      amountXof: b.payout!.amountXof,
    }));
}

export async function getIssueIndex(): Promise<Record<string, number>> {
  if (apiBaseUrl()) return issueIndex((await apiGet<{ id: string; issueNumber: number }[]>("/api/bounties")) ?? []);
  return issueIndex(bounties as unknown as BountyDetail[]);
}

