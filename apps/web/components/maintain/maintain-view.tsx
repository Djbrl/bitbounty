// U4: the maintainer home, focused on what to do now: "Price my backlog" (hero) then the funded PRs
// that need a decision (Pay / Hold). Repos, payouts and stats/agents live on their own pages
// (/app/maintain/repos, /payouts, /stats), linked with "Voir tout ›". Ids back the sidebar anchors.
import type { ReactNode } from "react";
import type { Lang } from "../app-shell/mode";
import { INSTALL_URL } from "../app-shell/mode";
import { Card, EmptyState, Pill, Section, buttonClass, formatXof } from "../ui";
import type { SuggestResult } from "./actions";
import { BacklogEntry } from "./backlog-entry";
import { ReviewQueue, type ReviewQueueProps } from "./review-queue";
import { MAINTAIN_SECTIONS, SeeAll } from "./sections";
import { isEmptyHome, maintainText, type MaintainHome } from "./shape";

/** "Price my backlog" as the page hero: the first thing a maintainer does. */
function BacklogHero({ lang, repos, suggest, kicker }: { lang: Lang; repos: string[]; suggest: MaintainViewProps["suggest"]; kicker: string }) {
  const t = maintainText(lang);
  return (
    <div data-tour="price-backlog" className="grid gap-4 rounded-[var(--radius-card)] border-2 border-money/40 bg-money-soft/40 p-4 sm:p-6">
      <Section
        id="backlog"
        title={
          <span className="grid gap-1">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-money">{kicker}</span>
            {t.backlog}
          </span>
        }
        description={t.backlogDesc}
      >
        <BacklogEntry repos={repos} lang={lang} suggest={suggest} />
      </Section>
    </div>
  );
}

function Elsewhere({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <nav aria-label={maintainText(lang).elsewhere} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-4 text-sm text-muted">
      <span>{maintainText(lang).elsewhere}</span>
      {children}
    </nav>
  );
}

export interface MaintainViewProps {
  data: MaintainHome;
  lang: Lang;
  decide: ReviewQueueProps["decide"];
  suggest: (repo: string) => Promise<SuggestResult>;
}

export function MaintainView({ data, lang, decide, suggest }: MaintainViewProps) {
  const t = maintainText(lang);

  if (isEmptyHome(data)) {
    return (
      <>
        <h1 className="sr-only">{t.title}</h1>
        <BacklogHero lang={lang} repos={[]} suggest={suggest} kicker={t.heroKicker} />
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
      </>
    );
  }

  const s = data.summary;
  const nothingFunded = s.fundedXof === 0 && !data.queue.length;
  return (
    <>
      <h1 className="sr-only">{t.title}</h1>
      <BacklogHero
        lang={lang}
        repos={data.repos.map((r) => r.fullName)}
        suggest={suggest}
        kicker={nothingFunded ? t.heroKicker : t.heroKickerNext}
      />

      <div data-tour="funded-prs" className="grid">
      <Section
        id="review"
        title={
          <span className="inline-flex items-center gap-2">
            {t.reviewHome}
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
      </div>

      <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {t.funded} <b className="font-display font-extrabold text-ink tabular-nums">{formatXof(s.fundedXof)}</b> · {t.atStake}{" "}
          <b className="font-display font-extrabold text-ink tabular-nums">{formatXof(s.atStakeXof)}</b>
        </span>
        <SeeAll href={MAINTAIN_SECTIONS.stats} lang={lang} label={t.stats} />
      </Card>

      <Elsewhere lang={lang}>
        <SeeAll href={MAINTAIN_SECTIONS.repos} lang={lang} label={`${t.repos} (${data.repos.length})`} />
        <SeeAll href={MAINTAIN_SECTIONS.payouts} lang={lang} label={`${t.payouts} (${data.payouts.length})`} />
        <a href={INSTALL_URL} className={buttonClass({ variant: "secondary", size: "sm" })}>
          {t.installMore} ↗
        </a>
      </Elsewhere>
    </>
  );
}
