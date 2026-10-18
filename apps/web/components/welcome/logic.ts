// U1: pure logic for the /welcome onboarding (steps, role → mode, stack chips, where to go after).
// No React, no fetch: unit-tested in welcome.test.tsx.
import type { DisplayCurrency, OnboardingRole, OnboardingState, UserMode } from "../../../../fixtures/types";

export const STEP_COUNT = 3;
export type Step = 1 | 2 | 3;

/** `?step=` from the URL (reload resumes there), else the step saved on the server, else 1. */
export function initialStep(raw: string | string[] | undefined, saved: number | undefined): Step {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  if (Number.isInteger(v) && v >= 1 && v <= STEP_COUNT) return v as Step;
  return saved && Number.isInteger(saved) && saved >= 1 && saved <= STEP_COUNT ? (saved as Step) : 1;
}

/** Role pre-selected on step 1: what was saved, else `?intent=` from the landing CTA, else none. */
export function initialRole(saved: OnboardingRole | null, intent: UserMode | null): OnboardingRole | null {
  return saved ?? intent;
}

/** `defaultMode` saved for a role. "Both" opens the workspace of the CTA they came from, hunter otherwise. */
export function modeForRole(role: OnboardingRole, intent: UserMode | null): UserMode {
  return role === "both" ? (intent ?? "hunt") : role;
}

export const showsHunter = (role: OnboardingRole | null) => role !== "maintain";
export const showsMaintainer = (role: OnboardingRole | null) => role === "maintain" || role === "both";

/**
 * Where the user lands once onboarded.
 * TODO(U2): `/app` (U2) isn't on main yet; switch both to "/app" once it lands (it redirects to
 * /app/hunt or /app/maintain from defaultMode).
 */
export function workspaceHref(mode: UserMode | null): string {
  return mode === "maintain" ? "/dashboard" : "/me";
}

/** Common stacks offered next to the user's GitHub languages. */
export const STACK_SUGGESTIONS = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "Kotlin",
  "Swift",
  "PHP",
  "Ruby",
  "Dart",
  "C#",
  "React",
  "Next.js",
  "Node.js",
  "Flutter",
  "Django",
  "Laravel",
  "SQL",
  "Docs",
];

/** Chips shown on step 2: GitHub languages first, then what was saved, then suggestions (no duplicates). */
export function stackOptions(githubLanguages: string[], saved: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...githubLanguages, ...saved, ...STACK_SUGGESTIONS]) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Selected chips at first: what was saved, else the GitHub languages (pre-filled), else nothing. */
export function initialStack(state: Pick<OnboardingState, "preferences" | "githubLanguages">): string[] {
  return state.preferences.stack.length ? state.preferences.stack : state.githubLanguages;
}

export function toggle(list: string[], item: string): string[] {
  return list.some((x) => x.toLowerCase() === item.toLowerCase()) ? list.filter((x) => x.toLowerCase() !== item.toLowerCase()) : [...list, item];
}

export const CURRENCIES: { id: DisplayCurrency; label: string }[] = [
  { id: "xof", label: "FCFA" },
  { id: "ngn", label: "Naira (₦)" },
  { id: "sats", label: "sats" },
];

export const LANGUAGES: { id: "fr" | "en"; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "en", label: "English" },
];

/** Sample bounty for the live preview: 10 000 FCFA, paid 16 180 sats (fixtures r-107), funded ₦29 000. */
export const PREVIEW_AMOUNT = { xof: 10_000, sats: 16_180, ngn: 29_000 };

/** "Fund a first bounty": the repo's issues on GitHub, where `/bounty <amount>` is typed. */
export const issuesHref = (repo: string) => `https://github.com/${repo}/issues`;

export const SAVE_ERROR_FR = "Impossible d'enregistrer pour l'instant. Réessaie dans un instant.";
