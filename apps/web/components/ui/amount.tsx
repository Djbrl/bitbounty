import { cx } from "./tone";

const group = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** 62500 -> "62 500 F" (no-break spaces, readable like the landing; same output on server and client, no Intl drift). */
export function formatXof(amount: number): string {
  return `${group(amount)} F`;
}

/** 120000 -> "120 000 sats". */
export function formatSats(sats: number): string {
  return `${group(sats)} sats`;
}

/** Whole naira: 24500 -> "₦24 500". */
export function formatNgn(naira: number): string {
  return `₦${group(naira)}`;
}

/** Currency a user prefers to read amounts in (U1 settings). Payouts are always FCFA. */
export type DisplayCurrency = "xof" | "ngn" | "sats";

export interface AmountProps {
  /** Whole FCFA (always known: it is what the developer receives). */
  xof: number;
  /** Same amount in sats, when known. Shown small under FCFA, or big with currency="sats". */
  sats?: number;
  /** Same amount in whole naira, when known. Shown big with currency="ngn". */
  ngn?: number;
  /** Preferred currency. Falls back to FCFA when that value isn't passed. */
  currency?: DisplayCurrency;
  size?: "sm" | "md" | "lg" | "xl";
  /** Money green (landed money). */
  money?: boolean;
  className?: string;
}

const SIZE = {
  sm: "text-sm font-bold",
  md: "text-xl font-extrabold",
  lg: "text-[1.6rem] font-extrabold",
  xl: "text-[2.4rem] font-extrabold",
} as const;

const SUB_SIZE = { sm: "text-[10.5px]", md: "text-[11px]", lg: "text-xs", xl: "text-[13px]" } as const;

/**
 * Amount in the landing's `.money` style (Bricolage 800, tight, tabular): FCFA big, and the other known
 * currency small in mono underneath. With `currency`, the preferred currency goes big and FCFA small.
 */
export function Amount({ xof, sats, ngn, currency = "xof", size = "md", money = false, className }: AmountProps) {
  const lines: string[] = [formatXof(xof)];
  if (currency === "sats" && sats != null) lines.unshift(formatSats(sats));
  else if (currency === "ngn" && ngn != null) lines.unshift(formatNgn(ngn));
  else if (sats != null) lines.push(formatSats(sats));
  const [main, sub] = lines;
  const big = (
    <span className={cx("font-display leading-none tracking-[-0.03em] tabular-nums", SIZE[size], money && "text-money", !sub && className)}>
      {main}
    </span>
  );
  if (!sub) return big;
  return (
    <span className={cx("inline-grid gap-1", className)}>
      {big}
      <span className={cx("font-mono leading-none tracking-normal text-muted tabular-nums", SUB_SIZE[size])}>{sub}</span>
    </span>
  );
}
