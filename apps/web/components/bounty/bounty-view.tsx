import Link from "next/link";
import type { ReactNode } from "react";
import { formatXof, Amount } from "../ui/amount";
import { buttonClass } from "../ui/button";
import { Card, Eyebrow } from "../ui/card";
import { Pill, Tag } from "../ui/pill";
import { ProgressSteps } from "../ui/progress-steps";
import { STATUS_META } from "../ui/status";
import { StatusPill } from "../ui/status-pill";
import { cx, TONE_DOT } from "../ui/tone";
import type { BountyDetail } from "./data";
import {
  actorLabel,
  criteriaScore,
  EVENT_META,
  formatDateTime,
  formatDuration,
  formatSource,
  mergeToPaidMinutes,
  PAYOUT_STATUS_META,
  formatSatsAmount,
  payoutDestination,
  progressSteps,
  RAIL_LABEL,
  VERDICT_META,
  wasRejected,
} from "./shape";

export const BOUNTY_NAV = {
  items: [
    { href: "/", label: "Board" },
    { href: "/live", label: "Live" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/me", label: "My payouts" },
  ],
};

const ext = { target: "_blank", rel: "noreferrer" } as const;
const link = "font-semibold text-claim hover:underline";

function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-rule py-2 text-sm first:border-t-0">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-bold">{children}</h2>
      {right}
    </div>
  );
}

/** Header: mirrors the bot's status comment (amount + status pill + mini progress). */
export function BountyHeader({ b }: { b: BountyDetail }) {
  const steps = progressSteps(b);
  return (
    <Card padding="lg" className="grid gap-4">
      <div className="grid gap-1.5">
        <Eyebrow>
          <a href={b.issueUrl} {...ext} className="hover:text-ink hover:underline">
            {b.repoFullName} #{b.issueNumber}
          </a>
        </Eyebrow>
        <h1 className="text-[clamp(1.5rem,4vw,2.2rem)] font-extrabold leading-tight tracking-tight">{b.issueTitle}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Amount xof={b.amountXof} size="xl" money={b.status === "paid"} />
        <StatusPill status={b.status} />
        {b.funderKind === "agent" ? (
          <Pill tone="agent" dot>
            Funded by an AI agent · @{b.funderLogin}
          </Pill>
        ) : (
          <span className="text-sm text-muted">posted by @{b.funderLogin}</span>
        )}
      </div>
      {b.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {b.labels.map((l) => (
            <Tag key={l}>{l}</Tag>
          ))}
        </div>
      )}
      <ProgressSteps steps={steps.map((s) => ({ ...s, at: s.at && formatDateTime(s.at) }))} />
      <p className="text-sm text-muted">{STATUS_META[b.status].hint}</p>
    </Card>
  );
}

