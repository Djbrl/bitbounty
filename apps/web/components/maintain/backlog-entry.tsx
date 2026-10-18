"use client";
// U4: "Price my backlog" entry (A3). Runs POST /api/backlog/suggest for a repo through a server
// action and keeps the last result on this device, so the suggestions are still there next visit.
import { useEffect, useState, useTransition } from "react";
import type { BacklogSuggestion } from "../../../../fixtures/types";
import type { Lang } from "../app-shell/mode";
import { Button, Card, Pill, formatXof, type Tone } from "../ui";
import type { SuggestResult } from "./actions";
import { maintainText } from "./shape";

const STORE_KEY = "bb_backlog_last";
const CONF_TONE: Record<BacklogSuggestion["confidence"], Tone> = { high: "money", medium: "claim", low: "pending" };

interface Last {
  repo: string;
  at: string;
  suggestions: BacklogSuggestion[];
}

function readLast(): Last | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as Last) : null;
    return v && Array.isArray(v.suggestions) ? v : null;
  } catch {
    return null;
  }
}

export interface BacklogEntryProps {
  repos: string[];
  lang: Lang;
  suggest: (repo: string) => Promise<SuggestResult>;
}

export function BacklogEntry({ repos, lang, suggest }: BacklogEntryProps) {
  const t = maintainText(lang);
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [last, setLast] = useState<Last | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => setLast(readLast()), []);

  const run = () => {
    if (!repo) return;
    setError(false);
    start(async () => {
      const res = await suggest(repo);
      if (!res.ok) return setError(true);
      const next = { repo: res.repo, at: new Date().toISOString(), suggestions: res.suggestions.slice(0, 8) };
      setLast(next);
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        // Private mode: shown now, just not remembered.
      }
    });
  };

  return (
    <Card padding="lg" className="grid gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted">
          {t.repo}
          {repos.length ? (
            <select
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="rounded-xl border border-rule bg-sheet px-3 py-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-money"
            >
              {repos.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          ) : (
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
              className="rounded-xl border border-rule bg-sheet px-3 py-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-money"
            />
          )}
        </label>
        <Button type="submit" variant="dark" disabled={pending || !repo}>
          {pending ? t.backlogRunning : t.backlogRun}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t.backlogError}
        </p>
      ) : null}
      {last ? (
        <div className="grid gap-2">
          <span className="font-mono text-[0.72rem] uppercase tracking-[0.08em] text-muted">
            {t.backlogLast} · {last.repo}
          </span>
          {last.suggestions.length ? (
            <ul className="divide-y divide-rule rounded-[var(--radius-card)] border border-rule">
              {last.suggestions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <a
                    href={`https://github.com/${s.repoFullName}/issues/${s.issueNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid min-w-0 flex-1 gap-0.5 hover:underline"
                  >
                    <span className="truncate font-semibold">{s.issueTitle}</span>
                    <span className="font-mono text-xs text-muted">
                      #{s.issueNumber} · /bounty {s.priceXof}
                    </span>
                  </a>
                  <span className="flex items-center gap-2">
                    <Pill tone={CONF_TONE[s.confidence]} size="sm">
                      {s.criteria.length} ✓
                    </Pill>
                    <b className="font-display text-lg font-extrabold tabular-nums">{formatXof(s.priceXof)}</b>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t.backlogNone}</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
