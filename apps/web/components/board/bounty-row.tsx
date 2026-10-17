import Link from "next/link";
import { Amount, Card, statusMeta, Tag } from "../ui";
import { displayLabels, type BountySummary } from "./shape";

function StatusLine({ b }: { b: BountySummary }) {
  if (b.status === "funded") return <span className="text-xs text-muted">Open to claim</span>;
  if (b.status === "claimed")
    return <span className="text-xs text-claim">🔒 Claimed{b.claimedBy ? ` by @${b.claimedBy}` : ""}</span>;
  if (b.status === "submitted")
    return <span className="text-xs text-claim">PR{b.prNumber ? ` #${b.prNumber}` : ""} in review</span>;
  const m = statusMeta(b.status);
  return <span className={m.tone === "pending" ? "text-xs text-pending" : "text-xs text-money"}>{m.label}</span>;
}

/** One funded issue (build kit `.task`). */
export function BountyRow({ b }: { b: BountySummary }) {
  return (
    <Card as="li" padding="none" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 px-4 py-3.5">
      <div className="grid min-w-0 gap-1.5">
        <h3 className="text-[15px] font-semibold leading-snug">
          <Link href={`/b/${b.id}`} className="hover:underline">
            {b.issueTitle}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
          <a href={b.issueUrl} className="break-all hover:text-ink">
            {b.repoFullName} #{b.issueNumber}
          </a>
          <span className="inline-flex items-center gap-1 font-semibold text-money">✓ Funded</span>
          {b.funderKind === "agent" && <Tag className="bg-agent-soft text-agent">🤖 funded by an agent</Tag>}
          {displayLabels(b).map((l) => (
            <Tag key={l}>{l}</Tag>
          ))}
        </div>
      </div>
      <div className="grid content-start justify-items-end gap-1 text-right">
        <Amount xof={b.amountXof} size="md" />
        <StatusLine b={b} />
      </div>
    </Card>
  );
}
