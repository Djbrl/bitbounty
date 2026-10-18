"use client";
// U3: /explore as a card grid with filters (language, amount, repo, plus the header's search text).
import { useMemo, useState } from "react";
import { Button, Chip, EmptyState } from "../ui";
import { BountyCard } from "./bounty-card";
import { AMOUNT_BUCKETS, applyExplore, exploreOptions, NO_FILTER, type BountySummary, type ExploreFilter } from "./explore";
import { huntText, type Lang } from "./text";

const SELECT = "rounded-full border border-rule bg-sheet px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-money";

export function ExploreGrid({ bounties, lang, now, q = "" }: { bounties: BountySummary[]; lang: Lang; now: number; q?: string }) {
  const t = huntText(lang);
  const { languages, repos } = useMemo(() => exploreOptions(bounties), [bounties]);
  const [f, setF] = useState<ExploreFilter>({ ...NO_FILTER, q });
  const rows = applyExplore(bounties, f);
  const set = (patch: Partial<ExploreFilter>) => setF((cur) => ({ ...cur, ...patch }));

  return (
    <div className="grid min-w-0 content-start gap-4">
      <div className="grid gap-0.5">
        <h2 className="text-[1.6rem] font-extrabold tracking-tight">{t.paidIssues}</h2>
        <p className="text-[13px] text-muted">{t.paidIssuesSub}</p>
      </div>

      {bounties.length > 0 ? (
        <div role="group" aria-label={t.filters} className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="grid gap-1 text-[12px] text-muted">
              {t.language}
              <select className={SELECT} value={f.language} onChange={(e) => set({ language: e.target.value })}>
                <option value="all">{t.all}</option>
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[12px] text-muted">
              {t.repo}
              <select className={SELECT} value={f.repo} onChange={(e) => set({ repo: e.target.value })}>
                <option value="all">{t.all}</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 flex-1 gap-1 text-[12px] text-muted sm:max-w-64">
              {t.search}
              <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} className={SELECT} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label={t.amount} role="group">
            <span className="mr-1 text-[12px] text-muted">{t.amount}</span>
            {AMOUNT_BUCKETS.map((b) => (
              <Chip key={b} size="sm" selected={f.amount === b} onClick={() => set({ amount: b })}>
                {t.buckets[b]}
              </Chip>
            ))}
            <span className="ml-auto font-mono text-[12px] text-muted" aria-live="polite">
              {t.count(rows.length)}
            </span>
          </div>
        </div>
      ) : null}

      {bounties.length === 0 ? (
        <EmptyState title={t.noBounties} align="start">
          {t.noOpenBody}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t.noMatch}
          align="start"
          action={
            <Button variant="ghost" size="sm" onClick={() => setF(NO_FILTER)}>
              {t.reset(bounties.length)}
            </Button>
          }
        >
          {t.noMatchBody}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {rows.map((b) => (
            <BountyCard key={b.id} b={b} lang={lang} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
