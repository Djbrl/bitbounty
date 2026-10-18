"use client";

import { useEffect, useState } from "react";
import { Avatar, cx, Dot, Eyebrow, formatXof } from "../ui";
import { initialLiveState, onSnapshot, onTransition, type LiveEvent, type LiveState, type PayoutRow } from "./shape";

export interface LivePayoutsProps {
  initial: PayoutRow[];
  issues: Record<string, number>;
  /** SSE endpoint; `/api/live` is the F4 mock (I1: the real server). */
  src?: string;
}

/** Right column: payouts streaming in over SSE (`/api/live`). */
export function LivePayouts({ initial, issues, src = "/api/live" }: LivePayoutsProps) {
  const [state, setState] = useState<LiveState>(() => initialLiveState(initial));
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(src);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("snapshot", (e) => {
      setConnected(true);
      setState((s) => onSnapshot(s, JSON.parse((e as MessageEvent<string>).data)));
    });
    es.addEventListener("transition", (e) => {
      const ev = JSON.parse((e as MessageEvent<string>).data) as LiveEvent;
      setState((s) => onTransition(s, ev, issues));
    });
    return () => es.close();
  }, [src, issues]);

  return (
    <aside
      aria-label="Live payouts"
      className="grid min-w-0 content-start gap-2.5 rounded-[var(--radius-card)] border border-rule bg-sheet p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Live payouts</Eyebrow>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <Dot tone={connected ? "money" : "neutral"} pulse={connected} />
          {connected ? "live" : "connecting"}
        </span>
      </div>
      {state.payouts.length === 0 ? (
        <p className="text-[12.5px] text-muted">No payouts yet. They appear here the moment they land.</p>
      ) : (
        <ul className="grid gap-2.5" aria-live="polite">
          {state.payouts.map((p) => (
            <PayoutItem key={p.bountyId} p={p} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function PayoutItem({ p }: { p: PayoutRow }) {
  const repo = p.repoFullName.split("/")[1] ?? p.repoFullName;
  return (
    <li
      className={cx(
        "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg text-[12.5px] transition-colors",
        p.fresh && "-mx-1.5 bg-money-soft px-1.5 py-1",
      )}
    >
      <Avatar initials={p.login.slice(0, 1)} size="sm" />
      <span className="min-w-0">
        <b className="font-semibold">@{p.login}</b> · {p.via}
        <br />
        <span className="text-muted">
          {repo}
          {p.issueNumber != null && ` #${p.issueNumber}`}
        </span>
        {p.note && <span className="block truncate text-[11.5px] text-muted">{p.note}</span>}
      </span>
      <span className="font-bold tabular-nums text-money">+{formatXof(p.amountXof).replace(/\s?F$/, "")}</span>
    </li>
  );
}