export function CriteriaCard({ b }: { b: BountyDetail }) {
  return (
    <Card padding="lg">
      <CardTitle
        right={
          b.criteria.length === 0 ? (
            <Pill tone="neutral" size="sm">
              From the issue
            </Pill>
          ) : b.criteriaConfirmed ? (
            <Pill tone="money" size="sm">
              Confirmed by the maintainer
            </Pill>
          ) : (
            <Pill tone="pending" size="sm">
              Claude draft · waiting for /criteria ok
            </Pill>
          )
        }
      >
        Acceptance criteria
      </CardTitle>
      {b.criteria.length === 0 && (
        <p className="text-[15px] text-muted">
          The issue&apos;s <strong>Done when</strong> list on{" "}
          <a className="underline" href={b.issueUrl}>
            GitHub
          </a>
          . Claude checks the PR against it.
        </p>
      )}
      <ul className="grid gap-2">
        {b.criteria.map((c, i) => (
          <li key={i} className="flex gap-2.5 text-[15px]">
            <span aria-hidden className="text-muted">
              ☐
            </span>
            <span className="min-w-0 break-words">{c.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Claude's verdict: the GitHub Check Run, per-criterion evidence. */
export function VerdictCard({ b }: { b: BountyDetail }) {
  const s = b.submission;
  if (!s) {
    return (
      <Card padding="lg">
        <CardTitle>Claude verification</CardTitle>
        <p className="text-sm text-muted">
          No pull request yet. When one says <code className="font-mono">Fixes #{b.issueNumber}</code>, Claude checks it
          against each criterion and posts a GitHub Check Run.
        </p>
      </Card>
    );
  }
  const r = s.report;
  const score = criteriaScore(b);
  const v = s.verdict ? VERDICT_META[s.verdict] : null;
  return (
    <Card padding="lg" data-verdict={s.verdict ?? "pending"} className="grid gap-3">
      <CardTitle
        right={
          v ? (
            <Pill tone={v.tone} dot>
              Verdict: {v.label}
            </Pill>
          ) : (
            <Pill tone="claim" dot>
              Checking…
            </Pill>
          )
        }
      >
        Claude verification
      </CardTitle>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <a href={s.prUrl} {...ext} className={link}>
          PR #{s.prNumber}
        </a>
        <span className="text-muted">by @{s.authorLogin}</span>
        <span className="font-mono text-xs text-muted">{s.headSha.slice(0, 7)}</span>
        <Pill size="sm" tone={s.ci === "success" ? "money" : s.ci === "failure" ? "danger" : "pending"}>
          CI {s.ci}
        </Pill>
        {score && (
          <span>
            <b>
              {score.met}/{score.total}
            </b>{" "}
            criteria met
          </span>
        )}
        {s.spamScore !== null && <span className="text-muted">spam score {s.spamScore}</span>}
      </div>
      {r && (
        <ul className="grid gap-2 rounded-lg border border-rule bg-paper p-3">
          {r.criteria.map((c, i) => (
            <li key={i} data-met={c.met} className="grid grid-cols-[18px_1fr] gap-2 text-sm">
              <span aria-label={c.met ? "met" : "not met"} className={cx("font-bold", c.met ? "text-money" : "text-danger")}>
                {c.met ? "✓" : "✗"}
              </span>
              <span className="min-w-0">
                <b className="font-semibold">{c.text}</b>
                <code className="mt-0.5 block font-mono text-[12px] break-words text-muted">{c.evidence}</code>
              </span>
            </li>
          ))}
        </ul>
      )}
      {r && <p className="text-sm">{r.summary}</p>}
      {r && r.riskFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.riskFlags.map((f) => (
            <Pill key={f} tone="pending" size="sm">
              ⚠ {f}
            </Pill>
          ))}
        </div>
      )}
      {wasRejected(b) ? (
        <p className="text-sm text-muted">The maintainer rejected this PR with /reject. The bounty is open again.</p>
      ) : (
        v && <p className="text-sm text-muted">{v.next}</p>
      )}
    </Card>
  );
}

/** Vertical timeline of every applied event, newest last. */
export function Timeline({ b }: { b: BountyDetail }) {
  return (
    <Card padding="lg">
      <CardTitle>Timeline</CardTitle>
      <ol className="grid">
        {b.timeline.map((e, i) => {
          const m = EVENT_META[e.type];
          const lastItem = i === b.timeline.length - 1;
          return (
            <li key={i} data-event={e.type} className="relative grid grid-cols-[20px_1fr] gap-3 pb-5 last:pb-0">
              {!lastItem && <span aria-hidden className="absolute left-[9px] top-5 bottom-0 w-px bg-rule" />}
              <span aria-hidden className="relative mt-1 grid size-5 place-items-center rounded-full bg-sheet">
                <i className={cx("size-2.5 rounded-full", TONE_DOT[m.tone])} />
              </span>
              <div className="grid min-w-0 gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="text-[15px]">{m.label}</b>
                  <StatusPill status={e.to} size="sm" />
                </div>
                <p className="text-sm break-words">{e.text}</p>
                <span className="font-mono text-[11.5px] text-muted">
                  {formatDateTime(e.occurredAt)} · {actorLabel(e.actor)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function PayoutCard({ b, receiptId }: { b: BountyDetail; receiptId: string | null }) {
  const p = b.payout;
  if (!p) {
    const closed = b.status === "refunded" || b.status === "cancelled";
    return (
      <Card padding="lg">
        <CardTitle>Payout</CardTitle>
        <p className="text-sm text-muted">
          {closed
            ? b.status === "refunded"
              ? "Closed without a payout. The money went back to the funder."
              : "Cancelled before funding. Nothing to pay."
            : `${formatXof(b.amountXof)} goes to the developer's Lightning Address, paid in sats, within minutes of the merge.`}
        </p>
      </Card>
    );
  }
  const st = PAYOUT_STATUS_META[p.status];
  const mins = mergeToPaidMinutes(b);
  return (
    <Card padding="lg" emphasis={p.status === "succeeded"}>
      <CardTitle
        right={
          <Pill tone={st.tone} dot>
            {st.label}
          </Pill>
        }
      >
        Payout
      </CardTitle>
      <Amount xof={p.amountXof} size="lg" money={p.status === "succeeded"} />
      <div className="mt-3">
        <KV k="To">@{p.userLogin}</KV>
        <KV k="On">
          {p.lightningAddress ? (
            <>
              Lightning <span className="font-mono text-[13px]">{p.lightningAddress}</span>
            </>
          ) : (
            payoutDestination(p)
          )}
        </KV>
        {p.amountSats != null && <KV k="Sats">{formatSatsAmount(p.amountSats)}</KV>}
        {p.paidAt && <KV k="Paid">{formatDateTime(p.paidAt)}</KV>}
        {mins !== null && (
          <KV k="Merge → paid">
            <b className="text-money">{formatDuration(mins)}</b>
          </KV>
        )}
        <KV k="Attempts">{p.attempts}</KV>
        {p.bitnobPayoutId && (
          <KV k="Bitnob ref">
            <span className="font-mono text-[12px]">{p.bitnobPayoutId}</span>
          </KV>
        )}
      </div>
      {p.lastError && (
        <p className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {p.lastError}. The money stays reserved for @{p.userLogin}.
        </p>
      )}
      {receiptId && (
        <Link href={`/r/${receiptId}`} className={buttonClass({ block: true, className: "mt-4" })}>
          View receipt
        </Link>
      )}
    </Card>
  );
}

export function FundingCard({ b }: { b: BountyDetail }) {
  return (
    <Card padding="lg">
      <CardTitle>Funding</CardTitle>
      {b.fundings.length === 0 ? (
        <>
          <p className="text-sm text-muted">Not funded yet.</p>
          {b.status === "unfunded" && (
            <Link href={`/pay/${b.id}`} className={buttonClass({ block: true, className: "mt-4" })}>
              Fund this bounty →
            </Link>
          )}
        </>
      ) : (
        b.fundings.map((f) => (
          <div key={f.id}>
            <KV k="Rail">{RAIL_LABEL[f.rail]}</KV>
            <KV k="Amount">{formatSource(f.rail, f.sourceAmount)}</KV>
            <KV k="Fee + buffer">
              {formatXof(f.feeXof)} + {formatXof(f.bufferXof)}
            </KV>
            <KV k="Status">{f.paidAt ? `Paid ${formatDateTime(f.paidAt)}` : f.status}</KV>
          </div>
        ))
      )}
    </Card>
  );
}

export function ClaimsCard({ b }: { b: BountyDetail }) {
  if (b.claims.length === 0) return null;
  const tone = { active: "claim", done: "money", released: "neutral", expired: "pending" } as const;
  return (
    <Card padding="lg">
      <CardTitle>Claims</CardTitle>
      <ul className="grid gap-2">
        {b.claims.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>@{c.userLogin}</span>
            <span className="flex items-center gap-2">
              {c.status === "active" && <span className="font-mono text-[11.5px] text-muted">until {formatDateTime(c.expiresAt)}</span>}
              <Pill size="sm" tone={tone[c.status]}>
                {c.status}
              </Pill>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Whole /b/[id] body. */
export function BountyView({ b, receiptId }: { b: BountyDetail; receiptId: string | null }) {
  return (
    <div className="grid gap-6">
      <BountyHeader b={b} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <CriteriaCard b={b} />
          <VerdictCard b={b} />
          <Timeline b={b} />
        </div>
        <aside className="grid min-w-0 gap-6">
          <PayoutCard b={b} receiptId={receiptId} />
          <FundingCard b={b} />
          <ClaimsCard b={b} />
        </aside>
      </div>
    </div>
  );
}
