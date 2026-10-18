// Data for /u/[login] (W7). Reads the F4 mock API handler directly so `next build` needs no server.
// I1: swap `loadProfile` for `fetch(`${API}/api/users/${login}`)` (+ receipts); the shaping below stays.
import receipts from "../../../../fixtures/receipts.json";
import users from "../../../../fixtures/users.json";
import type { Profile, Receipt } from "../../../../fixtures/types";
import { apiBaseUrl, apiGet, orFallback } from "../../lib/api";
import { handleMock, type Fixtures } from "../../lib/mock-api";

const fx = { users, receipts } as unknown as Fixtures;

/** Logins present in the fixtures (used by generateStaticParams). */
export const FIXTURE_LOGINS = Object.keys(users);

function get<T>(path: string[]): T | null {
  const res = handleMock(fx, "GET", path, new URLSearchParams());
  return "json" in res && res.status === 200 ? (res.json as T) : null;
}

export type WorkItem = Profile["work"][number] & {
  repoUrl: string;
  receiptHref: string;
  /** From the receipt, when it exists. */
  bitnobReference: string | null;
  /** Sats received over Lightning (B6), from the receipt. */
  sats: number | null;
  funderLogin: string | null;
  signed: boolean;
};

/** U5 hunter tier, from paid bounties (same thresholds as the U3 hunter card): 1+ bronze, 5+ silver, 15+ gold. */
export type HunterTier = "bronze" | "silver" | "gold";
export const TIER_MIN: Record<HunterTier, number> = { bronze: 1, silver: 5, gold: 15 };

export function hunterTier(paidCount: number): HunterTier | null {
  if (paidCount >= TIER_MIN.gold) return "gold";
  if (paidCount >= TIER_MIN.silver) return "silver";
  if (paidCount >= TIER_MIN.bronze) return "bronze";
  return null;
}

export interface ProfileView {
  user: Profile["user"];
  initials: string;
  tier: HunterTier | null;
  /** Sats received over Lightning, summed from the receipts; null when no receipt carries sats. */
  totalSats: number | null;
  stats: Profile["stats"];
  languages: string[];
  repos: { fullName: string; url: string; count: number }[];
  work: WorkItem[];
  /** A payout only lands on a working Lightning Address, so any paid work proves the payout account works.
   * The users endpoint does not expose the account status yet; I1 can replace this with the real flag. */
  payoutVerified: boolean;
  /** 26 weekly buckets (oldest first) of paid bounties, ending the week of `now`. */
  heat: number[];
}

export function initialsOf(name: string, login: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const src = parts.length >= 2 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? login).slice(0, 2);
  return src.toUpperCase();
}

const WEEK = 7 * 24 * 3600_000;

export function heatmap(dates: string[], now: Date, weeks = 26): number[] {
  const cells = Array<number>(weeks).fill(0);
  for (const d of dates) {
    // Clamp slightly-future dates (clock skew, fixtures dated "today") into the current week.
    const ago = Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / WEEK));
    if (ago < weeks) cells[weeks - 1 - ago]! += 1;
  }
  return cells;
}

/** Pure shaping: profile (+ receipts lookup) → what the page renders. */
export function shapeProfile(p: Profile, receiptOf: (id: string) => Receipt | null, now: Date): ProfileView {
  const work = [...p.work]
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    .map((w): WorkItem => {
      const r = receiptOf(w.receiptId);
      return {
        ...w,
        repoUrl: `https://github.com/${w.repoFullName}`,
        receiptHref: `/r/${w.receiptId}`,
        bitnobReference: r?.bitnobReference ?? null,
        sats: r?.paidWith?.amountSats ?? null,
        funderLogin: r?.fundedWith.funderLogin ?? null,
        signed: Boolean(r?.signature),
      };
    });
  const byRepo = new Map<string, number>();
  for (const w of work) byRepo.set(w.repoFullName, (byRepo.get(w.repoFullName) ?? 0) + 1);
  return {
    user: p.user,
    initials: initialsOf(p.user.name, p.user.login),
    tier: hunterTier(p.stats.paidCount),
    totalSats: work.some((w) => w.sats != null) ? work.reduce((n, w) => n + (w.sats ?? 0), 0) : null,
    stats: p.stats,
    languages: p.languages,
    repos: [...byRepo].map(([fullName, count]) => ({ fullName, url: `https://github.com/${fullName}`, count })),
    work,
    payoutVerified: work.length > 0,
    heat: heatmap(
      work.map((w) => w.paidAt),
      now,
    ),
  };
}

/** GET /api/users/:login (+ /api/receipts/:id per paid bounty). null → 404. */
export function loadProfile(login: string, now: Date = new Date()): ProfileView | null {
  const p = get<Profile>(["users", login]);
  if (!p) return null;
  return shapeProfile(p, (id) => get<Receipt>(["receipts", id]), now);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-17T18:26:00Z" → "17 Oct 2026" (UTC, no Intl drift). */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 5 → "5 min", 90 → "1 h 30", 0/neg → "—". */
export function formatMinutes(m: number): string {
  if (!(m > 0)) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

/** "16 180 sats · Lightning", or "Lightning" when the sats aren't known. */
export function payoutLabel(sats: number | null): string {
  return sats ? `${String(sats).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} sats · Lightning` : "Lightning";
}

/** The page's loader: the real server when configured (profile + one receipt per paid bounty), else fixtures. */
export async function fetchProfile(login: string, now: Date = new Date()): Promise<ProfileView | null> {
  if (!apiBaseUrl()) return loadProfile(login, now);
  const p = await apiGet<Profile>(`/api/users/${encodeURIComponent(login)}`);
  if (!p) return null;
  const receipts = new Map<string, Receipt | null>();
  await Promise.all(
    p.work.map(async (w) => receipts.set(w.receiptId, await orFallback(apiGet<Receipt>(`/api/receipts/${encodeURIComponent(w.receiptId)}`), null, `receipt ${w.receiptId}`))),
  );
  return shapeProfile(p, (id) => receipts.get(id) ?? null, now);
}
