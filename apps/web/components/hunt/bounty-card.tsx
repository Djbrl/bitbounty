// U3: one open bounty as a card (For you on /app/hunt, the grid on /explore). Server or client safe.
import Link from "next/link";
import { displayLabels } from "../board/shape";
import { Amount, Card, Tag } from "../ui";
import { bountyLanguages, timeAgo, type BountySummary } from "./explore";
import { huntText, type Lang } from "./text";

function StatusLine({ b, lang }: { b: BountySummary; lang: Lang }) {
  const t = huntText(lang);
  if (b.status === "funded") return <span className="text-xs font-semibold text-money">{t.open}</span>;
  if (b.status === "submitted") return <span className="text-xs text-claim">{t.inReview(b.prNumber)}</span>;
  return <span className="text-xs text-claim">{t.claimedBy(b.claimedBy)}</span>;
}

export function BountyCard({ b, lang, now }: { b: BountySummary; lang: Lang; now: number }) {
  const t = huntText(lang);
  const langs = bountyLanguages(b);
  return (
    <Card as="li" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <a href={b.issueUrl} className="min-w-0 truncate font-mono text-[12px] text-muted hover:text-ink">
          {b.repoFullName} #{b.issueNumber}
        </a>
        <Amount xof={b.amountXof} size="md" money={b.status === "funded"} className="shrink-0 text-right" />
      </div>
      <h3 className="text-[15px] font-semibold leading-snug">
        <Link href={`/b/${b.id}`} className="hover:underline">
          {b.issueTitle}
        </Link>
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {langs.map((l) => (
          <Tag key={l}>{l}</Tag>
        ))}
        {b.funderKind === "agent" ? <Tag className="font-semibold text-ink">
            <span aria-hidden>🤖</span> {t.byAgent}
          </Tag> : null}
        {displayLabels(b).map((l) => (
          <Tag key={l}>{l}</Tag>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-rule pt-2.5">
        <StatusLine b={b} lang={lang} />
        <span className="font-mono text-[11px] text-muted" suppressHydrationWarning>
          {timeAgo(b.createdAt, now, lang)}
        </span>
      </div>
    </Card>
  );
}
