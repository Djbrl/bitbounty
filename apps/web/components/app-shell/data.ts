// U2: server-side data for the /app shell: who is signed in, their saved workspace, whether they
// can open the Maintainer one (an installed repo), and their language. Fixtures mode keeps working.
import { cookies } from "next/headers";
import dashboard from "../../../../fixtures/dashboard.json";
import { apiBaseUrl, identityHeaders, load } from "../../lib/api";
import { authEnabled } from "../../lib/auth/paths";
import { handleMock, type Fixtures } from "../../lib/mock-api";
import { sessionLogin } from "../../lib/session-login";
import { fetchMe } from "../onboarding/load-me";
import { LANG_COOKIE, MODE_COOKIE, parseLang, parseMode, resolveMode, type Lang, type UserMode } from "./mode";
import type { ShellUser } from "./shell";

/** GET /api/me/mode */
export interface ModeInfo {
  defaultMode: UserMode | null;
  installedRepos: string[];
}

export interface ShellData {
  user: ShellUser;
  lang: Lang;
  canMaintain: boolean;
  authOn: boolean;
  /** Where `/app` sends this user. */
  mode: UserMode;
}

function mockMode(): ModeInfo | null {
  const res = handleMock({ dashboard } as unknown as Fixtures, "GET", ["me", "mode"], new URLSearchParams());
  return "json" in res && res.status === 200 ? (res.json as ModeInfo) : null;
}

export async function loadShell(): Promise<ShellData> {
  const [login, jar] = await Promise.all([sessionLogin(), cookies()]);
  const [me, info] = await Promise.all([
    fetchMe().catch(() => null),
    load<ModeInfo>("/api/me/mode", mockMode, { user: login }).catch(() => null),
  ]);
  const canMaintain = (info?.installedRepos ?? []).length > 0;
  return {
    user: { login: me?.user.login ?? login, name: me?.user.name ?? login, avatarUrl: me?.user.avatarUrl ?? null },
    lang: parseLang(jar.get(LANG_COOKIE)?.value),
    canMaintain,
    authOn: authEnabled(),
    mode: resolveMode(info?.defaultMode, parseMode(jar.get(MODE_COOKIE)?.value), canMaintain),
  };
}

/** Saves the workspace: on this device (cookie) and, with a real server, on the user (users.default_mode). */
export async function saveMode(mode: UserMode): Promise<void> {
  (await cookies()).set(MODE_COOKIE, mode, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  const base = apiBaseUrl();
  if (!base) return;
  try {
    await fetch(`${base}/api/me/mode`, {
      method: "POST",
      headers: { "content-type": "application/json", ...identityHeaders(await sessionLogin()) },
      body: JSON.stringify({ mode }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The cookie still remembers it on this device.
  }
}
