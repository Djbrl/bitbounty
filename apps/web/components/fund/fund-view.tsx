"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Button, Card, Dot, Pill, buttonClass, cx, formatXof } from "../ui";
import { FundApiError, createFunding, pollFunding } from "./api";
import { CopyButton } from "./copy-button";
import type { BountyStatus, FundBounty, FundingRail, FundingSession } from "./data";
import { RAIL_META, formatCountdown, groupAccountNumber, msLeft, sourceAmount, sourceAmountRaw } from "./format";
import { QrCode } from "./qr-code";
import { errorMessage, fundReducer, initialFundState, needsSession } from "./state";
import { SummaryCard } from "./summary-card";

/** Status poll interval (the mock answers `paid` on the 3rd poll). */
export const POLL_MS = 2000;

export interface FundViewProps {
  bounty: FundBounty;
}

export function FundView({ bounty }: FundViewProps) {
  const [state, dispatch] = useReducer(fundReducer, bounty.status !== "unfunded", initialFundState);
  // `null` until mounted: the countdown only renders client-side (no hydration drift).
  const [now, setNow] = useState<number | null>(null);
  const polling = useRef(false);
  const session = state.sessions[state.rail] ?? null;
  const hasSession = Object.keys(state.sessions).length > 0;

  // 1 s clock for the countdown and expiry.
  useEffect(() => {
    if (state.phase !== "paying") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);

  // Create (or refresh on expiry) the session for the current tab.
  useEffect(() => {
    if (now == null || !needsSession(state, now)) return;
    const rail = state.rail;
    dispatch({ type: "request", rail });
    createFunding(bounty.id, rail).then(
      (session) => dispatch({ type: "session", session }),
      (e: unknown) => {
        if (e instanceof FundApiError && e.code === "already_funded") dispatch({ type: "paid" });
        else dispatch({ type: "error", rail, error: errorMessage(e instanceof FundApiError ? e.code : "network") });
      },
    );
  }, [now, state, bounty.id]);

  // Poll the funding status every 2 s once something can be paid.
  useEffect(() => {
    if (state.phase !== "paying" || !hasSession) return;
    const t = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      pollFunding(bounty.id)
        .then((r) => r.status === "paid" && dispatch({ type: "paid" }))
        .catch(() => {}) // transient: next tick retries
        .finally(() => (polling.current = false));
    }, POLL_MS);
    return () => clearInterval(t);
  }, [state.phase, hasSession, bounty.id]);

  const fundedSession = session ?? Object.values(state.sessions)[0] ?? null;
  const outcome = fundOutcome(bounty.status);
  const closed = outcome === "cancelled" || outcome === "refunded";

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">
            {state.phase !== "funded" ? "Fund this bounty" : (CLOSED_COPY[outcome]?.title ?? "Bounty funded")}
          </h1>
          <PayState state={closed ? "closed" : payState(state.phase, state.error, session, now)} />
        </div>
        {state.phase === "funded" ? (
          <FundedPanel bounty={bounty} outcome={outcome} />
        ) : (
          <>
            <RailTabs rail={state.rail} onSelect={(rail) => dispatch({ type: "select", rail })} />
            <div role="tabpanel" id={`fund-panel-${state.rail}`} aria-labelledby={`fund-tab-${state.rail}`}>
              {session && now != null && msLeft(session.expiresAt, now) > 0 ? (
                <RailPanel session={session} now={now} />
              ) : (
                <Card padding="lg" className="grid min-h-[200px] place-items-center gap-3 text-center text-sm text-muted">
                  {state.error ? (
                    <>
                      <p className="text-danger">{state.error}</p>
                      <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "select", rail: state.rail })}>
                        Try again
                      </Button>
                    </>
                  ) : (
                    <p>
                      <Dot tone="pending" pulse /> {session ? "Expired, getting a fresh one…" : "Preparing your payment details…"}
                    </p>
                  )}
                </Card>
              )}
            </div>
          </>
        )}
      </div>
      <SummaryCard bounty={bounty} session={fundedSession} sats={state.sats} />
    </div>
  );
}

export type PayStateKey = "preparing" | "waiting" | "expired" | "error" | "paid" | "closed";

