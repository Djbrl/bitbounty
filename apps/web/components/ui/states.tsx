// I1: what every page shows while the server answers, and when it doesn't.
import type { ReactNode } from "react";
import { Card } from "./card";

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 pt-6 sm:px-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="h-10 w-48 animate-pulse rounded-lg bg-neutral-200/70 dark:bg-neutral-800" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-neutral-200/70 dark:bg-neutral-800" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-neutral-200/70 dark:bg-neutral-800" />
      <p className="text-sm text-neutral-500">{label}</p>
    </div>
  );
}

export function ErrorState({ title = "Impossible de charger la page", message, action }: { title?: string; message: string; action?: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 px-4 pt-16 sm:px-6" role="alert">
      <Card emphasis>
        <div className="grid gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-neutral-600 dark:text-neutral-300">{message}</p>
          {action}
        </div>
      </Card>
    </div>
  );
}
