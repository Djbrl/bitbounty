import Link from "next/link";
import type { ReactNode } from "react";
import { Amount, Avatar, Card, Eyebrow, Pill, StatCard, Tag, cx, formatXof } from "../ui";
import { formatDay, formatMinutes, PROVIDER_LABEL, type ProfileView as Data, type WorkItem } from "./data";

/** Proof-of-work profile (build kit screen 8): identity card on the left, numbers + receipts on the right. */
export function ProfileView({ data }: { data: Data }) {
  const { user, stats } = data;
  return (
    <div className="grid items-start gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
      <IdentityCard data={data} />
      <div className="grid min-w-0 gap-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Earned" value={formatXof(stats.totalXof)} money sub="paid in FCFA" />
          <StatCard label="Bounties merged" value={stats.paidCount} sub={`${stats.acceptedPct}% accepted on first review`} />
          <StatCard label="Repos" value={stats.repos} sub="with paid work" />
          <StatCard label="Median merge → paid" value={formatMinutes(stats.medianMinutesMergeToPay)} />
        </div>

        <section className="grid gap-2" aria-label="Paid work, last 6 months">
          <Eyebrow>Paid work, last 6 months</Eyebrow>
          <Heat cells={data.heat} />
        </section>

        <section className="grid gap-2">
          <Eyebrow>Receipts</Eyebrow>
          {data.work.length ? (
            <ul className="grid gap-2">
              {data.work.map((w) => (
                <Receipt key={w.receiptId} w={w} />
              ))}
            </ul>
          ) : (
            <Card className="text-sm text-muted">
              No paid bounty yet. Every merged and paid PR by @{user.login} will show up here with a signed receipt.
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function IdentityCard({ data }: { data: Data }) {
  const { user, stats } = data;
  const rows: [string, ReactNode][] = [
    ["Bounties paid", <b key="p">{stats.paidCount}</b>],
    ["Accepted on first review", <b key="a">{stats.acceptedPct}%</b>],
    ["Repos", stats.repos],
    ["Earned", <b key="e">{formatXof(stats.totalXof)}</b>],
  ];
  return (
    <Card as="section" padding="lg" className="grid justify-items-start gap-3" aria-label="Developer">
      <div className="flex items-center gap-3 md:grid md:gap-3">
        <Avatar initials={data.initials} size="lg" />
        <div className="grid min-w-0">
          <h1 className="font-display text-[1.3rem] font-extrabold leading-tight">{user.name}</h1>
          <span className="break-all text-[13px] text-muted">
            <a href={`https://github.com/${user.login}`} className="hover:text-ink hover:underline">
              @{user.login}
            </a>{" "}
            · {user.city}
          </span>
        </div>
      </div>
      <dl className="grid w-full border-t border-rule text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2.5 border-b border-rule py-[9px]">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {data.payoutVerified ? (
        <span className="flex w-full items-center gap-2 rounded-[10px] bg-money-soft px-3 py-2.5 text-[13px] font-semibold text-money">
          ✓ Payout account verified
        </span>
      ) : (
        <span className="flex w-full items-center gap-2 rounded-[10px] bg-chip px-3 py-2.5 text-[13px] font-semibold text-muted">
          No payout received yet
        </span>
      )}
      {data.languages.length > 0 && (
        <div className="grid gap-1.5">
          <Eyebrow>Languages</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {data.languages.map((l) => (
              <Tag key={l}>{l}</Tag>
            ))}
          </div>
        </div>
      )}
      {data.repos.length > 0 && (
        <div className="grid min-w-0 gap-1.5">
          <Eyebrow>Repos</Eyebrow>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {data.repos.map((r) => (
              <a key={r.fullName} href={r.url} className="min-w-0 max-w-full">
                <Pill size="sm" className="max-w-full truncate hover:underline">
                  {r.fullName}
                </Pill>
              </a>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Heat({ cells }: { cells: number[] }) {
  const total = cells.reduce((a, b) => a + b, 0);
  return (
    <div
      role="img"
      aria-label={`${total} paid ${total === 1 ? "bounty" : "bounties"} in the last ${cells.length} weeks`}
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((n, i) => (
        <i
          key={i}
          data-count={n}
          className={cx("aspect-square rounded-[2px]", n === 0 ? "bg-chip" : n === 1 ? "bg-money/60" : "bg-money")}
        />
      ))}
    </div>
  );
}

function Receipt({ w }: { w: WorkItem }) {
  const repo = w.repoFullName.split("/")[1] ?? w.repoFullName;
  const meta = [
    w.funderLogin && `funded by @${w.funderLogin}`,
    w.provider && PROVIDER_LABEL[w.provider],
    w.bitnobReference,
    w.signed && "signature ✓",
  ].filter(Boolean);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-[10px] border border-rule bg-sheet px-3.5 py-3 text-[13px]">
      <Link href={w.receiptHref} className="min-w-0 font-bold hover:underline">
        {w.issueTitle} · {repo} #{w.prNumber}
      </Link>
      <Amount xof={w.amountXof} size="sm" money />
      <small className="min-w-0 break-words font-mono text-[11px] text-muted">
        <a href={w.repoUrl} className="hover:text-ink hover:underline">
          {w.repoFullName}
        </a>
        {meta.length > 0 && <> · {meta.join(" · ")}</>}
      </small>
      <small className="font-mono text-[11px] text-muted">{formatDay(w.paidAt)}</small>
      <Link href={w.receiptHref} className="col-span-2 text-xs font-semibold text-money hover:underline">
        View receipt {w.receiptId} →
      </Link>
    </li>
  );
}