/** U5: the one state the payer needs to read at a glance. */
export function payState(phase: string, error: string | null, session: FundingSession | null, now: number | null): PayStateKey {
  if (phase === "funded") return "paid";
  if (error) return "error";
  if (!session || now == null) return "preparing";
  return msLeft(session.expiresAt, now) > 0 ? "waiting" : "expired";
}

const PAY_STATE = {
  preparing: { tone: "neutral", label: "Preparing", pulse: true },
  waiting: { tone: "pending", label: "Waiting for payment", pulse: true },
  expired: { tone: "pending", label: "Expired · refreshing", pulse: false },
  error: { tone: "danger", label: "Not available", pulse: false },
  paid: { tone: "money-solid", label: "Paid", pulse: false },
  closed: { tone: "neutral", label: "Clôturée", pulse: false },
} as const;

/**
 * CR6: what the panel after funding may truthfully say. `unfunded` only reaches it when the
 * payment just landed in this session, so it reads as `open`.
 */
export type FundOutcome = "open" | "in_progress" | "paid" | "cancelled" | "refunded";

export function fundOutcome(status: BountyStatus): FundOutcome {
  if (status === "paid" || status === "cancelled" || status === "refunded") return status;
  return status === "unfunded" || status === "funded" ? "open" : "in_progress";
}

/** Terminal states: short French copy, no "held by Bitnob" and no /claim. */
const CLOSED_COPY: Partial<Record<FundOutcome, { title: string; text: (b: FundBounty) => string }>> = {
  paid: {
    title: "Prime payée",
    text: (b) => `Cette prime est terminée : ${formatXof(b.amountXof)} ont été versés au développeur. Il n'y a plus rien à financer.`,
  },
  cancelled: {
    title: "Prime annulée",
    text: () => "Cette prime a été annulée avant d'être financée. Il n'y a rien à payer.",
  },
  refunded: {
    title: "Prime remboursée",
    text: (b) => `Cette prime a été annulée et ${formatXof(b.amountXof)} ont été remboursés au financeur. Elle ne peut plus être réclamée.`,
  },
};

function PayState({ state }: { state: PayStateKey }) {
  const m = PAY_STATE[state];
  return (
    <Pill tone={m.tone} data-pay-state={state} role="status">
      <Dot pulse={m.pulse} className="bg-current" />
      {m.label}
    </Pill>
  );
}

