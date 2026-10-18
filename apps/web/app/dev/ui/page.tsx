import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Amount,
  Avatar,
  BOUNTY_STATUSES,
  BrowserFrame,
  Button,
  Card,
  Chip,
  Dot,
  EmptyState,
  Eyebrow,
  Page,
  PhoneFrame,
  PhoneNotification,
  Pill,
  ProgressSteps,
  Skeleton,
  StatCard,
  StatusPill,
  Table,
  Tag,
  TBody,
  Td,
  Th,
  THead,
  Toast,
  TONES,
  Tr,
} from "@/components/ui";
import { ToastDemo } from "./toast-demo";

export const metadata: Metadata = { title: "Design system · BitBounty" };

const SWATCHES = [
  "paper",
  "sheet",
  "ink",
  "ink-2",
  "ink-soft",
  "muted",
  "rule",
  "line-dark",
  "chip",
  "mint",
  "money",
  "money-soft",
  "money-bright",
  "amber",
  "pending",
  "pending-soft",
  "claim",
  "claim-soft",
  "danger",
  "danger-soft",
  "agent",
  "agent-soft",
  "forest",
  "tier-bronze",
  "tier-silver",
  "tier-gold",
] as const;

const ROWS = [
  { issue: "#41", title: "Retry webhook delivery on 5xx", repo: "bitnob-js", xof: 15000, status: "funded" },
  { issue: "#38", title: "Add NGN to the currency enum", repo: "bitnob-js", xof: 5000, status: "claimed" },
  { issue: "#12", title: "Fix pagination on /transactions", repo: "bitnob-js", xof: 10000, status: "paid" },
] as const;

/** U0: every token and component of the design system, in a light and a dark panel side by side. Not linked. */
export default function DesignSystemPage() {
  return (
    <Page width="wide" nav={{ items: [{ href: "/dev/ui", label: "Design system" }], active: "/dev/ui" }}>
      <header className="grid gap-3">
        <Eyebrow>U0 · /dev/ui</Eyebrow>
        <h1 className="text-[clamp(2.2rem,6vw,3.6rem)] tracking-[-0.035em]">Design system</h1>
        <p className="max-w-[68ch] text-lg text-ink-soft">
          Tokens, fonts and components taken from the landing. Import from{" "}
          <code className="font-mono text-[0.86em]">@/components/ui</code>, docs in{" "}
          <code className="font-mono text-[0.86em]">apps/web/components/README.md</code>. Each panel below forces its theme
          with <code className="font-mono text-[0.86em]">data-theme</code>; the rest of the app follows the OS.
        </p>
        <div>
          <ToastDemo />
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel theme="light" />
        <Panel theme="dark" />
      </div>
    </Page>
  );
}

