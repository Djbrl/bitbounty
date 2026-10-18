"use client";

import { useMemo, useState } from "react";
import { Button, Chip, EmptyState } from "../ui";
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
          <h2 className="text-[1.6rem] font-extrabold tracking-tight">Paid issues</h2>
          <p className="text-[13px] text-muted">Funded and waiting for a developer. Paid to mobile money.</p>
        </div>
        {bounties.length > 0 && (
          <div role="group" aria-label="Filter bounties" className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <Chip key={f.id} selected={f.id === active} onClick={() => setActive(f.id)}>
                {f.label}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {bounties.length === 0 ? (
        <EmptyState title="No funded issues right now" align="start">
          New bounties show up here as soon as a maintainer funds them.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No bounty matches this filter"
          align="start"
          action={
            <Button variant="ghost" size="sm" onClick={() => setActive("all")}>
              Show all {bounties.length}
            </Button>
          }
        >
          Try another filter, or see them all.
        </EmptyState>
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