function RailTabs({ rail, onSelect }: { rail: FundingRail; onSelect: (r: FundingRail) => void }) {
  return (
    <div role="tablist" aria-label="Payment method" className="grid grid-cols-3 gap-2">
      {RAIL_META.map((m) => {
        const on = m.rail === rail;
        return (
          <button
            key={m.rail}
            type="button"
            role="tab"
            id={`fund-tab-${m.rail}`}
            aria-selected={on}
            aria-controls={`fund-panel-${m.rail}`}
            onClick={() => onSelect(m.rail)}
            className={cx(
              "grid min-w-0 gap-0.5 rounded-[10px] border px-3 py-2.5 text-left text-[12.5px] transition",
              on ? "border-[1.5px] border-money bg-money-soft" : "border-rule bg-sheet hover:bg-chip",
            )}
          >
            <b className="text-[13.5px]">{m.label}</b>
            <span className="text-muted">{m.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function Countdown({ session, now }: { session: FundingSession; now: number }) {
  return (
    <span className="font-mono text-[13px] font-semibold text-pending" role="timer" aria-label="Time left before this expires">
      ⏱ {formatCountdown(msLeft(session.expiresAt, now))} · refreshes on expiry
    </span>
  );
}

function Waiting() {
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-muted" aria-live="polite">
      <Dot tone="pending" pulse /> Waiting for payment… this page updates by itself.
    </p>
  );
}

function Mono({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="break-all rounded-md bg-chip px-2.5 py-2 font-mono text-xs leading-relaxed text-ink">
      {children}
    </div>
  );
}

function RailPanel({ session, now }: { session: FundingSession; now: number }) {
  if (session.rail === "ngn") {
    const va = session.virtualAccount;
    return (
      <Card padding="lg" className="grid gap-4">
        <div className="grid gap-1">
          <span className="font-display text-[1.7rem] font-extrabold leading-tight tabular-nums">{sourceAmount(session)}</span>
          <span className="text-sm text-muted">
            Bank transfer to your own account number: deposits are matched to this bounty automatically.
          </span>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-5">
          <dt className="text-muted">Bank</dt>
          <dd className="font-semibold">{va.bankName}</dd>
          <dt className="text-muted">Account number</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span id="fund-ngn-account" className="font-mono text-base font-semibold tabular-nums">
              {groupAccountNumber(va.accountNumber)}
            </span>
            <CopyButton value={va.accountNumber} label="Copy number" targetId="fund-ngn-account" />
          </dd>
          <dt className="text-muted">Account name</dt>
          <dd className="break-words font-semibold">{va.accountName}</dd>
          <dt className="text-muted">Amount</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span id="fund-ngn-amount" className="font-semibold tabular-nums">
              {sourceAmount(session)}
            </span>
            <CopyButton value={sourceAmountRaw(session)} label="Copy amount" targetId="fund-ngn-amount" />
          </dd>
        </dl>
        <Countdown session={session} now={now} />
        <Waiting />
      </Card>
    );
  }

  const ln = session.rail === "lightning";
  const value = ln ? session.invoice : session.address;
  return (
    <Card padding="lg" className="grid items-center justify-items-center gap-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:justify-items-stretch">
      <QrCode value={value} label={ln ? "Lightning invoice QR code" : "USDT deposit address QR code"} className="sm:max-w-none" />
      <div className="grid w-full min-w-0 gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-[1.7rem] font-extrabold leading-tight tabular-nums">{sourceAmount(session)}</span>
          {!ln && <Pill size="sm">{session.network}</Pill>}
        </div>
        <Mono id={ln ? "fund-invoice" : "fund-address"}>{value}</Mono>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={value} label={ln ? "Copy invoice" : "Copy address"} targetId={ln ? "fund-invoice" : "fund-address"} />
          {ln ? (
            <a href={`lightning:${session.invoice}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              Open in wallet
            </a>
          ) : (
            <CopyButton value={sourceAmountRaw(session)} label="Copy amount" />
          )}
        </div>
        {!ln && <p className="text-[12.5px] text-muted">Send exactly this amount on {session.network}. Other networks are lost.</p>}
        <Countdown session={session} now={now} />
        <Waiting />
      </div>
    </Card>
  );
}

function FundedPanel({ bounty, outcome }: { bounty: FundBounty; outcome: FundOutcome }) {
  const issue = `${bounty.repoFullName} #${bounty.issueNumber}`;
  const closed = CLOSED_COPY[outcome];
  if (closed) {
    return (
      <Card padding="lg" className="grid justify-items-start gap-3" role="status" data-fund-outcome={outcome}>
        <b className="font-display text-[1.7rem] font-extrabold leading-tight">{closed.title}</b>
        <p className="text-sm text-muted">
          {issue} · {closed.text(bounty)}
        </p>
        <Link href={`/b/${bounty.id}`} className={buttonClass({ size: "sm" })}>
          Voir la prime
        </Link>
      </Card>
    );
  }
  return (
    <Card
      padding="lg"
      className="grid justify-items-start gap-3 border-money"
      role="status"
      aria-live="polite"
      data-fund-outcome={outcome}
    >
      <span className="grid size-12 place-items-center rounded-full bg-money text-2xl text-on-solid" aria-hidden>
        ✓
      </span>
      <b className="font-display text-[1.7rem] font-extrabold leading-tight text-money">Funded</b>
      <p className="text-sm text-muted">
        {formatXof(bounty.amountXof)} is held by Bitnob for {issue}.{" "}
        {outcome === "open" ? (
          <>
            The bot updates the status comment on the issue; anyone can now <span className="font-mono text-ink">/claim</span> it.
          </>
        ) : (
          "Someone is already working on it: follow the progress on the bounty page."
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={`/b/${bounty.id}`} className={buttonClass({ size: "sm" })}>
          View the bounty
        </Link>
        <Link href="/dashboard" className={buttonClass({ variant: "secondary", size: "sm" })}>
          Back to dashboard
        </Link>
      </div>
    </Card>
  );
}