function Panel({ theme }: { theme: "light" | "dark" }) {
  return (
    <div
      data-theme={theme}
      data-panel={theme}
      className="grid min-w-0 gap-10 rounded-[var(--radius-card-lg)] border border-rule bg-paper p-4 text-ink sm:p-6"
    >
      <Eyebrow>{theme === "light" ? "Light" : "Dark"}</Eyebrow>
      <Showcase />
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3">
      <div className="grid gap-0.5">
        <h2 className="text-xl">{title}</h2>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Showcase() {
  return (
    <>
      <Block title="Colours" note="bg-* / text-* / border-* utilities. Values flip with the theme.">
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          {SWATCHES.map((name) => (
            <div key={name} className="grid gap-1">
              <div className="h-10 rounded-[10px] border border-rule" style={{ background: `var(--bb-${name})` }} />
              <code className="truncate font-mono text-[11px] text-muted">{name}</code>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Type" note="Headings and text: Instrument Sans. Amounts: Bricolage Grotesque 800. Hashes, timers: JetBrains Mono.">
        <Card padding="lg" className="grid gap-3">
          <h3 className="text-[clamp(1.8rem,4vw,2.6rem)] tracking-[-0.035em]">Faites-vous payer pour contribuer.</h3>
          <p className="text-ink-soft">Des issues GitHub financées, payées en FCFA sur Wave dès le merge.</p>
          <span className="font-display text-[2.6rem] font-extrabold leading-none tracking-[-0.03em]">10 000 F</span>
          <p className="font-mono text-[13px] text-muted">/bounty 10000 · pay-bnt_01J9 · 71:59:12</p>
        </Card>
      </Block>

      <Block title="Button" note="primary · secondary · ghost · dark · danger, sizes sm / md / lg. buttonClass() styles links.">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Trouver une issue payée</Button>
          <Button variant="secondary">Re-scan</Button>
          <Button variant="ghost">Publier une bounty ›</Button>
          <Button variant="dark">Installer</Button>
          <Button variant="danger">Hold payout</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Block>

      <Block title="Chip" note="Label, or a toggle button (aria-pressed) when selected / onClick is set.">
        <div className="flex flex-wrap items-center gap-2">
          <Chip selected>All</Chip>
          <Chip selected={false}>TypeScript</Chip>
          <Chip selected={false}>Go</Chip>
          <Chip icon="🐍">Python</Chip>
          <Chip size="sm">good first issue</Chip>
        </div>
      </Block>

      <Block title="StatusPill" note="One colour per bounty status (11). lang=&quot;fr&quot; on developer pages.">
        <div className="grid gap-2 sm:grid-cols-2">
          {BOUNTY_STATUSES.map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-2">
              <StatusPill status={s} />
              <StatusPill status={s} lang="fr" size="sm" />
            </div>
          ))}
        </div>
      </Block>

      <Block title="Pill, Tag, Dot" note="Free-form labels in every tone.">
        <div className="flex flex-wrap items-center gap-2">
          {TONES.map((t) => (
            <Pill key={t} tone={t} dot>
              {t}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="agent" size="sm">
            🤖 Funded by an agent
          </Pill>
          <Tag>docs</Tag>
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <Dot tone="money" pulse /> live
          </span>
        </div>
      </Block>

      <Block title="Amount" note="FCFA big, sats small. currency=&quot;sats&quot; | &quot;ngn&quot; puts the preferred currency first.">
        <div className="flex flex-wrap items-end gap-6">
          <Amount xof={2500} size="sm" />
          <Amount xof={10000} sats={15300} />
          <Amount xof={62500} sats={95600} size="lg" money />
          <Amount xof={10000} sats={15300} currency="sats" size="lg" />
          <Amount xof={10000} ngn={24500} currency="ngn" size="lg" />
        </div>
        <Amount xof={95000} size="xl" money />
      </Block>

      <Block title="Avatar" note="Initials or photo (src). tier = bronze | silver | gold draws the ring.">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar initials="A" size="sm" />
          <Avatar initials="MS" />
          <Avatar initials="AN" size="lg" tier="bronze" label="@awa, Bronze tier" />
          <Avatar initials="KD" size="lg" tier="silver" label="@khady, Silver tier" />
          <Avatar initials="FS" size="xl" tier="gold" label="@fatou, Gold tier" />
        </div>
      </Block>

      <Block title="Card, StatCard">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard emphasis label="Held for open bounties" value="62 500 F" sub="7 bounties · 2 repos" />
          <StatCard money label="Paid out this month" value="95 000 F" sub="11 merged PRs" />
        </div>
        <Card as="article" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
          <div className="grid gap-1.5">
            <h4 className="text-[15px] font-semibold tracking-normal">Retry payouts.finalize() on 5xx</h4>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span>bitnob-js #12</span>
              <Tag>TypeScript</Tag>
              <StatusPill status="funded" size="sm" />
            </div>
          </div>
          <Amount xof={10000} sats={15300} className="justify-items-end" />
        </Card>
      </Block>

      <Block title="ProgressSteps" note="current = the step in progress.">
        <ProgressSteps label="Onboarding" current={1} steps={[{ label: "Rôle", done: true }, { label: "Stack" }, { label: "Paiement" }]} />
        <ProgressSteps
          steps={[
            { label: "Funded", done: true, at: "18/10 09:12" },
            { label: "Claimed", done: true },
            { label: "PR checked", done: true },
            { label: "Merged" },
            { label: "Paid" },
          ]}
          current={3}
        />
      </Block>

      <Block title="EmptyState">
        <EmptyState icon="🔍" title="No bounty matches this filter" action={<Button variant="ghost" size="sm">Show all 12</Button>}>
          Try another filter, or see them all.
        </EmptyState>
      </Block>

      <Block title="Skeleton">
        <div className="grid gap-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-20 rounded-[var(--radius-card)]" />
        </div>
      </Block>

      <Block title="Toast" note="useToast() from any client component; Toast renders one inline.">
        <div className="grid gap-2">
          <Toast tone="success" title="Wave · Paiement reçu" action="View receipt →">
            Tu as reçu 10 000 F pour bitnob-js #12.
          </Toast>
          <Toast title="Claim extended">You have 24 more hours on #38.</Toast>
          <Toast tone="error" title="Payout failed">The money stays reserved. Retrying in 5 min.</Toast>
        </div>
      </Block>

      <Block title="Table">
        <Table>
          <THead>
            <tr>
              <Th>Issue</Th>
              <Th>Status</Th>
              <Th className="text-right">Reward</Th>
            </tr>
          </THead>
          <TBody>
            {ROWS.map((r, i) => (
              <Tr key={r.issue} selected={i === 0}>
                <Td>
                  <span className="font-semibold">{r.title}</span> <span className="text-muted">{r.issue}</span>
                </Td>
                <Td>
                  <StatusPill status={r.status} size="sm" />
                </Td>
                <Td numeric>
                  <Amount xof={r.xof} size="sm" />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Block>

      <Block title="PhoneFrame, BrowserFrame">
        <div className="flex flex-wrap gap-4">
          <PhoneFrame lock time="14:32">
            <div className="mt-6 text-center text-[3.4rem] font-light leading-none tracking-[-0.03em]">14:32</div>
            <div className="mb-3 text-center text-[13px] text-mint">samedi 18 octobre</div>
            <PhoneNotification title="Wave · Paiement reçu" body="Tu as reçu 10 000 F de BitBounty pour bitnob-js #12." />
          </PhoneFrame>
        </div>
        <BrowserFrame url="bitbounty.app/b/bnt_01J9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">Fix pagination on /transactions</span>
            <StatusPill status="paid" />
          </div>
        </BrowserFrame>
      </Block>
    </>
  );
}
