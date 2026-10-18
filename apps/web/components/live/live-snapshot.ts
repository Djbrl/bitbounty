// Initial state for the /live server render: the server's `GET /api/live?format=json` (the same
// snapshot the SSE stream opens with, Lagos route included), or the fixtures the mock SSE replays.
import type { Live } from "../../../../fixtures/types";
import bounties from "../../../../fixtures/bounties.json";
import live from "../../../../fixtures/live.json";
import { apiBaseUrl, apiGet } from "../../lib/api";
import { findRoute, LIVE_COLUMNS, parseRoute, type LiveSnapshot, type RouteBounty } from "./live-data";

export function getLiveSnapshot(): LiveSnapshot {
  const fx = live as unknown as Live;
  return { columns: fx.columns, cards: fx.cards, route: findRoute(bounties as unknown as RouteBounty[], fx.cards) };
}

/** The page's first paint: the real snapshot when the server is configured (the SSE stream takes over), else fixtures. */
export async function fetchLiveSnapshot(): Promise<LiveSnapshot> {
  if (!apiBaseUrl()) return getLiveSnapshot();
  const s = await apiGet<Partial<LiveSnapshot>>("/api/live?format=json");
  return {
    columns: s?.columns?.length ? s.columns : LIVE_COLUMNS,
    cards: s?.cards ?? [],
    route: parseRoute(s?.route),
  };
}
