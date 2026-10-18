import { Card } from "../ui";
import { formatUsd, type ExternalBounty } from "./shape";

/** Bounties paid in dollars on other platforms, for contrast. */
export function ExternalList({ rows }: { rows: ExternalBounty[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-2.5">
      <div className="grid gap-0.5">
        <h2 className="text-lg font-extrabold">Paid in dollars elsewhere</h2>
        <p className="text-[13px] text-muted">Bounties on other platforms. Not paid by BitBounty.</p>
      </div>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <Card
            as="li"
            key={`${r.repoFullName}:${r.title}`}
            padding="none"
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3"
          >
            <div className="grid min-w-0 gap-1">
              <a href={r.url} className="text-sm font-semibold hover:underline" rel="noopener noreferrer" target="_blank">
                {r.title}
              </a>
              <span className="break-all text-xs text-muted">{r.repoFullName}</span>
            </div>
            <span className="font-display text-base font-extrabold tabular-nums text-muted">{formatUsd(r.amountUsdCents)}</span>
          </Card>
        ))}
      </ul>
    </div>
  );
}
