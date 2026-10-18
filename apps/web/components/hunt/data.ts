// U3: server-side data for /app/hunt. Same I1 loaders as the other pages (real server when
// BITBOUNTY_API_URL is set, fixtures otherwise): GET /api/me, /api/users/:login, /api/board,
// /api/me/onboarding (U1 stack + currency), /api/bounties/:id for each claim and payout. Only /api/me is required; the rest degrade per section.
import { cookies } from "next/headers";
import type { DisplayCurrency, Me } from "../../../../fixtures/types";
import { getBoard } from "../board/data";
import { getBounty } from "../bounty/data";
import { fetchMe } from "../onboarding/load-me";
import { fetchProfile, type ProfileView } from "../profile/data";
import { fetchOnboarding } from "../welcome/load";
import { activityFeed, claimCard, forYou, tierProgress, weekStreak, type BountyDetail, type ClaimCard, type FeedItem, type ForYou, type TierProgress } from "./shape";

/** Stack used for "For you": U1's saved chips, else the GitHub languages U1 read, else the profile's. */
export function pickStack(prefs: string[] | undefined, githubLanguages: string[] | undefined, profileLanguages: string[]): string[] {
  if (prefs?.length) return prefs;
  if (githubLanguages?.length) return githubLanguages;
  return profileLanguages;
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
  /** U1 display currency (amounts stay FCFA underneath). */
  currency: DisplayCurrency;
  claims: Part<ClaimCard[]>;
  forYou: Part<ForYou>;
  feed: Part<FeedItem[]>;
}

export async function loadHunt(now: Date = new Date()): Promise<HuntData> {
  const me = await fetchMe();
  const login = me.user.login;

  const detailIds = [...new Set([...me.activeClaims.map((c) => c.bountyId), ...me.payouts.map((p) => p.bountyId)])].slice(0, 12);
  const [profile, onboarding, board, details] = await Promise.all([
    fetchProfile(login, now).catch(() => null),
    fetchOnboarding().catch(() => null),
    part(getBoard()),
    part(Promise.all(detailIds.map((id) => getBounty(id).catch(() => null)))),
  ]);
  const byId = new Map<string, BountyDetail>();
  if (details.ok) for (const d of details.value) if (d) byId.set(d.id, d);

  const paidCount = Math.max(me.earnings.paidCount, profile?.stats.paidCount ?? 0);
  const languages = profile?.languages ?? [];
  const stack = pickStack(onboarding?.preferences.stack, onboarding?.githubLanguages, languages);

  return {
    me,
    profile,
    progress: tierProgress(paidCount),
    streak: profile ? weekStreak(profile.heat) : 0,
    totalSats: profile?.totalSats ?? null,
    languages: languages.length ? languages : (onboarding?.githubLanguages ?? []),
    currency: onboarding?.preferences.currency ?? "xof",
    claims: details.ok ? { ok: true, value: me.activeClaims.map((c) => claimCard(c, byId.get(c.bountyId) ?? null, login)) } : { ok: false },
    forYou: board.ok ? { ok: true, value: forYou(board.value.bounties, stack) } : { ok: false },
    feed: details.ok ? { ok: true, value: activityFeed([...byId.values()], login) } : { ok: false },
  };
}
