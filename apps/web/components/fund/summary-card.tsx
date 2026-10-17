import { Card } from "../ui";
import type { FundBounty, FundingSession } from "./data";
import { summaryLines } from "./format";

export interface SummaryCardProps {
  bounty: FundBounty;
  session: FundingSession | null;
  sats: number | null;
}

/** Right column: what you're paying for, fee breakdown, total in FCFA and sats, trust lines. */
export function SummaryCard({ bounty, session, sats }: SummaryCardProps) {
  const { lines, total } = summaryLines(session, sats);
  return (
    <Card as="section" padding="lg" className="grid gap-3" aria-label="Order summary">
      <span className="break-words font-mono text-xs uppercase text-muted">
        {bounty.repoFullName} #{bounty.issueNumber}
      </span>
      <b className="text-[15px] leading-snug">{bounty.issueTitle}</b>
      <dl className="grid gap-3">
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3 text-sm">
            <dt className="min-w-0">{l.label}</dt>
            <dd className="shrink-0 tabular-nums">{l.value}</dd>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-rule pt-2.5 text-base font-bold">
          <dt>You pay</dt>
          <dd className="tabular-nums" data-testid="summary-total">
            {total}
          </dd>
        </div>
      </dl>
      <ul className="grid gap-1.5 text-[12.5px] text-muted">
        <li className="flex gap-2">
          <span aria-hidden>🔒</span>Held by Bitnob until a merge is verified.
        </li>
        <li className="flex gap-2">
          <span aria-hidden>↩︎</span>Refunded if nobody claims or the issue is closed.
        </li>
        <li className="flex gap-2">
          <span aria-hidden>🧾</span>Every payment and payout gets a public reference.
        </li>
      </ul>
    </Card>
  );
}
