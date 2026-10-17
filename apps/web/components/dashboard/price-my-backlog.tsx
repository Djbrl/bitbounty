"use client";

// "Price my backlog": tick Claude's suggestions, then fund the batch with one payment.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { BacklogSuggestion } from "../../../../fixtures/types";
import { BacklogTable, FundBar } from "./backlog-view";
import { fundBacklog } from "./fund";
import { initialSelection, payHref, summarizeSelection, toggle, toggleAll } from "./shape";

export function PriceMyBacklog({ backlog }: { backlog: BacklogSuggestion[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => initialSelection(backlog));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => summarizeSelection(backlog, selected), [backlog, selected]);

  async function fund() {
    if (!selected.length || pending) return;
    setPending(true);
    setError(null);
    try {
      const href = payHref(await fundBacklog(selected));
      if (!href) throw new Error("nothing_selected");
      router.push(href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
      setPending(false);
    }
  }

  return (
    <>
      <BacklogTable
        backlog={backlog}
        selected={selected}
        disabled={pending}
        onToggle={(id) => setSelected((s) => toggle(backlog, s, id))}
        onToggleAll={() => setSelected((s) => toggleAll(backlog, s))}
      />
      {backlog.length > 0 && <FundBar summary={summary} pending={pending} error={error} onFund={fund} />}
    </>
  );
}
