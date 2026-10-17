import type { HTMLAttributes, ReactNode } from "react";
import { cx, TONE_DOT, TONE_PILL, type Tone } from "./tone";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Show a leading coloured dot. */
  dot?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
}

/** Rounded label: tags, filters, status text. */
export function Pill({ tone = "neutral", dot = false, size = "md", className, children, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold leading-none",
        size === "sm" ? "px-2 py-1 text-[11.5px]" : "px-2.5 py-[5px] text-xs",
        TONE_PILL[tone],
        className,
      )}
      {...rest}
    >
      {dot && <Dot tone={tone} className={tone === "money-solid" ? "bg-on-solid" : undefined} />}
      {children}
    </span>
  );
}

export interface DotProps {
  tone?: Tone;
  /** Pulse animation, for live/in-flight states. */
  pulse?: boolean;
  className?: string;
}

export function Dot({ tone = "neutral", pulse = false, className }: DotProps) {
  return (
    <i
      aria-hidden
      className={cx("inline-block size-2 shrink-0 rounded-full", className ?? TONE_DOT[tone], pulse && "animate-pulse")}
    />
  );
}

export interface TagProps {
  children: ReactNode;
  className?: string;
}

/** Small square-ish tag for languages / labels on task cards (build kit `.tag`). */
export function Tag({ children, className }: TagProps) {
  return <span className={cx("rounded-md bg-chip px-[7px] py-0.5 text-[11.5px] text-muted", className)}>{children}</span>;
}
