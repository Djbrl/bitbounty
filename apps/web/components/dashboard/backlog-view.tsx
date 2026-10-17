// Presentational parts of "Price my backlog" (no state, no router): rendered by PriceMyBacklog, tested directly.
import type { BacklogSuggestion } from "../../../../fixtures/types";
import { Button, formatXof, Pill, Table, TBody, Td, Th, THead, Tr, type Tone } from "../ui";
import { fundLabel, type SelectionSummary } from "./shape";

const CONFIDENCE: Record<BacklogSuggestion["confidence"], { tone: Tone; label: string }> = {
  high: { tone: "money", label: "Clear" },
  medium: { tone: "claim", label: "Check criteria" },
  low: { tone: "pending", label: "Split first" },
};

export interface BacklogTableProps {
  backlog: BacklogSuggestion[];
  selected: string[];
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  disabled?: boolean;
}

export function BacklogTable({ backlog, selected, onToggle, onToggleAll, disabled = false }: BacklogTableProps) {
  if (!backlog.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-rule bg-sheet p-6 text-center text-sm text-muted">
        No suggestions yet. Claude found no issue clear and testable enough to price. Try <b>Re-scan</b> after
        tidying a few issues.
      </div>
    );
  }
  const ids = new Set(selected);
  const all = selected.length === backlog.length;
  return (
    <Table className="min-w-[560px] text-[13px]">
      <THead>
        <tr>
          <Th className="w-10">
            <input
              type="checkbox"
              aria-label={all ? "Clear selection" : "Select all suggestions"}
              checked={all}
              disabled={disabled}
              onChange={() => onToggleAll?.()}
              className="size-4 accent-money"
            />
          </Th>
          <Th>Issue</Th>
          <Th>Why it fits</Th>
          <Th className="text-right">Suggested</Th>
        </tr>
      </THead>
      <TBody>
        {backlog.map((s) => {
          const on = ids.has(s.id);
          const conf = CONFIDENCE[s.confidence];
          const inputId = `sug-${s.id}`;
          return (
            <Tr key={s.id} selected={on} data-suggestion={s.id}>
              <Td>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={() => onToggle?.(s.id)}
                  className="mt-0.5 size-4 accent-money"
                />
              </Td>
              <Td>
                <label htmlFor={inputId} className="grid cursor-pointer gap-0.5">
                  <b className="font-semibold">
                    #{s.issueNumber} {s.issueTitle}
                  </b>
                  <span className="text-muted">
                    {s.criteria.length} {s.criteria.length === 1 ? "criterion" : "criteria"} drafted ·{" "}
                    <span className="font-mono text-[0.78rem]">{s.repoFullName}</span>
                  </span>
                </label>
              </Td>
              <Td className="min-w-[200px] text-muted">
                <span className="grid justify-items-start gap-1.5">
                  {s.reason}
                  <Pill tone={conf.tone} size="sm">
                    {conf.label}
                  </Pill>
                </span>
              </Td>
              <Td numeric className="whitespace-nowrap font-bold">
                {formatXof(s.priceXof)}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

export interface FundBarProps {
  summary: SelectionSummary;
  pending?: boolean;
  error?: string | null;
  onFund?: () => void;
}

/** Sticky dark bar at the bottom of the viewport: selected count, totals, "Fund N bounties". */
export function FundBar({ summary, pending = false, error, onFund }: FundBarProps) {
  const empty = summary.count === 0;
  return (
    <div
      role="region"
      aria-label="Selected bounties"
      className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-ink px-4 py-3 text-[13.5px] text-paper shadow-lg"
    >
      <span aria-live="polite" className="min-w-0">
        {empty ? (
          <>Select at least one suggestion to fund it.</>
        ) : (
          <>
            <b>{summary.count} selected</b> · developers receive{" "}
            <b className="tabular-nums">{formatXof(summary.amountXof)}</b> · you pay{" "}
            <b className="tabular-nums">{formatXof(summary.totalXof)}</b> incl. 5% fee
          </>
        )}
        {error && <span className="mt-1 block text-danger-soft">Could not start the payment ({error}). Try again.</span>}
      </span>
      <Button
        onClick={onFund}
        disabled={empty || pending}
        className="shrink-0"
        aria-busy={pending || undefined}
      >
        {pending ? "Opening payment…" : fundLabel(summary.count)}
      </Button>
    </div>
  );
}
