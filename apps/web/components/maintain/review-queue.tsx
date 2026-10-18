"use client";
// U4: the review queue. Pay / Hold ask for a confirmation, then call the server action, which runs
// the same path as `/pay` / `/hold` on GitHub.
import { useState, useTransition } from "react";
import type { Lang } from "../app-shell/mode";
import { Avatar, Button, Card, EmptyState, Pill, StatusPill, cx, formatXof, useToast, type Tone } from "../ui";
import { maintainText, type CiState, type Decision, type DecisionResult, type ReviewItem } from "./shape";

const CI_TONE: Record<CiState, Tone> = { success: "money", failure: "danger", pending: "pending", unknown: "neutral" };
const VERDICT_TONE = { pass: "money", fail: "danger", unsure: "amber" } as const;

export interface ReviewQueueProps {
  items: ReviewItem[];
  lang: Lang;
  decide: (bountyId: string, decision: Decision, note?: string) => Promise<DecisionResult>;
}

export function ReviewQueue({ items, lang, decide }: ReviewQueueProps) {
  const t = maintainText(lang);
  if (!items.length) {
    return (
      <EmptyState icon="✓" title={t.reviewEmpty}>
        {t.reviewEmptyBody}
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <ReviewCard key={item.bountyId} item={item} lang={lang} decide={decide} />
      ))}
    </ul>
  );
}

function Mark({ met }: { met: boolean | null }) {
  const cls = met === true ? "bg-money-soft text-money" : met === false ? "bg-danger-soft text-danger" : "bg-chip text-muted";
  return (
    <span aria-hidden className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold", cls)}>
      {met === true ? "✓" : met === false ? "✕" : "·"}
    </span>
  );
}

function ReviewCard({ item, lang, decide }: { item: ReviewItem; lang: Lang; decide: ReviewQueueProps["decide"] }) {
  const t = maintainText(lang);
  const toast = useToast();
  const [status, setStatus] = useState(item.status);
  const [asking, setAsking] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decided = status !== item.status;
  const met = item.criteria.filter((c) => c.met === true).length;
  const hasReport = item.criteria.some((c) => c.met !== null);
  const dev = item.developer ?? "?";

  const confirm = () => {
    if (!asking) return;
    const decision = asking;
    setError(null);
    start(async () => {
      const res = await decide(item.bountyId, decision, decision === "hold" ? note.trim() || undefined : undefined);
      if (res.ok) {
        setStatus(res.status);
        setAsking(null);
        toast({ tone: decision === "pay" ? "success" : "info", title: t.done[decision], children: `${item.repoFullName}#${item.issueNumber}` });
      } else {
        setError(t.errors[res.error] ?? t.errors.default!);
      }
    });
  };

  return (
    <Card as="li" padding="none" className="grid">
      <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} lang={lang} size="sm" />
            <span className="font-mono text-xs text-muted">
              {item.repoFullName}#{item.issueNumber}
            </span>
          </div>
          <a href={`/b/${encodeURIComponent(item.bountyId)}`} className="font-semibold leading-snug hover:underline">
            {item.issueTitle}
          </a>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-soft">
            {item.prNumber ? (
              <a href={item.prUrl ?? "#"} className="font-mono hover:underline" target="_blank" rel="noreferrer">
                PR #{item.prNumber}
              </a>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Avatar initials={dev.slice(0, 1).toUpperCase()} src={item.developer ? `https://github.com/${item.developer}.png?size=40` : null} size="sm" />
              <span>
                {t.by} <b className="font-semibold">@{dev}</b>
              </span>
            </span>
            <Pill tone={CI_TONE[item.ci]} size="sm" dot>
              {t.ci[item.ci]}
            </Pill>
            {item.verdict ? (
              <Pill tone={VERDICT_TONE[item.verdict]} size="sm">
                {t.verdict[item.verdict]}
              </Pill>
            ) : null}
            {item.merged ? (
              <Pill tone="outline" size="sm">
                {t.merged}
              </Pill>
            ) : null}
          </div>
        </div>
        <b className="font-display text-2xl font-extrabold tracking-[-0.03em] tabular-nums sm:text-right">{formatXof(item.amountXof)}</b>
      </div>

      <div className="grid gap-2 border-t border-rule px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.72rem] uppercase tracking-[0.08em] text-muted">{t.criteria}</span>
          {hasReport ? (
            <span className="font-mono text-xs text-muted">
              {met}/{item.criteria.length}
            </span>
          ) : null}
        </div>
        {item.summary ? <p className="text-sm text-ink-soft">{item.summary}</p> : null}
        {!hasReport ? <p className="text-sm text-muted">{t.noReport}</p> : null}
        <ul className="grid gap-1.5 text-sm">
          {item.criteria.map((c, i) => (
            <li key={i} className="flex gap-2">
              <Mark met={c.met} />
              <span className="min-w-0">
                {c.text}
                {c.evidence ? <span className="block font-mono text-xs text-muted [overflow-wrap:anywhere]">{c.evidence}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {!decided && (item.canPay || item.canHold) ? (
        <div className="grid gap-3 border-t border-rule bg-paper/60 px-4 py-3">
          {asking ? (
            <div className="grid gap-2" role="group" aria-label={asking === "pay" ? t.pay : t.hold}>
              <p className="text-sm font-semibold">{asking === "pay" ? t.confirmPay(formatXof(item.amountXof), dev) : t.confirmHold}</p>
              {asking === "hold" ? (
                <label className="grid gap-1 text-xs text-muted">
                  {t.holdNote}
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    className="rounded-xl border border-rule bg-sheet px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-money"
                  />
                </label>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {t.failed}: {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={asking === "pay" ? "primary" : "dark"} disabled={pending} onClick={confirm}>
                  {pending ? "…" : `${t.confirm} · ${asking === "pay" ? t.pay : t.hold}`}
                </Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => (setAsking(null), setError(null))}>
                  {t.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {item.canPay ? (
                <Button size="sm" onClick={() => setAsking("pay")}>
                  {t.pay} {formatXof(item.amountXof)}
                </Button>
              ) : null}
              {item.canHold ? (
                <Button size="sm" variant="secondary" onClick={() => setAsking("hold")}>
                  {t.hold}
                </Button>
              ) : null}
              <span className="text-xs text-muted">{t.sameAsGithub}</span>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
