// Data for /u/[login] (W7). Reads the F4 mock API handler directly so `next build` needs no server.
// I1: swap `loadProfile` for `fetch(`${API}/api/users/${login}`)` (+ receipts); the shaping below stays.
import receipts from "../../../../fixtures/receipts.json";
import users from "../../../../fixtures/users.json";
import type { PayoutProvider, Profile, Receipt } from "../../../../fixtures/types";
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
  provider: PayoutProvider | null;
  funderLogin: string | null;
  signed: boolean;
};

export interface ProfileView {
  user: Profile["user"];
  initials: string;
  stats: Profile["stats"];
  languages: string[];
  repos: { fullName: string; url: string; count: number }[];
  work: WorkItem[];
  /** A Wave/Orange payout only lands on an SMS + test-payment verified account, so any paid work proves it.
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
        provider: r?.provider ?? null,
        funderLogin: r?.fundedWith.funderLogin ?? null,
        signed: Boolean(r?.signature),
      };
    });
  const byRepo = new Map<string, number>();
  for (const w of work) byRepo.set(w.repoFullName, (byRepo.get(w.repoFullName) ?? 0) + 1);
  return {
    user: p.user,
    initials: initialsOf(p.user.name, p.user.login),
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

export const PROVIDER_LABEL: Record<PayoutProvider, string> = { wave: "Wave", orange: "Orange Money", free: "Free Money" };
