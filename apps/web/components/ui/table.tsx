import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./tone";

/** Bordered, horizontally scrollable wrapper + table. Use with THead/TBody/Tr/Th/Td. */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-rule bg-sheet">
      <table className={cx("w-full border-collapse text-sm", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="[&>tr:last-child>td]:border-b-0">{children}</tbody>;
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Highlight a selected row (e.g. ticked backlog suggestion). */
  selected?: boolean;
}

export function Tr({ selected = false, className, ...rest }: TrProps) {
  return <tr aria-selected={selected || undefined} className={cx(selected && "bg-money-soft", className)} {...rest} />;
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx(
        "whitespace-nowrap border-b border-rule px-3 py-2.5 text-left text-xs font-semibold text-muted",
        className,
      )}
      {...rest}
    />
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Right-aligned tabular numbers (amounts). */
  numeric?: boolean;
  /** Mono muted text (dates, ids). */
  mono?: boolean;
}

export function Td({ numeric = false, mono = false, className, ...rest }: TdProps) {
  return (
    <td
      className={cx(
        "border-b border-rule px-3 py-2.5 align-top",
        numeric && "text-right tabular-nums",
        mono && "whitespace-nowrap font-mono text-[0.82rem] text-muted",
        className,
      )}
      {...rest}
    />
  );
}
