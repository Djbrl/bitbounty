// U3: pure shaping for the hunter home (/app/hunt) and the explore grid (/explore). No React, no fixtures.
import type { BountyDetail, BountySummary, EventType, Verdict } from "../../../../fixtures/types";
import { hunterTier, TIER_MIN, type HunterTier } from "../profile/data";
import { bountyLanguages, canonicalLanguage, languageFamily } from "./explore";

export type { BountyDetail, BountySummary };

// ---------------------------------------------------------------------------
// Tiers (same rule as U5's profile: TIER_MIN in components/profile/data.ts)

export interface TierProgress {
  tier: HunterTier | null;
  next: HunterTier | null;
  /** Paid bounties still needed for `next` (0 at Gold). */
  remaining: number;
  /** 0..1 progress from the current tier's floor to the next one (1 at Gold). */
  ratio: number;
}

const ORDER: HunterTier[] = ["bronze", "silver", "gold"];

export function tierProgress(paidCount: number): TierProgress {
  const tier = hunterTier(paidCount);
  const next = ORDER.find((t) => paidCount < TIER_MIN[t]) ?? null;
  if (!next) return { tier, next: null, remaining: 0, ratio: 1 };
  const floor = tier ? TIER_MIN[tier] : 0;
  const span = TIER_MIN[next] - floor;
  return { tier, next, remaining: TIER_MIN[next] - paidCount, ratio: Math.max(0, Math.min(1, (paidCount - floor) / span)) };
}

// ---------------------------------------------------------------------------
// Streak: consecutive weeks (ending this week or last week) with at least one paid bounty.

/** `heat` = weekly buckets, oldest first, last = this week (profile's heatmap()). */
export function weekStreak(heat: number[]): number {
  let i = heat.length - 1;
  // This week may still be empty: a streak that ended last week is still alive.
  if (i >= 0 && heat[i] === 0) i -= 1;
  let n = 0;
  while (i >= 0 && heat[i]! > 0) {
    n += 1;
    i -= 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// "For you": open bounties matched to the user's stack.

export interface ForYou {
  rows: BountySummary[];
  /** True when rows are stack matches; false when nothing matched (or no stack) and rows are all open bounties. */
  matched: boolean;
  /** The stack used (U1 preferences, else GitHub languages). */
  stack: string[];
}

/**
 * Rule: only bounties open to claim (status `funded`). A bounty matches when one of its languages
 * (bountyLanguages) is in the user's stack, JavaScript and TypeScript counting as one. Matches come
 * first, biggest amount first. No stack or no match → every open bounty, newest first.
 */
export function forYou(bounties: BountySummary[], stack: string[], limit = 6): ForYou {
  const open = bounties.filter((b) => b.status === "funded");
  const want = new Set(stack.map((s) => languageFamily(canonicalLanguage(s) ?? s)));
  const hits = open.filter((b) => bountyLanguages(b).some((l) => want.has(languageFamily(l))));
  if (hits.length) return { rows: hits.sort((a, b) => b.amountXof - a.amountXof).slice(0, limit), matched: true, stack };
  return { rows: [...open].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit), matched: false, stack };
}

// ---------------------------------------------------------------------------
// Active claims: countdown + PR status + Claude's verdict.

export interface ClaimCard {
  bountyId: string;
  issueTitle: string;
  repoFullName: string;
  issueNumber: number | null;
  issueUrl: string | null;
  amountXof: number | null;
  expiresAt: string;
  createdAt: string | null;
  extended: boolean;
  pr: { number: number; url: string; ci: "pending" | "success" | "failure"; merged: boolean } | null;
  verdict: Verdict | null;
}

export function claimCard(
  c: { bountyId: string; issueTitle: string; repoFullName: string; expiresAt: string },
  detail: BountyDetail | null,
  login: string | null,
): ClaimCard {
  const mine = detail?.claims.find((x) => x.status === "active" && (!login || x.userLogin === login)) ?? null;
  const sub = detail?.submission && (!login || detail.submission.authorLogin === login) ? detail.submission : null;
  return {
    bountyId: c.bountyId,
    issueTitle: c.issueTitle,
    repoFullName: c.repoFullName,
    issueNumber: detail?.issueNumber ?? null,
    issueUrl: detail?.issueUrl ?? null,
    amountXof: detail?.amountXof ?? null,
    expiresAt: mine?.expiresAt ?? c.expiresAt,
    createdAt: mine?.createdAt ?? null,
    extended: mine?.extended ?? false,
    pr: sub ? { number: sub.prNumber, url: sub.prUrl, ci: sub.ci, merged: sub.mergedAt !== null } : null,
    verdict: sub?.verdict ?? null,
  };
}

/** Milliseconds → {d, h, m}; negative → zeros. */
export function splitDuration(ms: number): { d: number; h: number; m: number } {
  const total = Math.max(0, Math.floor(ms / 60_000));
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}

/** "2 j 03 h 12 min" / "2 d 03 h 12 min"; "45 min" under an hour. */
export function formatCountdown(ms: number, lang: "fr" | "en"): string {
  const { d, h, m } = splitDuration(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d) return `${d} ${lang === "fr" ? "j" : "d"} ${pad(h)} h ${pad(m)} min`;
  if (h) return `${h} h ${pad(m)} min`;
  return `${m} min`;
}

/** Fraction of the claim window already used (0..1); null without a start. */
export function claimElapsed(createdAt: string | null, expiresAt: string, now: number): number | null {
  if (!createdAt) return null;
  const start = Date.parse(createdAt);
  const end = Date.parse(expiresAt);
  if (!(end > start)) return null;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

// ---------------------------------------------------------------------------
// Activity feed: funded, claimed, verified, paid events on the user's bounties.

export const FEED_EVENTS: readonly EventType[] = ["funding.paid", "claim.created", "pr.linked", "verify.done", "pr.merged", "payout.succeeded"];

export interface FeedItem {
  bountyId: string;
  issueTitle: string;
  repoFullName: string;
  type: EventType;
  occurredAt: string;
  amountXof: number;
}

/** Newest first. Funding shows for every bounty the user works on; the rest only when the user did it (or got paid). */
export function activityFeed(details: BountyDetail[], login: string | null, limit = 8): FeedItem[] {
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const d of details) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    for (const e of d.timeline) {
      if (!FEED_EVENTS.includes(e.type)) continue;
      const mineToo = e.type === "funding.paid" || e.type === "verify.done" || e.type === "pr.merged" || e.type === "payout.succeeded" || !login || e.actor === login;
      if (!mineToo) continue;
      items.push({ bountyId: d.id, issueTitle: d.issueTitle, repoFullName: d.repoFullName, type: e.type, occurredAt: e.occurredAt, amountXof: d.amountXof });
    }
  }
  return items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
}

