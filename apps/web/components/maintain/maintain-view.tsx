// U4: the maintainer home. Money summary, the review queue (main block), repos, "Price my backlog",
// payouts and agents. Section ids match the shell's sidebar anchors (#review #repos #payouts #backlog).
import Link from "next/link";
import type { Lang } from "../app-shell/mode";
import { INSTALL_URL } from "../app-shell/mode";
import { Card, EmptyState, Pill, Section, StatCard, buttonClass, formatSats, formatXof, type Tone } from "../ui";
import type { SuggestResult } from "./actions";
import { BacklogEntry } from "./backlog-entry";
import { ReviewQueue, type ReviewQueueProps } from "./review-queue";
import { formatMinutes, isEmptyHome, maintainText, type MaintainHome, type MaintainPayout } from "./shape";

const PAYOUT_TONE: Record<MaintainPayout["status"], Tone> = { paying: "bright", paid: "money", failed: "danger" };

export interface MaintainViewProps {
  data: MaintainHome;
  lang: Lang;
  decide: ReviewQueueProps["decide"];
  suggest: (repo: string) => Promise<SuggestResult>;
}

export function MaintainView({ data, lang, decide, suggest }: MaintainViewProps) {
  const t = maintainText(lang);
  const install = (
    <a href={INSTALL_URL} className={buttonClass({ variant: "secondary", size: "sm" })}>
      {t.installMore} ↗
    </a>
  );

  if (isEmptyHome(data)) {
    return (
      <>
        <h1 className="sr-only">{t.title}</h1>
        <EmptyState
          icon="🛠"
          title={t.emptyTitle}
          action={
            <a href={INSTALL_URL} className={buttonClass({ variant: "dark" })}>
              {t.install}
            </a>
          }
        >
          {t.emptyBody}
        </EmptyState>
        <Section id="backlog" title={t.backlog} description={t.backlogDesc}>
          <BacklogEntry repos={[]} lang={lang} suggest={suggest} />
        </Section>
      </>
    );
  }

  const s = data.summary;
  return (
    <>
      <h1 className="sr-only">{t.title}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard emphasis label={t.funded} value={formatXof(s.fundedXof)} sub={t.fundedSub(s.fundedSats !== null ? formatSats(s.fundedSats) : null)} />
        <StatCard label={t.atStake} value={formatXof(s.atStakeXof)} sub={t.atStakeSub} />
        <StatCard money label={t.paidMonth} value={formatXof(s.paidThisMonthXof)} sub={t.paidMonthSub(s.paidThisMonthCount)} />
        <StatCard label={t.median} value={formatMinutes(s.medianMinutesMergeToPay, lang)} sub={t.medianSub} />
      </div>

      <Section
        id="review"
        title={
          <span className="inline-flex items-center gap-2">
            {t.review}
            {data.queue.length ? (
              <Pill tone="amber" size="sm">
                {data.queue.length}
              </Pill>
            ) : null}
          </span>
        }
        description={t.reviewDesc}
      >
        <ReviewQueue items={data.queue} lang={lang} decide={decide} />
      </Section>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-6">
        <Section id="repos" title={t.repos} actions={install}>
          {data.repos.length ? (
            <Card padding="none">
              <ul className="divide-y divide-rule text-sm">
                {data.repos.map((r) => (
                  <li key={r.fullName} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <a href={`https://github.com/${r.fullName}`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono hover:underline">
                      {r.fullName}
                    </a>
                    <span className="flex items-center gap-2">
                      <Pill tone={r.openBounties ? "claim" : "neutral"} size="sm">
                        {t.openBounties(r.openBounties)}
                      </Pill>
                      <span className="text-xs text-muted">{t.paidCount(r.paidCount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <EmptyState title={t.emptyTitle}>{t.emptyBody}</EmptyState>
          )}
        </Section>

        <Section id="backlog" title={t.backlog} description={t.backlogDesc}>
          <BacklogEntry repos={data.repos.map((r) => r.fullName)} lang={lang} suggest={suggest} />
        </Section>
      </div>

      <Section id="payouts" title={t.payouts}>
        {data.payouts.length ? (
          <Card padding="none">
            <ul className="divide-y divide-rule text-sm">
              {data.payouts.map((p) => (
                <li key={p.bountyId} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <div className="grid min-w-0 gap-0.5">
                    <Link href={`/b/${encodeURIComponent(p.bountyId)}`} className="truncate font-semibold hover:underline">
                      {p.issueTitle}
                    </Link>
                    <span className="font-mono text-xs text-muted">
                      {p.repoFullName}#{p.issueNumber}
                      {p.developer ? ` · @${p.developer}` : ""}
                    </span>
                    {p.status === "failed" ? <span className="text-xs text-danger">{t.reasons[p.reason ?? "other"]}</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Pill tone={PAYOUT_TONE[p.status]} size="sm" dot>
                      {t.payoutStatus[p.status]}
                    </Pill>
                    <span className="grid text-right">
                      <b className="font-display font-extrabold tabular-nums">{formatXof(p.amountXof)}</b>
                      {p.amountSats !== null ? <span className="font-mono text-[11px] text-muted">{formatSats(p.amountSats)}</span> : null}
                    </span>
                    {p.receiptId ? (
                      <Link href={`/r/${encodeURIComponent(p.receiptId)}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                        {t.receipt}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title={t.payoutsEmpty}>{t.payoutsEmptyBody}</EmptyState>
        )}
      </Section>

      {data.agents.length ? (
        <Section id="agents" title={t.agents} description={t.agentsDesc}>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.agents.map((a) => {
              const pct = a.monthlyBudgetXof ? Math.min(100, Math.round((a.committedThisMonthXof / a.monthlyBudgetXof) * 100)) : 0;
              return (
                <Card key={a.name} className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <b className="font-mono text-sm">{a.name}</b>
                    <Pill tone="agent" size="sm">
                      {formatXof(a.remainingXof)} {t.left}
                    </Pill>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-chip" role="img" aria-label={`${pct}%`}>
                    <div className="h-full rounded-full bg-agent" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted">
                    {t.budget} {formatXof(a.monthlyBudgetXof)} · {t.perTask} {formatXof(a.perTaskMaxXof)}
                  </span>
                  {a.allowedRepos.length ? <span className="truncate font-mono text-xs text-muted">{a.allowedRepos.join(", ")}</span> : null}
                </Card>
              );
            })}
          </div>
        </Section>
      ) : null}
    </>
  );
}
