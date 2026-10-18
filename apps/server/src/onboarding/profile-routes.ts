import { maskLightningAddress } from "@bitbounty/core";
import { Hono, type Context } from "hono";
import { LnurlError, type LnurlChecker } from "../payouts/lnurl.js";
import { normalizeLightningAddress, parseProfilePatch, type Profile, type ProfileStore } from "./profile.js";

export const GITHUB_APP_INSTALL_URL = "https://github.com/apps/bitbounty-dakar";

export interface ProfileRoutesDeps {
  store: ProfileStore;
  /** B6's LNURL resolver: an address is saved only if it answers a valid payRequest. */
  checker: LnurlChecker;
  /** The signed-in GitHub login (web proxy + INTERNAL_API_TOKEN). null → 401. */
  getLogin: (c: Context) => string | null;
  /** Top languages of the user's public GitHub repos (cached; [] on failure). */
  languagesOf?: (login: string) => Promise<string[]>;
  /** Repos where the GitHub App is installed for this user (installations + bounties they funded). */
  reposOf?: (login: string) => Promise<string[]>;
}

/**
 * U1 (/welcome onboarding):
 * GET  /api/me/onboarding                    → OnboardingState (answers so far + GitHub languages + installed repos)
 * POST /api/me/onboarding {defaultMode?, preferences?, done?} → OnboardingState (done sets onboardedAt once)
 * POST /api/me/lightning-address {lightningAddress} → {lightningAddress: masked}
 *      400 invalid_lightning_address · 422 lightning_address_unreachable (+ retryable)
 */
export function profileRoutes(deps: ProfileRoutesDeps) {
  const app = new Hono();

  const view = async (login: string, p: Profile) => {
    const [githubLanguages, installedRepos] = await Promise.all([
      deps.languagesOf?.(login).catch(() => []) ?? Promise.resolve([]),
      deps.reposOf?.(login).catch(() => []) ?? Promise.resolve([]),
    ]);
    return {
      login,
      defaultMode: p.defaultMode,
      onboardedAt: p.onboardedAt,
      preferences: p.preferences,
      lightningAddress: p.lightningAddress ? maskLightningAddress(p.lightningAddress) : null,
      githubLanguages,
      installedRepos,
      appInstallUrl: GITHUB_APP_INSTALL_URL,
    };
  };

  app.get("/api/me/onboarding", async (c) => {
    const login = deps.getLogin(c);
    if (!login) return c.json({ error: "unauthorized" }, 401);
    return c.json(await view(login, await deps.store.get(login)));
  });

  app.post("/api/me/onboarding", async (c) => {
    const login = deps.getLogin(c);
    if (!login) return c.json({ error: "unauthorized" }, 401);
    const parsed = parseProfilePatch(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json(await view(login, await deps.store.update(login, parsed.patch)));
  });

  app.post("/api/me/lightning-address", async (c) => {
    const login = deps.getLogin(c);
    if (!login) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { lightningAddress?: unknown } | null;
    const address = normalizeLightningAddress(body?.lightningAddress);
    if (!address) return c.json({ error: "invalid_lightning_address" }, 400);
    try {
      await deps.checker.check(address);
    } catch (err) {
      if (!(err instanceof LnurlError)) throw err;
      console.warn(`[onboarding] @${login}: ${err.message}`);
      return c.json({ error: "lightning_address_unreachable", retryable: err.retryable }, 422);
    }
    await deps.store.setLightningAddress(login, address);
    return c.json({ lightningAddress: maskLightningAddress(address) });
  });

  return app;
}
