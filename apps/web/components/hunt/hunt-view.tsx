// U3: the hunter home (/app/hunt): hunter card + next tier, active claims, for you, activity, earnings.
import Link from "next/link";
import { formatDateTime } from "../bounty/shape";
import { initialsOf } from "../profile/data";
import { Amount, Avatar, Card, Chip, EmptyState, Pill, Section, buttonClass, cx, formatXof } from "../ui";
import { BountyCard } from "./bounty-card";
import { ClaimCountdown } from "./claim-countdown";
import type { HuntData, Part } from "./data";
import type { ClaimCard, FeedItem, TierProgress } from "./shape";
import { huntText, type HuntText, type Lang } from "./text";

const PAYOUT_TONE = { pending: "pending", processing: "claim", succeeded: "money", failed: "danger" } as const;
const VERDICT_TONE = { pass: "money", fail: "danger", unsure: "pending" } as const;
const CI_TONE = { pending: "pending", success: "money", failure: "danger" } as const;
const TIER_TEXT = { bronze: "text-tier-bronze", silver: "text-tier-silver", gold: "text-tier-gold" } as const;
const TIER_BG = { bronze: "bg-tier-bronze", silver: "bg-tier-silver", gold: "bg-tier-gold" } as const;

function NextTier({ progress, t }: { progress: TierProgress; t: HuntText }) {
  const label = progress.next ? t.nextTier(progress.remaining, t.tier[progress.next]) : t.topTier;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <b className="font-semibold">{label}</b>
        <span className="text-xs text-muted">{t.tierRule}</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-chip"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.ratio * 100)}
      >
        <div className={cx("h-full rounded-full", progress.next ? TIER_BG[progress.next] : "bg-tier-gold")} style={{ width: `${Math.max(4, Math.round(progress.ratio * 100))}%` }} />
      </div>
    </div>
  );
}

