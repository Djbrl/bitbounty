import type { ButtonHTMLAttributes } from "react";
import { cx } from "./tone";

/**
 * primary = landing green pill, secondary = hairline pill, ghost = landing text link ("Publier une bounty ›"),
 * dark = landing ink pill ("Installer"), danger = destructive.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "dark" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** Full width (phone CTAs). */
  block?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-money text-on-solid hover:bg-money-strong disabled:bg-chip disabled:text-muted",
  secondary: "border border-rule bg-sheet text-ink hover:border-ink disabled:border-rule disabled:text-muted",
  ghost: "text-money hover:bg-money-soft disabled:bg-transparent disabled:text-muted",
  dark: "bg-ink text-paper hover:opacity-85 disabled:bg-chip disabled:text-muted disabled:opacity-100",
  danger: "bg-danger text-on-solid hover:brightness-110 disabled:bg-chip disabled:text-muted",
};

const SIZE = {
  sm: "px-3.5 py-1.5 text-[13px]",
  md: "px-[18px] py-2 text-sm",
  lg: "px-[22px] py-3 text-base",
} as const;

/** Pill button. Use `buttonClass()` to style a Next <Link> or <a> the same way. */
export function Button({ variant = "primary", size = "md", block = false, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, block, className })} {...rest} />;
}

export function buttonClass({
  variant = "primary",
  size = "md",
  block = false,
  className,
}: Pick<ButtonProps, "variant" | "size" | "block" | "className"> = {}): string {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed",
    VARIANT[variant],
    SIZE[size],
    block && "w-full",
    className,
  );
}
