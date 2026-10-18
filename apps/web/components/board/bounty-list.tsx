"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cx } from "../ui";
import { BountyRow } from "./bounty-row";
import { applyFilter, boardFilters, type BountySummary } from "./shape";

/** Filter chips + the list of funded issues. */
export function BountyList({ bounties }: { bounties: BountySummary[] }) {
  const filters = useMemo(() => boardFilters(bounties), [bounties]);
  const [active, setActive] = useState("all");
  const rows = applyFilter(bounties, filters, active);

  return (
    <div className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="font-display text-[1.6rem] font-extrabold tracking-tight">Paid issues</h2>
          <p className="text-[13px] text-muted">Funded and waiting for a developer. Paid in sats over Lightning.</p>
        </div>
        {bounties.length > 0 && (
          <div role="group" aria-label="Filter bounties" className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={f.id === active}
                onClick={() => setActive(f.id)}
                className={cx(
                  "rounded-full border px-[11px] py-1 text-[12.5px]",
                  f.id === active ? "border-ink bg-ink text-paper" : "border-rule bg-sheet text-ink hover:border-ink",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {bounties.length === 0 ? (
        <Empty title="No funded issues right now" body="New bounties show up here as soon as a maintainer funds them." />
      ) : rows.length === 0 ? (
        <Empty
          title="No bounty matches this filter"
          body="Try another filter, or see them all."
          action={
            <button type="button" onClick={() => setActive("all")} className="text-sm font-semibold text-money underline">
              Show all {bounties.length}
            </button>
          }
        />
      ) : (
        <ul className="grid gap-2.5">
          {rows.map((b) => (
            <BountyRow key={b.id} b={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-1 rounded-[var(--radius-card)] border border-dashed border-rule bg-sheet px-4 py-6">
      <b className="font-semibold">{title}</b>
      <span className="text-sm text-muted">{body}</span>
      {action}
    </div>
  );
}
