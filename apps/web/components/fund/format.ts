// Pure formatting / shaping helpers for the fund page (no Intl: same output on server and client).
import { formatSats, formatXof } from "../ui";
import type { FundingRail, FundingSession } from "./data";

const group = (n: number, sep = " ") =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/** 19220000 base units → "19.22 USDT" (1 USDT = 1 000 000 units, shown to the cent). */
export function formatUsdt(units: number): string {
  const cents = Math.ceil(units / 10_000);
  return `${group(Math.floor(cents / 100), ",")}.${String(cents % 100).padStart(2, "0")} USDT`;
}

/** 2900000 kobo → "₦29,000". */
export function formatNaira(kobo: number): string {
  return `₦${group(Math.round(kobo / 100), ",")}`;
}

/** "9930481276" → "993 048 1276" (easier to read out, copy keeps the raw digits). */
export function groupAccountNumber(n: string): string {
  return n.length === 10 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n;
}

/** Milliseconds left before `expiresAt`, never negative. */
export function msLeft(expiresAt: string, now: number): number {
  return Math.max(0, new Date(expiresAt).getTime() - now);
}

/** 861000 → "14:21". */
export function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Amount the funder sends, in the rail's own currency. */
export function sourceAmount(s: FundingSession): string {
  if (s.rail === "lightning") return formatSats(s.amountSats);
  if (s.rail === "usdt") return formatUsdt(s.amountUsdtUnits);
  return formatNaira(s.amountKobo);
}

/** What the funder copies as "the amount" (plain number, no unit). */
export function sourceAmountRaw(s: FundingSession): string {
  if (s.rail === "lightning") return String(s.amountSats);
  if (s.rail === "usdt") return (Math.ceil(s.amountUsdtUnits / 10_000) / 100).toFixed(2);
  return String(Math.round(s.amountKobo / 100));
}

export interface RailMeta {
  rail: FundingRail;
  label: string;
  hint: string;
}

export const RAIL_META: RailMeta[] = [
  { rail: "lightning", label: "⚡ Lightning", hint: "Strike, Phoenix, Cash App…" },
  { rail: "usdt", label: "USDT", hint: "Tron, Ethereum, BSC" },
  { rail: "ngn", label: "Bank transfer", hint: "Nigeria · NGN" },
];

export interface SummaryLine {
  label: string;
  value: string;
}

/** Summary card lines (fee breakdown + total in FCFA and sats). `sats` = last known Lightning amount. */
export function summaryLines(s: FundingSession | null, sats: number | null): { lines: SummaryLine[]; total: string } {
  const dash = "—";
  const lines: SummaryLine[] = [
    { label: "Developer receives", value: s ? formatXof(s.amountXof) : dash },
    { label: "BitBounty fee 5%", value: s ? formatXof(s.feeXof) : dash },
    { label: "FX buffer 3% · unused part refunded", value: s ? formatXof(s.bufferXof) : dash },
  ];
  const parts = [s ? formatXof(s.totalXof) : dash];
  if (sats != null) parts.push(formatSats(sats));
  if (s && s.rail !== "lightning") parts.push(sourceAmount(s));
  return { lines, total: parts.join(" · ") };
}
