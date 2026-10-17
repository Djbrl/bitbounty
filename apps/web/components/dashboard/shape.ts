// Pure data shaping for /dashboard (no React, no fetch): easy to test, reused by the client bar.
import type { BacklogSuggestion, BountyStatus, BountySummary, Dashboard } from "../../../../fixtures/types";

/** GET /api/dashboard response: dashboard.json with the listed bounties joined as summaries. */
export type DashboardData = Dashboard & { bounties: BountySummary[] };

/** POST /api/backlog/fund response (only the fields the page uses). */
export interface FundResult {
  count: number;
  suggestions: string[];
}

/** Platform fee shown in the bar; the mock funding session charges the same 5%. */
export const FEE_RATE = 0.05;

/** Statuses that are over: not shown in the "active bounties" table. */
const DONE: readonly BountyStatus[] = ["paid", "refunded", "cancelled"];

export function activeBounties(bounties: BountySummary[]): BountySummary[] {
  return bounties.filter((b) => !DONE.includes(b.status));
}

/** Ids Claude pre-ticked (`selected: true`). */
export function initialSelection(backlog: BacklogSuggestion[]): string[] {
  return backlog.filter((s) => s.selected).map((s) => s.id);
}

export interface SelectionSummary {
  count: number;
  /** What developers receive (sum of suggested prices). */
  amountXof: number;
  feeXof: number;
  /** What the maintainer pays. */
  totalXof: number;
}

export function summarizeSelection(backlog: BacklogSuggestion[], selected: Iterable<string>): SelectionSummary {
  const ids = new Set(selected);
  const picked = backlog.filter((s) => ids.has(s.id));
  const amountXof = picked.reduce((sum, s) => sum + s.priceXof, 0);
  const feeXof = Math.round(amountXof * FEE_RATE);
  return { count: picked.length, amountXof, feeXof, totalXof: amountXof + feeXof };
}

/** Toggle one id, keeping backlog order so the request and the URL are stable. */
export function toggle(backlog: BacklogSuggestion[], selected: string[], id: string): string[] {
  const set = new Set(selected);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return backlog.filter((s) => set.has(s.id)).map((s) => s.id);
}

/** Select all, or clear when everything is already selected. */
export function toggleAll(backlog: BacklogSuggestion[], selected: string[]): string[] {
  return selected.length === backlog.length ? [] : backlog.map((s) => s.id);
}

/** Where "Fund N bounties" goes: the pay page of the first one, carrying the whole batch. */
export function payHref(result: FundResult): string | null {
  const [first] = result.suggestions;
  if (!first) return null;
  const batch = result.suggestions.length > 1 ? `?batch=${result.suggestions.map(encodeURIComponent).join(",")}` : "";
  return `/pay/${encodeURIComponent(first)}${batch}`;
}

export const fundLabel = (count: number) => (count === 1 ? "Fund 1 bounty" : `Fund ${count} bounties`);

/** "Djbrl" -> "DJ" for the nav avatar. */
export const initialsOf = (login: string) =>
  login
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase() || "?";
