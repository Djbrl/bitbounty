// Maintainer dashboard (server component): totals, Price my backlog, active bounties, repos.
import Link from "next/link";
import { Button, Card, EmptyState, formatXof, Page, Section, StatCard, StatusPill, Table, TBody, Td, Th, THead, Tr } from "../ui";
import { PriceMyBacklog } from "./price-my-backlog";
import { activeBounties, initialsOf, type DashboardData } from "./shape";

export const DASHBOARD_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/explore", label: "Bounties" },
  { href: "/live", label: "Live" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DashboardView({ data }: { data: DashboardData }) {
  return (
    <Page nav={{ items: DASHBOARD_NAV, active: "/dashboard", initials: initialsOf(data.maintainer) }}>
      <DashboardContent data={data} />
    </Page>
  );
}

/** The dashboard without the page frame, for the /app shell (U2). Section ids back the sidebar anchors. */
export function DashboardContent({ data }: { data: DashboardData }) {
  const { stats, repos, backlog, needsAction } = data;
  const active = activeBounties(data.bounties);
  const openIssues = repos.reduce((n, r) => n + r.openIssues, 0);
  const backlogRepos = [...new Set(backlog.map((s) => s.repoFullName))];

  return (
    <>
      <h1 className="sr-only">Maintainer dashboard</h1>
      <div id="payouts" className="grid gap-3 sm:grid-cols-3">
        <StatCard
          emphasis
          label="Held for open bounties"
          value={formatXof(stats.heldXof)}
          sub={`${plural(stats.activeCount, "bounty", "bounties")} · ${plural(repos.length, "repo")}`}
        />
        <StatCard
          money
          label="Paid out"
          value={formatXof(stats.spentXof)}
          sub={`${plural(stats.paidCount, "merged PR")} · budget ${formatXof(stats.budgetXof)}`}
        />
        <StatCard label="Median merge → paid" value={`${stats.medianMinutesMergeToPay} min`} />
      </div>

      <Section
        id="backlog"
        title="Price my backlog"
        description={
          <>
            Claude read {plural(openIssues, "open issue")}
            {backlogRepos.length > 0 && (
              <>
                {" "}
                in <b className="text-ink">{backlogRepos.join(", ")}</b>
              </>
            )}{" "}
            and suggests {backlog.length} to fund.
          </>
        }
        actions={
          <Button variant="secondary" size="sm" disabled title="Coming soon">
            Re-scan
          </Button>
        }
      >
        <PriceMyBacklog backlog={backlog} />
      </Section>

      {needsAction.length > 0 && (
        <Section title="Needs you">
          <Card padding="none" as="section">
            <ul className="divide-y divide-rule text-sm">
              {needsAction.map((a, i) => (
                <li key={`${a.bountyId}-${a.action}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="min-w-0">{a.text}</span>
                  <Link href={`/b/${a.bountyId}`} className="text-[13px] font-semibold text-claim hover:underline">
                    View bounty
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      <Section id="review" title="Active bounties">
        {active.length ? (
          <Table className="min-w-[620px]">
            <THead>
              <tr>
                <Th>Issue</Th>
                <Th>Status</Th>
                <Th>Who</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </THead>
            <TBody>
              {active.map((b) => (
                <Tr key={b.id} data-bounty={b.id}>
                  <Td>
                    <Link href={`/b/${b.id}`} className="grid gap-0.5 hover:underline">
                      <b className="font-semibold">
                        #{b.issueNumber} {b.issueTitle}
                      </b>
                      <span className="font-mono text-[0.78rem] text-muted">{b.repoFullName}</span>
                    </Link>
                  </Td>
                  <Td>
                    <StatusPill status={b.status} size="sm" />
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    {b.claimedBy ? `@${b.claimedBy}` : "—"}
                    {b.prNumber ? ` · PR #${b.prNumber}` : ""}
                  </Td>
                  <Td numeric className="whitespace-nowrap font-bold">
                    {formatXof(b.amountXof)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No active bounty">Fund one from your backlog above.</EmptyState>
        )}
      </Section>

      <Section id="repos" title="Repositories">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {repos.map((r) => (
            <Card key={r.fullName} className="grid gap-2">
              <b className="truncate font-mono text-[0.85rem]">{r.fullName}</b>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                <span>{plural(r.openIssues, "open issue")}</span>
                <span>{plural(r.activeBounties, "active bounty", "active bounties")}</span>
                <span className="font-semibold text-money">{r.paidPct}% paid</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-chip" aria-hidden>
                <div className="h-full rounded-full bg-money" style={{ width: `${Math.min(100, Math.max(0, r.paidPct))}%` }} />
              </div>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
