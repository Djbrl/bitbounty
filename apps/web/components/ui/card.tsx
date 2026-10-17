import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./tone";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Thicker ink border, for the one card that matters on a row (build kit dashboard). */
  emphasis?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article" | "li";
}

const PAD = { none: "", sm: "p-3", md: "p-4", lg: "p-5" } as const;

/** White sheet with a hairline border and 12px radius. */
export function Card({ emphasis = false, padding = "md", as: Tag = "div", className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        "min-w-0 rounded-[var(--radius-card)] bg-sheet",
        emphasis ? "border-[1.5px] border-ink" : "border border-rule",
        PAD[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Colour the value in money green. */
  money?: boolean;
  emphasis?: boolean;
  className?: string;
}

/** Big number with a label and a sub-line ("Held for open bounties · 62 500 F"). */
export function StatCard({ label, value, sub, money = false, emphasis = false, className }: StatCardProps) {
  return (
    <Card emphasis={emphasis} className={cx("grid gap-0.5", className)}>
      <span className="text-xs text-muted">{label}</span>
      <b className={cx("font-display text-[1.6rem] font-extrabold leading-tight tabular-nums", money && "text-money")}>
        {value}
      </b>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Card>
  );
}

export interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

/** Small mono uppercase label above a heading. */
export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <span className={cx("font-mono text-[0.74rem] font-medium uppercase tracking-[0.08em] text-muted", className)}>
      {children}
    </span>
  );
}
