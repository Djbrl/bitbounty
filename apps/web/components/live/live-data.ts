// Data layer for the /live projector screen (W8).
// Pure state shaping, shared by the server page and the client board (no fixture imports here,
// so nothing extra lands in the client bundle). Initial data: live-snapshot.ts. SSE: live-stream.ts.
import type { BountyStatus, Live, LiveEvent } from "../../../../fixtures/types";

export type LiveCard = Live["cards"][number];

/**
 * Lagos → Dakar panel (I4): a naira-funded bounty, naira → bitcoin → FCFA. Built by the server
 * (apps/server/src/api/live-route.ts) from the stored records; legs not known yet are null.
 */
export interface LiveRoute {
  bountyId: string;
  /** Naira paid for the bounty (whole ₦): the funding record's amount. */
  ngn: number;
  /** Sats the naira bought (NGN → BTC order), when known. */
  satsBought: number | null;
  /** FCFA the bounty is worth (what the developer receives). */
  xof: number;
  /** 5% fee and 3% buffer the naira also paid for, when the funding record has them. */
  feeXof: number | null;
  bufferXof: number | null;
  /** Sats the developer received over Lightning (B6), once the payout exists. */
  sats: number | null;
  /** FCFA per BTC the payout used. */
  xofPerBtc: number | null;
}

/** A transition; on a naira-funded bounty it carries the route with the legs known so far. */
export type LiveTransition = LiveEvent & { route?: LiveRoute };

/** What the screen holds: lane order + every card with its current status. */
export interface LiveState {
  columns: BountyStatus[];
  cards: LiveCard[];
}

export interface LiveSnapshot extends LiveState {
  route: LiveRoute | null;
}

/** Default lane order if a snapshot comes without columns. */
export const LIVE_COLUMNS: BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "paid"];

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** A route from the wire, or null if it lacks the bounty, the naira or the FCFA. Unknown legs become null. */
export function parseRoute(raw: unknown): LiveRoute | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ngn = count(r.ngn);
  const xof = count(r.xof);
  if (typeof r.bountyId !== "string" || !r.bountyId || !ngn || !xof) return null;
  return {
    bountyId: r.bountyId,
    ngn,
    satsBought: count(r.satsBought) || null,
    xof,
    feeXof: count(r.feeXof),
    bufferXof: count(r.bufferXof),
    sats: count(r.sats) || null,
    xofPerBtc: count(r.xofPerBtc) || null,
  };
}

/** After a snapshot: the server's names the route (or none); one without `route` (fixture stream) keeps the current one. */
export function routeAfterSnapshot(current: LiveRoute | null, s: { route?: unknown }): LiveRoute | null {
  return "route" in s ? parseRoute(s.route) : current;
}

/** After a transition: a naira-funded bounty's carries its route, with the legs known so far (newest wins). */
export function routeAfterTransition(current: LiveRoute | null, ev: { route?: unknown }): LiveRoute | null {
  return parseRoute(ev.route) ?? current;
}

/** Fixture bounty detail: just what the route needs. */
export interface RouteBounty {
  id: string;
  amountXof: number;
  fundings: { sourceCurrency: string; sourceAmount: number; status: string; feeXof?: number; bufferXof?: number }[];
  payout: { amountSats?: number | null; xofPerBtc?: number | null } | null;
}

/** Fixtures only: first live card funded in naira (kobo → whole ₦), same shape as the server's route. */
export function findRoute(all: RouteBounty[], cards: LiveCard[]): LiveRoute | null {
  for (const card of cards) {
    const b = all.find((x) => x.id === card.bountyId);
    const f = b?.fundings.find((x) => x.sourceCurrency === "NGN" && x.status === "paid");
    if (!b || !f) continue;
    const breakdown = (f.feeXof ?? 0) + (f.bufferXof ?? 0) > 0;
    return {
      bountyId: b.id,
      ngn: Math.floor(f.sourceAmount / 100),
      satsBought: null,
      xof: b.amountXof,
      feeXof: breakdown ? (f.feeXof ?? 0) : null,
      bufferXof: breakdown ? (f.bufferXof ?? 0) : null,
      sats: b.payout?.amountSats ?? null,
      xofPerBtc: b.payout?.xofPerBtc ?? null,
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

/**
 * Lagos → Dakar progress for the route card: 1 = naira in and sold for bitcoin (a route exists only
 * once the naira funding is paid, and B4 converts before it marks it paid), 2 = sats in the
 * developer's Lightning wallet.
 */
export function routeStage(status: BountyStatus | undefined): 1 | 2 {
  return status === "paid" ? 2 : 1;
}
