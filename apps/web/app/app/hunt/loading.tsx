import { Skeleton } from "@/components/ui";

/** U3: hunter home placeholder while /api/me, the profile and the board answer. */
export default function HuntLoading() {
  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true">
      <div className="grid gap-6">
        <Skeleton className="h-64 rounded-[var(--radius-card-lg)]" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-[var(--radius-card)]" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-36 rounded-[var(--radius-card)]" />
          <Skeleton className="h-36 rounded-[var(--radius-card)]" />
        </div>
      </div>
      <Skeleton className="h-80 rounded-[var(--radius-card)]" />
    </div>
  );
}
