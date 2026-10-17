// Initial state for the /live server render, from the same fixtures the mock SSE replays.
// I1 swaps this for a fetch of `GET /api/live?format=json` (same columns/cards shape) plus the route bounty.
import type { Live } from "../../../../fixtures/types";
import bounties from "../../../../fixtures/bounties.json";
import live from "../../../../fixtures/live.json";
import { findRoute, type LiveSnapshot, type RouteBounty } from "./live-data";

export function getLiveSnapshot(): LiveSnapshot {
  const fx = live as unknown as Live;
  return { columns: fx.columns, cards: fx.cards, route: findRoute(bounties as unknown as RouteBounty[], fx.cards) };
}
