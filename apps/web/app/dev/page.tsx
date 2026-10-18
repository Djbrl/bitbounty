import type { Metadata } from "next";
import {
  Amount,
  BOUNTY_STATUSES,
  BrowserFrame,
  Button,
  Card,
  Dot,
  Page,
  PhoneFrame,
  PhoneNotification,
  Pill,
  Section,
  StatCard,
  STATUS_META,
  StatusBadge,
  Table,
  Tag,
  TBody,
  Td,
  Th,
  THead,
  TONES,
  Tr,
} from "@/components/ui";

export const metadata: Metadata = { title: "Design base · BitBounty" };

const SWATCHES = [
  ["paper", "bg-paper"],
  ["sheet", "bg-sheet"],
  ["ink", "bg-ink"],
  ["muted", "bg-muted"],
  ["rule", "bg-rule"],
  ["chip", "bg-chip"],
  ["money", "bg-money"],
  ["money-soft", "bg-money-soft"],
  ["pending", "bg-pending"],
  ["pending-soft", "bg-pending-soft"],
  ["claim", "bg-claim"],
  ["claim-soft", "bg-claim-soft"],
  ["danger", "bg-danger"],
  ["danger-soft", "bg-danger-soft"],
  ["agent", "bg-agent"],
  ["agent-soft", "bg-agent-soft"],
] as const;

const ROWS = [
  { issue: "#41", title: "Retry webhook delivery on 5xx", repo: "bitnob-js", xof: 15000, status: "funded" },
  { issue: "#38", title: "Add NGN to the currency enum", repo: "bitnob-js", xof: 5000, status: "claimed" },
  { issue: "#12", title: "Fix pagination on /transactions", repo: "bitnob-js", xof: 10000, status: "paid" },
  { issue: "#7", title: "Typo in README install step", repo: "wave-sdk", xof: 2500, status: "payout_failed" },
] as const;

