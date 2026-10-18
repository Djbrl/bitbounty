// U2: the signed-in user's workspace (Maintainer / Hunter) for the web app shell.
// GET  /api/me/mode          → { defaultMode, installedRepos }
// POST /api/me/mode {mode}   → { defaultMode }
// Same identity as /api/me: `Authorization: Bearer <INTERNAL_API_TOKEN>` + `X-BitBounty-User: <login>`.
import { timingSafeEqual } from "node:crypto";
import { USER_MODES, type UserMode } from "@bitbounty/core";
import { eq, sql, type AnyColumn } from "drizzle-orm";
import { installations, repos, users, type Database } from "@bitbounty/db";
import { Hono, type Context } from "hono";
import type { BountyRepo } from "../bounties/repo.js";
import { ensureUserId } from "../bounties/drizzle-repo.js";
import { loginOf } from "./views.js";

export interface UserModeStore {
  getMode(login: string): Promise<UserMode | null>;
  setMode(login: string, mode: UserMode): Promise<void>;
  /** Repos where the GitHub App is installed on the user's account. */
  installedRepos(login: string): Promise<string[]>;
}

export class InMemoryModeStore implements UserModeStore {
  private modes = new Map<string, UserMode>();
  constructor(private installs: Record<string, string[]> = {}) {}
  async getMode(login: string) {
    return this.modes.get(login.toLowerCase()) ?? null;
  }
  async setMode(login: string, mode: UserMode) {
    this.modes.set(login.toLowerCase(), mode);
  }
  async installedRepos(login: string) {
    const key = Object.keys(this.installs).find((k) => k.toLowerCase() === login.toLowerCase());
    return key ? [...this.installs[key]!] : [];
  }
}

const lowerEq = (col: AnyColumn, value: string) => sql`lower(${col}) = lower(${value})`;

/** `users.default_mode` (L1, migration 0003); installs from `installations.account_login`. */
export class DrizzleModeStore implements UserModeStore {
  constructor(private db: Database) {}
  async getMode(login: string) {
    const row = (await this.db.select({ mode: users.defaultMode }).from(users).where(lowerEq(users.login, login)).limit(1))[0];
    return row?.mode ?? null;
  }
  async setMode(login: string, mode: UserMode) {
    const id = await ensureUserId(this.db, login);
    await this.db.update(users).set({ defaultMode: mode }).where(eq(users.id, id));
  }
  async installedRepos(login: string) {
    const rows = await this.db
      .select({ fullName: repos.fullName })
      .from(repos)
      .innerJoin(installations, eq(repos.installationId, installations.id))
      .where(lowerEq(installations.accountLogin, login));
    return rows.map((r) => r.fullName);
  }
}

export interface ModeRoutesDeps {
  store: UserModeStore;
  /** A maintainer who funded bounties on a repo counts as having it installed. */
  repo: BountyRepo;
  internalToken?: string;
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function isUserMode(v: unknown): v is UserMode {
  return typeof v === "string" && (USER_MODES as readonly string[]).includes(v);
}

export function modeRoutes({ store, repo, internalToken }: ModeRoutesDeps) {
  const api = new Hono();

  const userFrom = (c: Context): string | null => {
    if (!internalToken) return null;
    const given = Buffer.from((c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    const want = Buffer.from(internalToken);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const login = c.req.header("x-bitbounty-user")?.trim() ?? "";
    return LOGIN_RE.test(login) ? login : null;
  };

  api.get("/api/me/mode", async (c) => {
    const login = userFrom(c);
    if (!login) return c.json({ error: "unauthorized" }, 401);
    const funded = (await repo.list(500)).filter((b) => loginOf(b.funderId)?.toLowerCase() === login.toLowerCase()).map((b) => b.repoFullName);
    const installedRepos = [...new Set([...(await store.installedRepos(login)), ...funded])].sort();
    return c.json({ defaultMode: await store.getMode(login), installedRepos });
  });

  api.post("/api/me/mode", async (c) => {
    const login = userFrom(c);
    if (!login) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { mode?: unknown } | null;
    if (!isUserMode(body?.mode)) return c.json({ error: "invalid_mode", allowed: USER_MODES }, 400);
    await store.setMode(login, body.mode);
    return c.json({ defaultMode: body.mode });
  });

  return api;
}
