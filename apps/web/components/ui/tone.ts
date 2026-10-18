/**
 * Semantic colour families shared by Pill, StatusPill and Dot.
 * Soft tones are a tinted background with strong text; solid tones copy the landing's tags
 * (amber "awaiting", green-bright "paying", ink, green "paid"); outline is a hairline only.
 */
export type Tone =
  | "neutral"
  | "outline"
  | "money"
  | "money-solid"
  | "bright"
  | "pending"
  | "amber"
  | "claim"
  | "claim-solid"
  | "danger"
  | "agent"
  | "ink";

export const TONES: readonly Tone[] = [
  "neutral",
  "outline",
  "money",
  "money-solid",
  "bright",
  "pending",
  "amber",
  "claim",
  "claim-solid",
  "danger",
  "agent",
  "ink",
];

/** Background + text (+ border for outline), readable in light and dark. */
export const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-chip text-ink-soft",
  outline: "border border-rule text-muted",
  money: "bg-money-soft text-money",
  "money-solid": "bg-money text-on-solid",
  bright: "bg-bright text-forest",
  pending: "bg-pending-soft text-pending",
  amber: "bg-amber text-on-amber",
  claim: "bg-claim-soft text-claim",
  "claim-solid": "bg-claim text-on-solid",
  danger: "bg-danger-soft text-danger",
  // U8: agent-funded is a neutral ink chip, so it never reads as the purple "claimed" pill.
  agent: "bg-chip text-ink",
  ink: "bg-ink text-paper",
};

/** Solid colour for standalone dots and accents. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted",
  outline: "bg-muted",
  money: "bg-money",
  "money-solid": "bg-money",
  bright: "bg-bright",
  pending: "bg-pending",
  amber: "bg-amber",
  claim: "bg-claim",
  "claim-solid": "bg-claim",
  danger: "bg-danger",
  agent: "bg-ink",
  ink: "bg-ink",
};

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