/** W1 design base: every token and base component on one page. Not linked from the nav. */
export default function DevPage() {
  return (
    <Page nav={{ items: [{ href: "/dev", label: "Design base" }], active: "/dev", initials: "DS" }}>
      <header className="grid gap-3">
        <span className="font-mono text-[0.74rem] font-medium uppercase tracking-[0.08em] text-muted">W1 · /dev</span>
        <h1 className="text-[clamp(2.2rem,6vw,3.6rem)] font-extrabold tracking-tight">Design base</h1>
        <p className="max-w-[62ch] text-lg text-muted">
          Tokens and base components ported from the build kit. Import from <code className="font-mono text-[0.86em]">@/components/ui</code>.
          Dark mode follows the OS; force it with <code className="font-mono text-[0.86em]">&lt;html data-theme=&quot;dark&quot;&gt;</code>.
        </p>
      </header>

      <Section eyebrow="Tokens" title="Colours" description="Tailwind utilities: bg-*, text-*, border-*. Values flip in dark mode.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="grid gap-1.5">
              <div className={`h-14 rounded-lg border border-rule ${cls}`} />
              <code className="font-mono text-xs text-muted">{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Tokens" title="Type" description="font-display (Bricolage Grotesque), font-body (Instrument Sans), font-mono (JetBrains Mono).">
        <Card padding="lg" className="grid gap-3">
          <h1 className="text-[clamp(2rem,5vw,3.2rem)] font-extrabold tracking-tight">Put a price on your backlog.</h1>
          <h2 className="text-2xl font-extrabold">Pay only when it merges.</h2>
          <h3 className="text-lg font-bold">Payé en sats via Lightning, quelques minutes après le merge.</h3>
          <p className="max-w-[68ch]">
            Body text in Instrument Sans. Claude reads your open issues, writes acceptance criteria and suggests a price in FCFA.
          </p>
          <p className="font-mono text-sm text-muted">/bounty 10000 · pay-bnt_01J9 · 120 000 sats</p>
          <div className="flex flex-wrap items-baseline gap-4">
            <Amount xof={2500} size="sm" />
            <Amount xof={10000} />
            <Amount xof={62500} size="lg" />
            <Amount xof={95000} size="xl" money />
          </div>
        </Card>
      </Section>

      <Section
        eyebrow="Components"
        title="StatusBadge"
        description="One badge per bounty status from @bitbounty/core (11). lang=&quot;fr&quot; on developer pages."
      >
        <Table>
          <THead>
            <tr>
              <Th>status</Th>
              <Th>en</Th>
              <Th>fr</Th>
              <Th>tone</Th>
              <Th>hint</Th>
            </tr>
          </THead>
          <TBody>
            {BOUNTY_STATUSES.map((s) => (
              <Tr key={s}>
                <Td mono>{s}</Td>
                <Td>
                  <StatusBadge status={s} />
                </Td>
                <Td>
                  <StatusBadge status={s} lang="fr" />
                </Td>
                <Td mono>{STATUS_META[s].tone}</Td>
                <Td className="min-w-[220px] text-muted">{STATUS_META[s].hint}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section eyebrow="Components" title="Pills, dots, tags">
        <div className="flex flex-wrap items-center gap-2">
          {TONES.map((t) => (
            <Pill key={t} tone={t} dot>
              {t}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="agent" size="sm">
            Funded by an agent
          </Pill>
          <Pill tone="ink" size="sm">
            All
          </Pill>
          <Pill size="sm">TypeScript</Pill>
          <Tag>good first issue</Tag>
          <Tag>docs</Tag>
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <Dot tone="money" pulse /> live
          </span>
        </div>
      </Section>

      <Section eyebrow="Components" title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Fund 5 bounties</Button>
          <Button variant="secondary">Re-scan</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Hold payout</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary">
            Copy invoice
          </Button>
        </div>
      </Section>

      <Section eyebrow="Components" title="Cards">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard emphasis label="Held for open bounties" value="62 500 F" sub="7 bounties · 2 repos" />
          <StatCard money label="Paid out this month" value="95 000 F" sub="11 merged PRs · 9 developers" />
          <StatCard label="Median issue → merged" value="31 h" sub="was 19 days before BitBounty" />
        </div>
        <div className="grid gap-3">
          {ROWS.slice(0, 2).map((r) => (
            <Card key={r.issue} as="article" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
              <div className="grid gap-1.5">
                <h4 className="font-body text-[15px] font-semibold">{r.title}</h4>
                <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-muted">
                  <span>
                    {r.repo} {r.issue}
                  </span>
                  <Tag>TypeScript</Tag>
                  <StatusBadge status={r.status} size="sm" />
                </div>
              </div>
              <div className="grid content-start justify-items-end gap-1">
                <Amount xof={r.xof} />
                <span className="text-xs text-muted">via Lightning</span>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section eyebrow="Components" title="Table" description="Scrolls horizontally inside its border at phone width.">
        <Table>
          <THead>
            <tr>
              <Th>Issue</Th>
              <Th>Repo</Th>
              <Th>Status</Th>
              <Th className="text-right">Reward</Th>
            </tr>
          </THead>
          <TBody>
            {ROWS.map((r, i) => (
              <Tr key={r.issue} selected={i === 0}>
                <Td>
                  <span className="font-semibold">{r.title}</span>{" "}
                  <span className="text-muted">{r.issue}</span>
                </Td>
                <Td mono>{r.repo}</Td>
                <Td>
                  <StatusBadge status={r.status} size="sm" />
                </Td>
                <Td numeric className="font-semibold">
                  <Amount xof={r.xof} size="sm" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section eyebrow="Components" title="Phone frame" description="fixed (default) for illustrations; fluid fills a real phone and shows the bezel from sm: up.">
        <div className="flex flex-wrap gap-6">
          <PhoneFrame>
            <span className="font-mono text-[11px] tracking-wider text-muted">ÉTAPE 2 SUR 3</span>
            <h3 className="text-[1.35rem] font-extrabold">Où veux-tu être payé ?</h3>
            <p className="text-[13px] leading-snug text-muted">Ton adresse Lightning reçoit les primes en sats.</p>
            <div className="grid gap-px rounded-[10px] border border-rule bg-sheet px-3 py-2">
              <label className="text-[11px] text-muted">Adresse Lightning</label>
              <div className="text-[15px] font-medium">awa@blink.sv</div>
            </div>
            <Button block size="lg" className="mt-auto">
              Enregistrer
            </Button>
          </PhoneFrame>
          <PhoneFrame lock time="14:32">
            <div className="mt-6 text-center font-display text-[3.4rem] font-bold leading-none">14:32</div>
            <div className="mb-3 text-center text-[13px] opacity-85">samedi 18 octobre</div>
            <PhoneNotification icon="⚡" title="Blink · Paiement reçu" body="Tu as reçu 16 180 sats (10 000 F) de BitBounty pour bitnob-js #12." />
          </PhoneFrame>
        </div>
      </Section>

      <Section eyebrow="Components" title="Browser frame">
        <BrowserFrame url="bitbounty.app/b/bnt_01J9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <h3 className="text-xl font-extrabold">Fix pagination on /transactions</h3>
              <span className="text-sm text-muted">bitnob-community/bitnob-js #12</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status="paid" />
              <Amount xof={10000} size="lg" money />
            </div>
          </div>
        </BrowserFrame>
      </Section>
    </Page>
  );
}
