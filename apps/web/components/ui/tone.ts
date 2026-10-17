/** Semantic colour families shared by Pill, StatusBadge and Dot. */
export type Tone = "neutral" | "money" | "money-solid" | "pending" | "claim" | "danger" | "agent" | "ink";

export const TONES: readonly Tone[] = ["neutral", "money", "money-solid", "pending", "claim", "danger", "agent", "ink"];

/** Soft background + strong text, readable in light and dark. */
export const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-chip text-muted",
  money: "bg-money-soft text-money",
  "money-solid": "bg-money text-on-solid",
  pending: "bg-pending-soft text-pending",
  claim: "bg-claim-soft text-claim",
  danger: "bg-danger-soft text-danger",
  agent: "bg-agent-soft text-agent",
  ink: "bg-ink text-paper",
};

/** Solid colour for dots and accents. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted",
  money: "bg-money",
  "money-solid": "bg-money",
  pending: "bg-pending",
  claim: "bg-claim",
  danger: "bg-danger",
  agent: "bg-agent",
  ink: "bg-ink",
};

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
