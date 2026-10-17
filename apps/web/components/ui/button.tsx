import type { ButtonHTMLAttributes } from "react";
import { cx } from "./tone";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** Full width (phone CTAs). */
  block?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-money text-on-solid hover:brightness-110 disabled:bg-chip disabled:text-muted",
  secondary: "border border-rule bg-sheet text-ink hover:bg-chip disabled:text-muted",
  ghost: "text-ink hover:bg-chip disabled:text-muted",
  danger: "bg-danger text-on-solid hover:brightness-110 disabled:bg-chip disabled:text-muted",
};

const SIZE = {
  sm: "px-3 py-1.5 text-[13px] rounded-[7px]",
  md: "px-4 py-2 text-sm rounded-lg",
  lg: "px-5 py-3.5 text-[15px] rounded-[14px]",
} as const;

/** Button. Use `buttonClass()` to style a Next <Link> the same way. */
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
    "inline-flex items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed",
    VARIANT[variant],
    SIZE[size],
    block && "w-full",
    className,
  );
}
