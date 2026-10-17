// Pure shaping for the public board (W6): no fixture imports, safe in client components.
import type {
  BountyStatus,
  BountySummary,
  Live,
  LiveEvent,
  PayoutProvider,
} from "../../../../fixtures/types";

export type { Board, BountySummary, ExternalBounty, Live, LiveEvent } from "../../../../fixtures/types";

/** One row of the live payouts column. */
export interface PayoutRow {
  bountyId: string;
  login: string;
  provider: string;
  repoFullName: string;
  issueNumber: number | null;
  amountXof: number;
  /** Optional context line from the live event ("Lagos → Dakar …"). */
  note?: string;
  /** True when it arrived over the live stream (gets a highlight). */
  fresh?: boolean;
}

export const PROVIDER_LABEL: Record<PayoutProvider, string> = {
  wave: "Wave",
  orange: "Orange Money",
  free: "Free Money",
};

/** id -> issue number, so live rows (which only carry repo + title) can show "repo #n". */
export function issueIndex(rows: { id: string; issueNumber: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.id, r.issueNumber]));
}

// ---------------------------------------------------------------------------
// Open bounties + filters

/** Statuses shown on the board: funded money that is not paid out yet. */
export const BOARD_STATUSES: readonly BountyStatus[] = ["funded", "claimed", "submitted", "verified", "paying", "on_hold"];

export function openBounties(rows: BountySummary[]): BountySummary[] {
  return rows
    .filter((b) => BOARD_STATUSES.includes(b.status))
    .sort((a, b) => {
      // claimable first, then newest
      const ao = a.status === "funded" ? 0 : 1;
      const bo = b.status === "funded" ? 0 : 1;
      return ao - bo || (b.updatedAt < a.updatedAt ? -1 : b.updatedAt > a.updatedAt ? 1 : 0);
    });
}

export interface BoardFilter {
  id: string;
  label: string;
  test: (b: BountySummary) => boolean;
}

export const SMALL_BOUNTY_XOF = 10_000;

/** Fixed filters + one per repo owner present in the data. */
export function boardFilters(rows: BountySummary[]): BoardFilter[] {
  const owners = [...new Set(rows.map((b) => b.repoFullName.split("/")[0]!))].sort((a, b) => a.localeCompare(b));
  return [
    { id: "all", label: "All", test: () => true },
    { id: "open", label: "Open to claim", test: (b) => b.status === "funded" },
    { id: "small", label: "< 10 000 F", test: (b) => b.amountXof < SMALL_BOUNTY_XOF },
    { id: "agent", label: "Funded by an agent", test: (b) => b.funderKind === "agent" },
    ...owners.map((o) => ({ id: `org:${o}`, label: o, test: (b: BountySummary) => b.repoFullName.startsWith(`${o}/`) })),
  ];
}

export function applyFilter(rows: BountySummary[], filters: BoardFilter[], id: string): BountySummary[] {
  const f = filters.find((x) => x.id === id) ?? filters[0];
  return f ? rows.filter(f.test) : rows;
}

/** Labels worth showing as tags (drop the generic "bounty" and the "💰 amount" label). */
export function displayLabels(b: BountySummary): string[] {
  return b.labels.filter((l) => l !== "bounty" && !l.startsWith("💰"));
}

/** "$500", "$1,234.50" from cents. */
export function formatUsd(cents: number): string {
  const whole = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = cents % 100;
  return `$${whole}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

// ---------------------------------------------------------------------------
// Live payouts (SSE /api/live: `snapshot`, then `transition` events)

export interface LiveState {
  cards: Record<string, Live["cards"][number]>;
  payouts: PayoutRow[];
}

export function initialLiveState(payouts: PayoutRow[]): LiveState {
  return { cards: {}, payouts };
}

const PROVIDER_RE = /\bon (Wave|Orange Money|Free Money)\b/;
const LOGIN_RE = /@([A-Za-z0-9-]+)/;

export function onSnapshot(state: LiveState, snap: Pick<Live, "cards">): LiveState {
  const cards = { ...state.cards };
  for (const c of snap.cards) cards[c.bountyId] = { ...cards[c.bountyId], ...c, who: c.who ?? cards[c.bountyId]?.who ?? null };
  return { ...state, cards };
}

/**
 * Apply one live transition. Claims fill in who works on a card; a `payout.succeeded`
 * adds a payout row on top (once per bounty: the mock stream loops).
 */
export function onTransition(
  state: LiveState,
  ev: Pick<LiveEvent, "bountyId" | "event" | "to" | "text">,
  issues: Record<string, number> = {},
  max = 8,
): LiveState {
  const card = state.cards[ev.bountyId];
  const login = ev.text.match(LOGIN_RE)?.[1] ?? null;
  const cards = card
    ? { ...state.cards, [ev.bountyId]: { ...card, status: ev.to, who: ev.event === "claim.created" && login ? login : card.who } }
    : state.cards;
  if (ev.event !== "payout.succeeded" || !card) return { ...state, cards };
  if (state.payouts.some((p) => p.bountyId === ev.bountyId)) return { ...state, cards };
  const who = login ?? card.who;
  if (!who) return { ...state, cards };
  const row: PayoutRow = {
    bountyId: ev.bountyId,
    login: who,
    provider: ev.text.match(PROVIDER_RE)?.[1] ?? "mobile money",
    repoFullName: card.repoFullName,
    issueNumber: issues[ev.bountyId] ?? null,
    amountXof: card.amountXof,
    note: /→/.test(ev.text) ? ev.text.replace(/^💸\s*/, "") : undefined,
    fresh: true,
  };
  return { cards, payouts: [row, ...state.payouts.map((p) => ({ ...p, fresh: false }))].slice(0, max) };
}