function HunterCard({ data, t }: { data: HuntData; t: HuntText }) {
  const { me, progress, streak, totalSats, languages } = data;
  const login = me.user.login;
  const tier = progress.tier;
  const paidCount = Math.max(me.earnings.paidCount, data.profile?.stats.paidCount ?? 0);
  return (
    <Card padding="lg" className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar
          size="lg"
          initials={initialsOf(me.user.name || login, login)}
          src={me.user.avatarUrl}
          tier={tier ?? undefined}
          label={t.tierAria(login, tier ? t.tier[tier] : t.noTier)}
        />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-extrabold tracking-tight">{me.user.name || login}</h2>
            <span className={cx("font-mono text-[11px] font-semibold uppercase tracking-wider", tier ? TIER_TEXT[tier] : "text-muted")}>
              {tier ? t.tier[tier] : t.noTier}
            </span>
          </div>
          <Link href={`/u/${encodeURIComponent(login)}`} className="w-fit font-mono text-xs text-muted hover:text-ink hover:underline">
            @{login} · {t.profile}
          </Link>
          <div className="flex flex-wrap gap-1.5 pt-1" aria-label={t.languages}>
            {languages.length ? (
              languages.slice(0, 5).map((l) => (
                <Chip key={l} size="sm">
                  {l}
                </Chip>
              ))
            ) : (
              <span className="text-xs text-muted">{t.noLanguages}</span>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 border-t border-rule pt-4 sm:grid-cols-3">
        <div className="col-span-2 grid gap-1 sm:col-span-1">
          <dt className="text-xs text-muted">{t.earned}</dt>
          <dd>
            <Amount xof={me.earnings.totalXof} sats={totalSats ?? undefined} currency={data.currency === "sats" ? "sats" : "xof"} size="lg" money={me.earnings.totalXof > 0} />
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-muted">{t.paid}</dt>
          <dd className="font-display text-[1.6rem] font-extrabold leading-none tabular-nums">{paidCount}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-muted">{t.streak}</dt>
          <dd className="grid gap-0.5">
            <span className="font-display text-[1.6rem] font-extrabold leading-none tabular-nums">{t.streakValue(streak)}</span>
            <span className="text-[11px] text-muted">{t.streakSub}</span>
          </dd>
        </div>
      </dl>

      <NextTier progress={progress} t={t} />
    </Card>
  );
}

function SectionError({ t }: { t: HuntText }) {
  return (
    <Card role="alert" className="border-danger text-sm text-danger">
      {t.sectionError}
    </Card>
  );
}

function ClaimItem({ c, t, lang, now }: { c: ClaimCard; t: HuntText; lang: Lang; now: number }) {
  return (
    <Card as="li" className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/b/${c.bountyId}`} className="font-semibold leading-snug hover:underline">
            {c.issueTitle}
          </Link>
          <span className="truncate font-mono text-[12px] text-muted">
            {c.repoFullName}
            {c.issueNumber ? ` #${c.issueNumber}` : ""}
          </span>
        </div>
        {c.amountXof !== null ? <Amount xof={c.amountXof} size="sm" className="shrink-0" /> : null}
      </div>
      <ClaimCountdown expiresAt={c.expiresAt} createdAt={c.createdAt} lang={lang} now={now} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {c.pr ? (
          <>
            <a href={c.pr.url} className="font-mono font-semibold hover:underline">
              {t.pr(c.pr.number)}
            </a>
            <Pill size="sm" tone={CI_TONE[c.pr.ci]} dot>
              {t.ci[c.pr.ci]}
            </Pill>
            {c.pr.merged ? (
              <Pill size="sm" tone="money">
                {t.merged}
              </Pill>
            ) : null}
          </>
        ) : (
          <span className="text-muted">{t.noPr}</span>
        )}
        {c.extended ? (
          <Pill size="sm" tone="outline">
            {t.extended}
          </Pill>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-agent-soft px-3 py-2 text-xs text-agent">
        <b>{t.verdict}</b>
        {c.verdict ? (
          <Pill size="sm" tone={VERDICT_TONE[c.verdict]}>
            {t.verdicts[c.verdict]}
          </Pill>
        ) : (
          <span>{t.noVerdict}</span>
        )}
      </div>
      {c.extended ? null : <p className="text-[12px] text-muted">{t.extendHint}</p>}
    </Card>
  );
}

function Claims({ claims, t, lang, now }: { claims: Part<ClaimCard[]>; t: HuntText; lang: Lang; now: number }) {
  return (
    <Section id="claims" title={t.claims} description={t.claimsSub}>
      {!claims.ok ? (
        <SectionError t={t} />
      ) : claims.value.length ? (
        <ul className="grid gap-3">
          {claims.value.map((c) => (
            <ClaimItem key={c.bountyId} c={c} t={t} lang={lang} now={now} />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t.noClaims}
          align="start"
          action={
            <Link href="/explore" className={buttonClass({ size: "sm" })}>
              {t.browse}
            </Link>
          }
        >
          {t.noClaimsBody}
        </EmptyState>
      )}
    </Section>
  );
}

function ForYouSection({ data, t, lang, now }: { data: HuntData; t: HuntText; lang: Lang; now: number }) {
  const fy = data.forYou;
  const desc = !fy.ok ? undefined : fy.value.matched ? t.forYouMatched(fy.value.stack.join(", ")) : fy.value.stack.length ? t.forYouAll : t.forYouNoStack;
  return (
    <Section
      id="for-you"
      title={t.forYou}
      description={desc}
      actions={
        <Link href="/explore" className={buttonClass({ size: "sm", variant: "ghost" })}>
          {t.seeAll} →
        </Link>
      }
    >
      {!fy.ok ? (
        <SectionError t={t} />
      ) : fy.value.rows.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {fy.value.rows.map((b) => (
            <BountyCard key={b.id} b={b} lang={lang} now={now} />
          ))}
        </ul>
      ) : (
        <EmptyState title={t.noOpen} align="start">
          {t.noOpenBody}
        </EmptyState>
      )}
    </Section>
  );
}

function Activity({ feed, t, lang }: { feed: Part<FeedItem[]>; t: HuntText; lang: Lang }) {
  return (
    <Section id="activity" title={t.activity}>
      {!feed.ok ? (
        <SectionError t={t} />
      ) : feed.value.length ? (
        <Card padding="none">
          <ol className="divide-y divide-rule text-sm">
            {feed.value.map((e) => (
              <li key={`${e.bountyId}-${e.type}-${e.occurredAt}`} className="grid gap-0.5 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <b className={cx("font-semibold", e.type === "payout.succeeded" && "text-money")}>{t.events[e.type] ?? e.type}</b>
                  <span className="font-mono text-[11px] text-muted">{formatDateTime(e.occurredAt, lang)}</span>
                </div>
                <Link href={`/b/${e.bountyId}`} className="truncate text-[13px] text-ink-soft hover:underline">
                  {e.issueTitle}
                </Link>
                <span className="font-mono text-[11px] text-muted">
                  {e.repoFullName} · {formatXof(e.amountXof)}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <EmptyState title={t.noActivity} align="start">
          {t.noActivityBody}
        </EmptyState>
      )}
    </Section>
  );
}

function Earnings({ data, t, lang }: { data: HuntData; t: HuntText; lang: Lang }) {
  const payouts = data.me.payouts;
  return (
    <Section id="earnings" title={t.earnings}>
      {payouts.length ? (
        <Card padding="none">
          <ul className="divide-y divide-rule text-sm">
            {payouts.map((p) => (
              <li key={`${p.bountyId}-${p.paidAt ?? p.status}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="grid gap-0.5">
                  <Link href={p.receiptId ? `/r/${p.receiptId}` : `/b/${p.bountyId}`} className="font-display text-base font-extrabold hover:underline">
                    {formatXof(p.amountXof)}
                  </Link>
                  {p.paidAt ? <span className="font-mono text-[11px] text-muted">{formatDateTime(p.paidAt, lang)}</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={PAYOUT_TONE[p.status]} size="sm">
                    {t.payout[p.status]}
                  </Pill>
                  {p.receiptId ? (
                    <Link href={`/r/${p.receiptId}`} className="text-xs font-semibold text-money hover:underline">
                      {t.receipt}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState title={t.noEarnings} align="start">
          {t.noEarningsBody}
        </EmptyState>
      )}
    </Section>
  );
}

export function HuntView({ data, lang, now }: { data: HuntData; lang: Lang; now: number }) {
  const t = huntText(lang);
  const account = data.me.payoutAccount;
  return (
    <>
      <h1 className="sr-only">{t.title}</h1>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-10">
          <HunterCard data={data} t={t} />
          {account?.status !== "verified" ? (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <span>{t.linkAccount}</span>
              <Link href="/me" className={buttonClass({ size: "sm" })}>
                {t.linkCta}
              </Link>
            </Card>
          ) : null}
          <Claims claims={data.claims} t={t} lang={lang} now={now} />
          <ForYouSection data={data} t={t} lang={lang} now={now} />
        </div>
        <div className="grid min-w-0 gap-10">
          <Activity feed={data.feed} t={t} lang={lang} />
          <Earnings data={data} t={t} lang={lang} />
        </div>
      </div>
    </>
  );
}
