// I1: what every page shows while the server answers, and when it doesn't. U0: EmptyState and Skeleton.
import type { ReactNode } from "react";
import { Card } from "./card";
import { cx } from "./tone";

export interface SkeletonProps {
  /** Size and shape, e.g. "h-6 w-40" or "size-10 rounded-full". */
  className?: string;
}

/** Pulsing placeholder block in the hairline colour (static when the user prefers reduced motion). */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-rule motion-reduce:animate-none", className)} />;
}

export interface EmptyStateProps {
  title: ReactNode;
  /** One or two sentences: why it's empty and what happens next. */
  children?: ReactNode;
  /** A button or link to get out of the empty state. */
  action?: ReactNode;
  /** Emoji or small icon shown in a round chip above the title. */
  icon?: ReactNode;
  align?: "start" | "center";
  className?: string;
}

/** Dashed "nothing here yet" box. */
export function EmptyState({ title, children, action, icon, align = "center", className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "grid gap-1.5 rounded-[var(--radius-card)] border border-dashed border-rule bg-sheet px-5 py-7",
        align === "center" ? "justify-items-center text-center" : "justify-items-start",
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="mb-1 grid size-10 place-items-center rounded-full bg-chip text-lg">
          {icon}
        </span>
      )}
      <b className="font-semibold">{title}</b>
      {children && <div className="max-w-[56ch] text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 pt-6 sm:px-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-10 w-48" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export function ErrorState({ title = "Impossible de charger la page", message, action }: { title?: string; message: string; action?: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 px-4 pt-16 sm:px-6" role="alert">
      <Card emphasis>
        <div className="grid gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-ink-soft">{message}</p>
          {action}
        </div>
      </Card>
    </div>
  );
}
