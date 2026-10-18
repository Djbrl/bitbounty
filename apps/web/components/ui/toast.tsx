import type { ReactNode } from "react";
import { cx } from "./tone";

export type ToastTone = "info" | "success" | "error";

export interface ToastProps {
  tone?: ToastTone;
  title: ReactNode;
  /** Optional second line. */
  children?: ReactNode;
  /** A small link or button ("View receipt"). */
  action?: ReactNode;
  /** Shows a close button when set. */
  onClose?: () => void;
  className?: string;
}

const ICON: Record<ToastTone, { mark: string; className: string }> = {
  info: { mark: "i", className: "bg-line-dark text-mint" },
  success: { mark: "✓", className: "bg-money-bright text-forest" },
  error: { mark: "!", className: "bg-danger text-on-solid" },
};

/**
 * Notification card in the landing's dark `.notif` style (forest card in both themes, coloured icon tile).
 * Errors are announced as alerts, the rest politely. Show it through `useToast()` (toaster.tsx) or inline.
 */
export function Toast({ tone = "info", title, children, action, onClose, className }: ToastProps) {
  const icon = ICON[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-tone={tone}
      className={cx(
        "flex w-full max-w-sm items-start gap-3 rounded-[18px] border border-line-dark bg-forest p-3 text-[13.5px] leading-snug text-on-forest shadow-[0_18px_40px_rgb(11_31_23/0.18)]",
        className,
      )}
    >
      <i aria-hidden className={cx("grid size-[34px] shrink-0 place-items-center rounded-[9px] font-extrabold not-italic", icon.className)}>
        {icon.mark}
      </i>
      <div className="grid min-w-0 flex-1 gap-0.5 py-0.5">
        <b className="font-semibold">{title}</b>
        {children && <span className="opacity-75">{children}</span>}
        {action && <div className="mt-1 font-semibold text-money-bright">{action}</div>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="-m-1 rounded-full p-1 leading-none opacity-60 hover:opacity-100">
          ✕
        </button>
      )}
    </div>
  );
}
