// Initial state for the /live server render, from the same fixtures the mock SSE replays.
// I1 swaps this for a fetch of `GET /api/live?format=json` (same columns/cards shape) plus the route bounty.
import type { Live } from "../../../../fixtures/types";
import bounties from "../../../../fixtures/bounties.json";
import live from "../../../../fixtures/live.json";
import { apiBaseUrl, apiGet, orFallback } from "../../lib/api";
import { findRoute, LIVE_COLUMNS, type LiveSnapshot, type RouteBounty } from "./live-data";

export function getLiveSnapshot(): LiveSnapshot {
  const fx = live as unknown as Live;
  return { columns: fx.columns, cards: fx.cards, route: findRoute(bounties as unknown as RouteBounty[], fx.cards) };
}

interface Summary {
  id: string;
  status: Live["cards"][number]["status"];
  repoFullName: string;
  issueTitle: string;
  amountXof: number;
  claimedBy: string | null;
}

/** The page's first paint: real bounties when the server is configured (the SSE stream takes over), else fixtures. */
export async function fetchLiveSnapshot(): Promise<LiveSnapshot> {
  if (!apiBaseUrl()) return getLiveSnapshot();
  const list = ((await apiGet<Summary[]>("/api/bounties")) ?? []).filter((b) => LIVE_COLUMNS.includes(b.status)).slice(0, 40);
  const cards = list.map((b) => ({
    bountyId: b.id,
    status: b.status,
    repoFullName: b.repoFullName,
    issueTitle: b.issueTitle,
    amountXof: b.amountXof,
    who: b.claimedBy,
    city: null,
  }));
  // The Lagos route needs fundings and payouts: look at the most advanced cards only.
  const late = list.filter((b) => b.status === "paid" || b.status === "paying" || b.status === "verified").slice(0, 10);
  const details = await Promise.all(
    late.map((b) => orFallback(apiGet<RouteBounty>(`/api/bounties/${encodeURIComponent(b.id)}`), null, `bounty ${b.id} detail`)),
  );
  return { columns: LIVE_COLUMNS, cards, route: findRoute(details.filter((d): d is RouteBounty => d !== null), cards) };
}
