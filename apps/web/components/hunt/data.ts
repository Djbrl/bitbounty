// U3: server-side data for /app/hunt. Same I1 loaders as the other pages (real server when
// BITBOUNTY_API_URL is set, fixtures otherwise): GET /api/me, /api/users/:login, /api/board,
// /api/bounties/:id for each claim and payout. Only /api/me is required; the rest degrade per section.
import { cookies } from "next/headers";
import type { Me } from "../../../../fixtures/types";
import { getBoard } from "../board/data";
import { getBounty } from "../bounty/data";
import { fetchMe } from "../onboarding/load-me";
import { fetchProfile, type ProfileView } from "../profile/data";
import { activityFeed, claimCard, forYou, tierProgress, weekStreak, type BountyDetail, type ClaimCard, type FeedItem, type ForYou, type TierProgress } from "./shape";

/** Cookie U1 can write with the hunter's chosen stack (comma separated). Until then: GitHub languages. */
export const STACK_COOKIE = "bb_stack";

export function parseStack(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => {
      try {
        return decodeURIComponent(s).trim();
      } catch {
        return s.trim();
      }
    })
    .filter(Boolean)
    .slice(0, 20);
}

/** A section that failed to load renders its own error state instead of breaking the page. */
export type Part<T> = { ok: true; value: T } | { ok: false };

async function part<T>(p: Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, value: await p };
  } catch {
    return { ok: false };
  }
}

/** A cookie of the current request; undefined outside one (tests). */
export async function readCookie(name: string): Promise<string | undefined> {
  try {
    return (await cookies()).get(name)?.value;
  } catch {
    return undefined;
  }
}

export interface HuntData {
  me: Me;
  profile: ProfileView | null;
  progress: TierProgress;
  streak: number;
  totalSats: number | null;
  languages: string[];
  claims: Part<ClaimCard[]>;
  forYou: Part<ForYou>;
  feed: Part<FeedItem[]>;
}

export async function loadHunt(now: Date = new Date()): Promise<HuntData> {
  const me = await fetchMe();
  const login = me.user.login;
  const prefs = parseStack(await readCookie(STACK_COOKIE));

  const detailIds = [...new Set([...me.activeClaims.map((c) => c.bountyId), ...me.payouts.map((p) => p.bountyId)])].slice(0, 12);
  const [profile, board, details] = await Promise.all([
    fetchProfile(login, now).catch(() => null),
    part(getBoard()),
    part(Promise.all(detailIds.map((id) => getBounty(id).catch(() => null)))),
  ]);
  const byId = new Map<string, BountyDetail>();
  if (details.ok) for (const d of details.value) if (d) byId.set(d.id, d);

  const paidCount = Math.max(me.earnings.paidCount, profile?.stats.paidCount ?? 0);
  const languages = profile?.languages ?? [];
  const stack = prefs.length ? prefs : languages;

  return {
    me,
    profile,
    progress: tierProgress(paidCount),
    streak: profile ? weekStreak(profile.heat) : 0,
    totalSats: profile?.totalSats ?? null,
    languages,
    claims: details.ok ? { ok: true, value: me.activeClaims.map((c) => claimCard(c, byId.get(c.bountyId) ?? null, login)) } : { ok: false },
    forYou: board.ok ? { ok: true, value: forYou(board.value.bounties, stack) } : { ok: false },
    feed: details.ok ? { ok: true, value: activityFeed([...byId.values()], login) } : { ok: false },
  };
}
