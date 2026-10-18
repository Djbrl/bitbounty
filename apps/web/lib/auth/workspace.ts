// L1: where a signed-in user belongs (onboarding or their workspace), from the two onboarding
// fields the session carries. Pure functions (no next-auth import), used by middleware, /start,
// /app and /welcome, and unit-tested on their own.
import { WORKSPACE_MODES, type UserPreferences, type WorkspaceMode } from "@bitbounty/core";

export const WELCOME_PATH = "/welcome";
export const APP_PATH = "/app";

export const NOT_ONBOARDED: UserPreferences = { defaultMode: null, onboardedAt: null };

/** "hunt" | "maintain" from a query param, a form field or a token; anything else → null. */
export function parseMode(raw: unknown): WorkspaceMode | null {
  return WORKSPACE_MODES.includes(raw as WorkspaceMode) ? (raw as WorkspaceMode) : null;
}

/** The onboarding fields of a JWT token or `session.user` (validated; junk → not onboarded). */
export function preferencesFrom(source: { defaultMode?: unknown; onboardedAt?: unknown } | null | undefined): UserPreferences {
  const defaultMode = parseMode(source?.defaultMode);
  const at = source?.onboardedAt;
  const onboardedAt = typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null;
  return defaultMode && onboardedAt ? { defaultMode, onboardedAt } : NOT_ONBOARDED;
}

export const isOnboarded = (p: UserPreferences): p is { defaultMode: WorkspaceMode; onboardedAt: string } =>
  p.defaultMode !== null && p.onboardedAt !== null;

/** `/app/hunt` or `/app/maintain`. */
export const workspacePath = (mode: WorkspaceMode) => `${APP_PATH}/${mode}`;

/** `/welcome?intent=hunt`, or `/welcome` without an intent. */
export function welcomePath(intent: WorkspaceMode | null): string {
  return intent ? `${WELCOME_PATH}?intent=${intent}` : WELCOME_PATH;
}

/** What `/app` opens: the default mode's workspace once onboarded, otherwise onboarding. */
export function appHomePath(p: UserPreferences): string {
  return isOnboarded(p) ? workspacePath(p.defaultMode) : WELCOME_PATH;
}

/** Where a landing CTA sends people after GitHub sign-in: onboarding with the CTA's intent, or `/app`. */
export function startTarget(intent: WorkspaceMode | null): string {
  return intent ? welcomePath(intent) : APP_PATH;
}

/**
 * Middleware rule for a signed-in user: `/app` → their home; `/welcome` once onboarded → their
 * workspace (so a returning user who clicks a landing CTA skips onboarding). Null = stay.
 */
export function onboardingRedirect(pathname: string, p: UserPreferences): string | null {
  if (pathname === APP_PATH || pathname === `${APP_PATH}/`) return appHomePath(p);
  if ((pathname === WELCOME_PATH || pathname.startsWith(`${WELCOME_PATH}/`)) && isOnboarded(p)) return workspacePath(p.defaultMode);
  return null;
}
