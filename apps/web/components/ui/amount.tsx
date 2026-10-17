import { cx } from "./tone";

const group = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** 62500 -> "62 500 F" (narrow no-break space; same output on server and client, no Intl drift). */
export function formatXof(amount: number): string {
  return `${group(amount)} F`;
}

/** 120000 -> "120 000 sats". */
export function formatSats(sats: number): string {
  return `${group(sats)} sats`;
}

export interface AmountProps {
  /** Whole FCFA. */
  xof: number;
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

/** FCFA amount in display font with tabular figures. */
export function Amount({ xof, size = "md", money = false, className }: AmountProps) {
  return (
    <span className={cx("font-display leading-none tabular-nums", SIZE[size], money && "text-money", className)}>
      {formatXof(xof)}
    </span>
  );
}
