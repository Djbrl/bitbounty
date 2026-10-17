import type { ReactNode } from "react";
import { cx } from "./tone";

export interface BrowserFrameProps {
  url: string;
  children: ReactNode;
  className?: string;
}

/** Browser chrome mockup (three dots + URL bar), for illustrations and the /dev page. */
export function BrowserFrame({ url, children, className }: BrowserFrameProps) {
  return (
    <div className={cx("min-w-0 overflow-hidden rounded-xl border border-rule bg-paper shadow-[0_10px_30px_rgb(0_0_0/0.08)]", className)}>
      <div className="flex items-center gap-2.5 border-b border-rule bg-chip px-3.5 py-2.5">
        <i className="size-[11px] shrink-0 rounded-full bg-rule" />
        <i className="size-[11px] shrink-0 rounded-full bg-rule" />
        <i className="size-[11px] shrink-0 rounded-full bg-rule" />
        <span className="min-w-0 flex-1 truncate rounded-md border border-rule bg-sheet px-2.5 py-1 font-mono text-xs text-muted">
          {url}
        </span>
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  );
}
