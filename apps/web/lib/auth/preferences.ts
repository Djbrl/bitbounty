// L1: the server copy of the onboarding fields (GET|PUT /api/me/preferences, docs/api.md), so a
// returning user is recognised on any device. Without BITBOUNTY_API_URL (fixtures) there is no
// server copy: the fields live in the session cookie only.
import type { UserPreferences, WorkspaceMode } from "@bitbounty/core";
import { apiBaseUrl, identityHeaders } from "../api";
import { NOT_ONBOARDED, preferencesFrom } from "./workspace";

type Env = Record<string, string | undefined>;

async function call(login: string, init: RequestInit, env: Env, fetchImpl: typeof fetch): Promise<UserPreferences | null> {
  const base = apiBaseUrl(env);
  const headers = identityHeaders(login, env);
  if (!base || !headers.authorization) return null;
  try {
    const res = await fetchImpl(`${base}/api/me/preferences`, {
      ...init,
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", ...headers },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return preferencesFrom((await res.json()) as Record<string, unknown>);
  } catch (err) {
    console.warn("[auth] /api/me/preferences failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** At sign-in: what the server knows. Not onboarded when there is no server or it fails (they see /welcome again). */
export async function fetchPreferences(login: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<UserPreferences> {
  return (await call(login, { method: "GET" }, env, fetchImpl)) ?? NOT_ONBOARDED;
}

/** From /welcome (and later /settings): stores the mode; the server stamps onboardedAt once. Null = not stored. */
export function savePreferences(
  login: string,
  defaultMode: WorkspaceMode,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<UserPreferences | null> {
  return call(login, { method: "PUT", body: JSON.stringify({ defaultMode }) }, env, fetchImpl);
}
