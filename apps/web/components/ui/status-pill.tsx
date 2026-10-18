import type { BountyStatus } from "@bitbounty/core";
import { Pill } from "./pill";
import { STATUS_META } from "./status";

export interface StatusPillProps {
  status: BountyStatus;
  /** "en" for maintainer pages, "fr" for developer pages. */
  lang?: "en" | "fr";
  size?: "sm" | "md";
  className?: string;
}

/** Bounty status pill. Colour and label come from STATUS_META (one distinct colour per F2 status). */
export function StatusPill({ status, lang = "en", size = "md", className }: StatusPillProps) {
  const meta = STATUS_META[status];
  return (
    <Pill
      tone={meta.tone}
      dot
      size={size}
      title={meta.hint}
      data-status={status}
      data-tone={meta.tone}
      className={className}
    >
      {lang === "fr" ? meta.labelFr : meta.label}
    </Pill>
  );
}

/** @deprecated W1 name, kept so open branches keep compiling. Use StatusPill. */
export const StatusBadge = StatusPill;
