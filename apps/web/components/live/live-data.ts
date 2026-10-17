// Data layer for the /live projector screen (W8).
// Pure state shaping, shared by the server page and the client board (no fixture imports here,
// so nothing extra lands in the client bundle). Initial data: live-snapshot.ts. SSE: live-stream.ts.
import type { BountyStatus, Live, LiveEvent } from "../../../../fixtures/types";

export type LiveCard = Live["cards"][number];
export type LiveTransition = LiveEvent;

/** What the screen holds: lane order + every card with its current status. */
export interface LiveState {
  columns: BountyStatus[];
  cards: LiveCard[];
}

/** Lagos → Dakar panel: an NGN-funded bounty followed across the board. */
export interface LiveRoute {
  bountyId: string;
  /** Naira paid in (whole ₦). */
  ngn: number;
  /** FCFA paid out. */
  xof: number;
  provider: string;
}

export interface LiveSnapshot extends LiveState {
  route: LiveRoute | null;
}

/** Default lane order if a snapshot comes without columns. */
export const LIVE_COLUMNS: BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "paid"];

export interface RouteBounty {
  id: string;
  fundings: { sourceCurrency: string; sourceAmount: number; status: string }[];
  payout: { amountXof: number; provider: string } | null;
}

/** First live card funded in naira (minor units → whole ₦) and paid out to mobile money. */
export function findRoute(all: RouteBounty[], cards: LiveCard[]): LiveRoute | null {
  for (const card of cards) {
    const b = all.find((x) => x.id === card.bountyId);
    const f = b?.fundings.find((x) => x.sourceCurrency === "NGN" && x.status === "paid");
    if (!b || !f) continue;
    return {
      bountyId: b.id,
      ngn: Math.round(f.sourceAmount / 100),
      xof: b.payout?.amountXof ?? card.amountXof,
      provider: b.payout?.provider ?? "wave",
    };
  }
  return null;
}

/** Moves a card to `to` and puts it on top of its new lane. Unknown ids are ignored. */
export function applyTransition(state: LiveState, ev: Pick<LiveTransition, "bountyId" | "to">): LiveState {
  const card = state.cards.find((c) => c.bountyId === ev.bountyId);
  if (!card) return state;
  const moved = { ...card, status: ev.to };
  return { ...state, cards: [moved, ...state.cards.filter((c) => c.bountyId !== ev.bountyId)] };
}

/** Cards per lane, in state order. Cards whose status has no lane are dropped. */
export function groupByColumn(state: LiveState): { status: BountyStatus; cards: LiveCard[] }[] {
  return state.columns.map((status) => ({ status, cards: state.cards.filter((c) => c.status === status) }));
}

export function totalPaid(cards: LiveCard[]): number {
  return cards.filter((c) => c.status === "paid").reduce((s, c) => s + c.amountXof, 0);
}

export function countPaid(cards: LiveCard[]): number {
  return cards.filter((c) => c.status === "paid").length;
}

/** Cards still moving (on the board but not paid yet). */
export function countInFlight(state: LiveState): number {
  return state.cards.filter((c) => c.status !== "paid" && state.columns.includes(c.status)).length;
}

/** "teranga-labs/bitnob-js" -> "bitnob-js". */
export function shortRepo(repoFullName: string): string {
  return repoFullName.split("/").pop() ?? repoFullName;
}

/** `?speed=4` fast-forwards the mock stream; clamp to something sane. */
export function parseSpeed(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.max(n, 0.25), 20);
}

/** Reconnect backoff: 1 s, 2 s, 4 s, 8 s, then 10 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000);
}

/** Lagos → Dakar progress for the route card: 0 = naira in, 1 = bitcoin, 2 = FCFA on mobile money. */
export function routeStage(status: BountyStatus | undefined): 0 | 1 | 2 {
  if (status === "paid") return 2;
  if (status === "verified" || status === "paying") return 1;
  return 0;
}
