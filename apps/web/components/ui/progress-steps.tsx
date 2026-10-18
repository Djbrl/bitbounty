import type { ReactNode } from "react";
import { cx } from "./tone";

export interface ProgressStep {
  label: ReactNode;
  done?: boolean;
  /** Small mono line next to the label (a date, "2 min"). */
  at?: ReactNode;
}

export interface ProgressStepsProps {
  steps: ProgressStep[];
  /** Index of the step in progress (outlined in green, aria-current="step"). */
  current?: number;
  /** Accessible name of the list. */
  label?: string;
  className?: string;
}

/**
 * Numbered steps joined by a short rail (landing story rail): ✓ when done, green ring on the current one.
 * Wraps on phones. Use for onboarding (1 · 2 · 3) and the bounty lifecycle.
 */
export function ProgressSteps({ steps, current, label = "Progress", className }: ProgressStepsProps) {
  return (
    <ol aria-label={label} className={cx("flex flex-wrap items-center gap-x-2 gap-y-2.5 text-[13px]", className)}>
      {steps.map((s, i) => {
        const done = !!s.done;
        const active = !done && i === current;
        return (
          <li
            key={i}
            data-done={done}
            aria-current={active ? "step" : undefined}
            className={cx("inline-flex items-center gap-1.5", !done && !active && "text-muted", active && "font-semibold")}
          >
            {i > 0 && <span aria-hidden className={cx("mr-0.5 h-0.5 w-5 rounded-full", done ? "bg-money" : "bg-rule")} />}
            <i
              aria-hidden
              className={cx(
                "grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10.5px] font-medium not-italic",
                done ? "bg-money text-on-solid" : active ? "border-2 border-money text-money" : "bg-chip text-muted",
              )}
            >
              {done ? "✓" : i + 1}
            </i>
            {s.label}
            {done && <span className="sr-only"> (done)</span>}
            {s.at && <span className="font-mono text-[11.5px] font-normal text-muted">{s.at}</span>}
          </li>
        );
      })}
    </ol>
  );
}
