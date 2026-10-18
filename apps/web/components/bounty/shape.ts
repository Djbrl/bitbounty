// Pure data shaping for the bounty and receipt pages (tested in bounty.test.tsx).
import type {
  BountyDetail,
  EventType,
  FundingRail,
  PayoutStatus,
  Receipt,
  Verdict,
} from "../../../../fixtures/types";
import type { Tone } from "../ui/tone";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const pad = (n: number) => String(n).padStart(2, "0");

/** "18:26" — UTC, which is Dakar time. No Intl, so no hydration drift. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "17 Oct, 18:26" (en) or "17 oct., 18:26" (fr). */
export function formatDateTime(iso: string, lang: "en" | "fr" = "en"): string {
  const d = new Date(iso);
  const m = (lang === "fr" ? MOIS : MONTHS)[d.getUTCMonth()];
  return `${d.getUTCDate()} ${m}, ${formatClock(iso)}`;
}

/** Whole minutes from a to b (never negative). */
export function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));
}

/** 6 -> "6 min", 95 -> "1 h 35 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Funding source amount in its own unit: sats, USDT, naira. */
export function formatSource(rail: FundingRail, amount: number): string {
  if (rail === "lightning") return `${group(amount)} sats`;
  if (rail === "usdt") return `${(amount / 1_000_000).toFixed(2)} USDT`;
  return `₦${group(Math.round(amount / 100))}`;
}

export const RAIL_LABEL: Record<FundingRail, string> = {
  lightning: "Lightning",
  usdt: "USDT",
  ngn: "Naira bank transfer",
};

/** B6: where a payout goes, "Lightning · aw***@blink.sv" (the API sends the address masked). */
export function payoutDestination(p: { lightningAddress?: string | null }): string {
  return p.lightningAddress ? `Lightning · ${p.lightningAddress}` : "Lightning";
}

/** 16180 -> "16 180 sats". */
export function formatSatsAmount(sats: number): string {
  return `${group(sats)} sats`;
}

/** FCFA is pegged to the euro: 1 EUR = 655.957 XOF. 10 000 -> "≈ €15.24". */
export function xofToEur(xof: number): string {
  return `≈ €${(xof / 655.957).toFixed(2)}`;
}

export interface VerdictMeta {
  tone: Tone;
  icon: string;
  label: string;
  next: string;
}

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  pass: {
    tone: "money",
    icon: "✓",
    label: "pass",
    next: "Pass + CI green + merge pays automatically, after a 24 h objection window. /pay now skips it, /hold pauses it.",
  },
  fail: {
    tone: "danger",
    icon: "✗",
    label: "fail",
    next: "Not paid automatically. The maintainer can /reject (bounty reopens) or /pay anyway.",
  },
  unsure: {
    tone: "pending",
    icon: "?",
    label: "unsure",
    next: "Claude can't decide alone: merging puts the bounty on hold until the maintainer runs /pay or /reject.",
  },
};

export interface EventMeta {
  label: string;
  tone: Tone;
}

/** One entry per F2 event type, so a new event fails the typecheck here. */
export const EVENT_META: Record<EventType, EventMeta> = {
  "bounty.created": { label: "Bounty posted", tone: "neutral" },
  "funding.paid": { label: "Funded", tone: "money" },
  "claim.created": { label: "Claimed", tone: "claim" },
  "claim.released": { label: "Claim released", tone: "neutral" },
  "claim.expired": { label: "Claim expired", tone: "pending" },
  "pr.linked": { label: "Pull request linked", tone: "claim" },
  "verify.done": { label: "Claude checked the criteria", tone: "agent" },
  "pr.merged": { label: "Merged", tone: "money" },
  "maintainer.pay": { label: "Maintainer approved payout", tone: "money" },
  "maintainer.hold": { label: "Maintainer put it on hold", tone: "pending" },
  "maintainer.reject": { label: "Maintainer rejected the PR", tone: "danger" },
  "bounty.cancelled": { label: "Cancelled", tone: "neutral" },
  "payout.started": { label: "Payout started", tone: "money" },
  "payout.succeeded": { label: "Paid", tone: "money-solid" },
  "payout.failed": { label: "Payout failed", tone: "danger" },
};

export const PAYOUT_STATUS_META: Record<PayoutStatus, { tone: Tone; label: string }> = {
  pending: { tone: "pending", label: "Pending" },
  processing: { tone: "money", label: "Processing" },
  succeeded: { tone: "money-solid", label: "Succeeded" },
  failed: { tone: "danger", label: "Failed" },
};

