import Link from "next/link";
import type { ReactNode } from "react";
import { Amount, Avatar, Card, Chip, EmptyState, Pill, StatCard, cx, formatSats, formatXof } from "../ui";
import { formatDay, formatMinutes, payoutLabel, type ProfileView as Data, type WorkItem } from "./data";

/** Proof-of-work profile (build kit screen 8): identity card on the left, numbers + receipts on the right. */
export function ProfileView({ data }: { data: Data }) {
  const { user, stats } = data;
  return (
    <div className="grid items-start gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
      <HunterCard data={data} />
      <div className="grid min-w-0 gap-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Earned" value={formatXof(stats.totalXof)} money sub={data.totalSats != null ? formatSats(data.totalSats) : undefined} />
          <StatCard label="Bounties merged" value={stats.paidCount} sub={`${stats.acceptedPct}% accepted on first review`} />
          <StatCard label="Repos with paid work" value={stats.repos} />
          <StatCard label="Median merge → paid" value={formatMinutes(stats.medianMinutesMergeToPay)} />
        </div>

        <section className="grid gap-2" aria-label="Paid work, last 6 months">
          <h2 className="text-sm font-semibold">Paid work, last 6 months</h2>
          <Heat cells={data.heat} />
        </section>

        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Paid bounties</h2>
          {data.work.length ? (
            <ul className="grid gap-2">
              {data.work.map((w) => (
                <Receipt key={w.receiptId} w={w} />
              ))}
            </ul>
          ) : (
            <EmptyState title="No paid bounty yet" align="start">
              Paid PRs by @{user.login} show up here with their receipt.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

const TIER_LABEL = { bronze: "Bronze", silver: "Silver", gold: "Gold" } as const;
const TIER_TEXT = { bronze: "text-tier-bronze", silver: "text-tier-silver", gold: "text-tier-gold" } as const;

/**
 * U5 hunter card: avatar with tier ring, total earned in FCFA + sats, stack chips.
 * U8: light like the rest of the app (white sheet, ink text, purple top accent, green money), no longer forced dark.
 */
function HunterCard({ data }: { data: Data }) {
  const { user, stats, tier } = data;
  const rows: [string, ReactNode][] = [
    ["Bounties paid", <b key="p">{stats.paidCount}</b>],
    ["Accepted on first review", <b key="a">{stats.acceptedPct}%</b>],
    ["Repos", stats.repos],
    ["Member since", formatDay(user.createdAt)],
  ];
  return (
    <Card
      as="section"
      padding="lg"
      data-hunter-card
      className="grid justify-items-start gap-4 border-t-[3px] border-t-claim text-ink"
      aria-label="Hunter card"
    >
      <div className="flex w-full items-center gap-4 md:grid md:justify-items-start">
        <Avatar
          initials={data.initials}
          src={user.avatarUrl}
          size="xl"
          tier={tier ?? undefined}
          label={`@${user.login}${tier ? `, ${TIER_LABEL[tier]} tier` : ""}`}
        />
        <div className="grid min-w-0 gap-1">
          <h1 className="text-[1.4rem] font-extrabold leading-tight">{user.name}</h1>
          <span className="break-all text-[13px] text-muted">
            <a href={`https://github.com/${user.login}`} className="hover:text-ink hover:underline">
              @{user.login}
            </a>
            {user.city ? ` · ${user.city}` : ""}
          </span>
          {tier ? (
            <span className={cx("text-xs font-semibold", TIER_TEXT[tier])} data-tier={tier}>
              ● {TIER_LABEL[tier]} hunter
            </span>
          ) : (
            <span className="text-xs text-muted">New hunter</span>
          )}
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-muted">Total earned</span>
        <Amount xof={stats.totalXof} sats={data.totalSats ?? undefined} size="xl" money />
      </div>
      {data.languages.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Stack">
          {data.languages.map((l) => (
            <Chip key={l} size="sm">
              {l}
            </Chip>
          ))}
        </div>
      )}
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
      {data.repos.length > 0 && (
        <div className="grid min-w-0 gap-1.5">
          <div className="flex min-w-0 flex-wrap gap-1.5" aria-label="Repos">
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
    payoutLabel(w.sats),
    w.bitnobReference,
    w.signed && "signature ✓",
  ].filter(Boolean);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-[10px] border border-rule bg-sheet px-3.5 py-3 text-[13px]">
      <Link href={w.receiptHref} className="min-w-0 font-bold hover:underline">
        {w.issueTitle} · {repo} #{w.prNumber}
      </Link>
      <Amount xof={w.amountXof} sats={w.sats ?? undefined} size="sm" money />
      <small className="min-w-0 break-words font-mono text-[11px] text-muted">
        <a href={w.repoUrl} className="hover:text-ink hover:underline">
          {w.repoFullName}
        </a>
        {meta.length > 0 && <> · {meta.join(" · ")}</>}
      </small>
      <small className="font-mono text-[11px] text-muted">{formatDay(w.paidAt)}</small>
      <Link href={w.receiptHref} className="col-span-2 text-xs font-semibold text-money hover:underline">
        View receipt
      </Link>
    </li>
  );
}
