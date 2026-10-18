import type { ReactNode } from "react";
import { cx } from "./tone";

export interface PhoneFrameProps {
  children: ReactNode;
  /** Status-bar time. */
  time?: string;
  /** Dark gradient lock screen (for the payout notification shot). */
  lock?: boolean;
  /**
   * false (default): fixed 270x560 mockup, as in the build kit.
   * true: on a real phone the bezel disappears and the screen fills the width; bezel from `sm:` up.
   * Use fluid for real developer pages (W4), fixed for illustrations.
   */
  fluid?: boolean;
  className?: string;
}

/** Phone mockup from the build kit (bezel, status bar, padded body). Screen colours follow the theme. */
export function PhoneFrame({ children, time = "9:41", lock = false, fluid = false, className }: PhoneFrameProps) {
  return (
    <div
      data-phone-frame={fluid ? "fluid" : "fixed"}
      className={cx(
        fluid
          ? "w-full sm:h-[700px] sm:w-[340px] sm:rounded-[var(--radius-phone)] sm:bg-[#1c2b24] sm:p-2.5 sm:shadow-[0_12px_30px_rgb(0_0_0/0.18)]"
          : "h-[560px] w-[270px] shrink-0 rounded-[var(--radius-phone)] bg-[#1c2b24] p-2.5 shadow-[0_12px_30px_rgb(0_0_0/0.18)]",
        className,
      )}
    >
      <div
        className={cx(
          "flex h-full w-full flex-col overflow-hidden",
          fluid ? "min-h-[560px] sm:min-h-0 sm:rounded-[30px]" : "rounded-[30px]",
          lock ? "bg-[radial-gradient(120%_80%_at_50%_0%,#1e5c3e_0%,#0b1f17_55%,#050806_100%)] text-on-forest" : "bg-sheet text-ink",
        )}
      >
        <div className="flex justify-between px-[22px] pb-1 pt-2.5 text-xs font-semibold" aria-hidden>
          <span>{time}</span>
          <span className="tracking-tighter">●●● ▮</span>
        </div>
        <div className="flex flex-1 flex-col gap-3 px-[18px] pb-[18px] pt-2.5">{children}</div>
      </div>
    </div>
  );
}

export interface PhoneNotificationProps {
  title: ReactNode;
  body: ReactNode;
  icon?: ReactNode;
}

/** iOS-style push notification ("Blink · You received 16 180 sats"). Fixed light look, like the real OS. */
export function PhoneNotification({ title, body, icon = "W" }: PhoneNotificationProps) {
  return (
    <div className="grid grid-cols-[30px_1fr] gap-2.5 rounded-2xl bg-[#f4f5f1]/95 p-2.5 text-forest shadow-[0_6px_18px_rgb(0_0_0/0.18)]">
      <i className="grid size-[30px] place-items-center rounded-lg bg-[#167a45] text-[13px] font-extrabold not-italic text-white">
        {icon}
      </i>
      <div className="min-w-0">
        <b className="text-[12.5px]">{title}</b>
        <p className="text-xs leading-snug text-[#2c4337]">{body}</p>
      </div>
    </div>
  );
}