/** "@awa-ndiaye", but system actors stay plain. */
export function actorLabel(actor: string): string {
  return actor === "bitbounty" || actor === "bitnob" ? actor : `@${actor}`;
}

export type MilestoneKey = "funded" | "claimed" | "pr" | "verified" | "paid";

export interface Step {
  key: MilestoneKey;
  label: string;
  done: boolean;
  at: string | null;
  /** Who / what, e.g. "@awa-ndiaye" or "PR #34 by @awa-ndiaye". */
  detail: string | null;
}

/** Events that put a bounty back to "funded": claims and PRs before them no longer count. */
const RESETS: EventType[] = ["maintainer.reject", "claim.released", "claim.expired"];
const VERIFIED_OR_LATER: BountyDetail["status"][] = ["verified", "paying", "paid"];

/** U5 milestone tracker: Funded → Claimed → PR → Verified → Paid, each with when and who. */
export function progressSteps(b: BountyDetail): Step[] {
  const tl = b.timeline;
  const lastReset = tl.reduce((n, e, i) => (RESETS.includes(e.type) ? i : n), -1);
  const current = tl.slice(lastReset + 1);
  const lastOf = (events: typeof tl, type: EventType) => [...events].reverse().find((e) => e.type === type);
  const funded = lastOf(tl, "funding.paid");
  const claimed = lastOf(current, "claim.created");
  const pr = lastOf(current, "pr.linked");
  const verified = current.find((e) => VERIFIED_OR_LATER.includes(e.to));
  const paid = lastOf(current, "payout.succeeded");
  const sub = b.submission;
  const claimer = b.claims.find((c) => c.status === "active" || c.status === "done")?.userLogin ?? claimed?.actor;
  const at = (e: { occurredAt: string } | undefined) => e?.occurredAt ?? null;
  return [
    { key: "funded", label: "Funded", done: !!funded, at: at(funded), detail: funded ? `@${b.funderLogin}` : null },
    { key: "claimed", label: "Claimed", done: !!claimed, at: at(claimed), detail: claimed && claimer ? `@${claimer}` : null },
    {
      key: "pr",
      label: "PR",
      done: !!pr,
      at: at(pr),
      detail: pr && sub ? `PR #${sub.prNumber} by @${sub.authorLogin}` : null,
    },
    { key: "verified", label: "Verified", done: !!verified, at: at(verified), detail: verified ? "criteria met, merged" : null },
    {
      key: "paid",
      label: "Paid",
      done: !!paid,
      at: at(paid),
      detail: paid && b.payout ? `@${b.payout.userLogin} over Lightning` : null,
    },
  ];
}

/** Criteria met / total from Claude's report, or null when there's no report yet. */
export function criteriaScore(b: BountyDetail): { met: number; total: number } | null {
  const r = b.submission?.report;
  if (!r) return null;
  return { met: r.criteria.filter((c) => c.met).length, total: r.criteria.length };
}

/** Merge → paid in minutes, when both happened. */
export function mergeToPaidMinutes(b: BountyDetail): number | null {
  const merged = b.submission?.mergedAt;
  const paid = b.payout?.paidAt;
  return merged && paid ? minutesBetween(merged, paid) : null;
}

/** Was the last PR rejected by the maintainer (bounty back to funded)? */
export function wasRejected(b: BountyDetail): boolean {
  const last = [...b.timeline].reverse().find((e) => e.type === "maintainer.reject" || e.type === "pr.linked");
  return last?.type === "maintainer.reject";
}

/** Receipt rows in the order of the mockup (Kraken "sent" layout). */
export function receiptRows(r: Receipt): Array<{ key: string; label: string; value: string }> {
  return [
    { key: "for", label: "Pour", value: `${r.issueTitle} · PR #${r.prNumber}` },
    { key: "to", label: "Vers", value: payoutDestination(r) },
    ...(r.paidWith?.amountSats != null ? [{ key: "sats", label: "Envoyé", value: formatSatsAmount(r.paidWith.amountSats) }] : []),
    { key: "dev", label: "Développeur", value: `@${r.recipientLogin}` },
    { key: "merged", label: "Merge", value: formatDateTime(r.mergedAt, "fr") },
    { key: "paid", label: "Payé le", value: formatDateTime(r.paidAt, "fr") },
    { key: "speed", label: "Merge → payé", value: formatDuration(r.minutesMergeToPay) },
    {
      key: "funded",
      label: "Financé avec",
      value: `${formatSource(r.fundedWith.rail, r.fundedWith.sourceAmount)} · ${RAIL_LABEL[r.fundedWith.rail]} · @${r.fundedWith.funderLogin}`,
    },
  ];
}
