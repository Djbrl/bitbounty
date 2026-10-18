// Server only: the signed-in GitHub user, for calls the server answers per user (/api/me, /api/dashboard)
// and (L1) for pages that depend on onboarding (landing CTAs, /start, /app, /welcome).
import type { UserPreferences } from "@bitbounty/core";
import { authEnabled } from "./auth/paths";
import { sessionToUser, type SessionUser } from "./auth/session-user";
import { preferencesFrom } from "./auth/workspace";

export interface SignedIn {
  user: SessionUser;
  preferences: UserPreferences;
}

/** The session user and their onboarding fields; null when signed out, auth is off or the session can't be read. */
export async function sessionUser(): Promise<SignedIn | null> {
  if (!authEnabled()) return null;
  try {
    const { auth } = await import("../auth");
    const session = await auth();
    const user = sessionToUser(session);
    return user ? { user, preferences: preferencesFrom(session?.user) } : null;
  } catch {
    return null;
  }
}

export async function sessionLogin(): Promise<string | null> {
  return (await sessionUser())?.user.login ?? null;
}
