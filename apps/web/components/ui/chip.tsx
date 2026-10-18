import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./tone";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /**
   * Toggle state. When set (true or false) or when `onClick` is passed, the chip is a <button aria-pressed>;
   * otherwise it is a plain <span> label.
   */
  selected?: boolean;
  /** Leading icon or emoji. */
  icon?: ReactNode;
  size?: "sm" | "md";
  children: ReactNode;
}

const SIZE = { sm: "px-2.5 py-[3px] text-[12px]", md: "px-[11px] py-[5px] text-[13px]" } as const;

/** Rounded chip (landing `.chips span`): filters, languages / stack, toggles. Selected = ink fill. */
export function Chip({ selected, icon, size = "md", className, children, type = "button", ...rest }: ChipProps) {
  const classes = cx(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full leading-tight",
    SIZE[size],
    selected ? "bg-ink text-paper" : "bg-chip text-ink",
    className,
  );
  if (selected === undefined && !rest.onClick) {
    return (
      <span className={classes}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      type={type}
      aria-pressed={!!selected}
      className={cx(classes, "transition disabled:cursor-not-allowed disabled:opacity-50", !selected && "hover:bg-rule")}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
