// L1: `?intent=` from the landing CTAs. Anything else is ignored (no intent: show both choices).
export type WelcomeIntent = "maintain" | "hunt" | null;

export function parseIntent(raw: string | string[] | undefined): WelcomeIntent {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "maintain" || v === "hunt" ? v : null;
}
