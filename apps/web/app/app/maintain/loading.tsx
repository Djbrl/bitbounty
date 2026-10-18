// U4: skeleton of the maintainer home while the server answers (the shell stays in place).
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="grid gap-6">
      <span className="sr-only">Chargement…</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="h-8 w-48" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-48 rounded-[var(--radius-card)]" />
      ))}
    </div>
  );
}
