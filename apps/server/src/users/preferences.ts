import type { UserPreferences, WorkspaceMode } from "@bitbounty/core";
import { users, type Database } from "@bitbounty/db";
import { sql, type AnyColumn } from "drizzle-orm";
import { placeholderGithubId } from "../bounties/drizzle-repo.js";

/**
 * L1: the onboarding fields of a user (`users.default_mode`, `users.onboarded_at`), keyed by
 * GitHub login (case-insensitive). The web reads them at sign-in and writes them from /welcome.
 */
export interface PreferencesStore {
  get(login: string): Promise<UserPreferences>;
  /** Sets the default mode. The first call also stamps `onboardedAt`; later calls keep it. */
  setDefaultMode(login: string, mode: WorkspaceMode, now?: Date): Promise<UserPreferences>;
}

export const NOT_ONBOARDED: UserPreferences = { defaultMode: null, onboardedAt: null };

export class InMemoryPreferencesStore implements PreferencesStore {
  private readonly byLogin = new Map<string, UserPreferences>();

  async get(login: string): Promise<UserPreferences> {
    return this.byLogin.get(login.toLowerCase()) ?? NOT_ONBOARDED;
  }

  async setDefaultMode(login: string, mode: WorkspaceMode, now = new Date()): Promise<UserPreferences> {
    const prev = await this.get(login);
    const next = { defaultMode: mode, onboardedAt: prev.onboardedAt ?? now.toISOString() };
    this.byLogin.set(login.toLowerCase(), next);
    return next;
  }
}

const lowerEq = (col: AnyColumn, value: string) => sql`lower(${col}) = lower(${value})`;

/** On `users`. A login seen for the first time gets a row with a placeholder GitHub id, like DrizzleBountyRepo. */
export class DrizzlePreferencesStore implements PreferencesStore {
  constructor(private readonly db: Database) {}

  async get(login: string): Promise<UserPreferences> {
    const [row] = await this.db
      .select({ defaultMode: users.defaultMode, onboardedAt: users.onboardedAt })
      .from(users)
      .where(lowerEq(users.login, login))
      .limit(1);
    return row ? { defaultMode: row.defaultMode, onboardedAt: row.onboardedAt?.toISOString() ?? null } : NOT_ONBOARDED;
  }

  async setDefaultMode(login: string, mode: WorkspaceMode, now = new Date()): Promise<UserPreferences> {
    const set = { defaultMode: mode, onboardedAt: sql`coalesce(${users.onboardedAt}, ${now.toISOString()}::timestamptz)` };
    const updated = await this.db.update(users).set(set).where(lowerEq(users.login, login)).returning({ id: users.id });
    if (!updated.length) {
      await this.db
        .insert(users)
        .values({ login, githubId: placeholderGithubId("user", login), defaultMode: mode, onboardedAt: now })
        .onConflictDoNothing();
    }
    return this.get(login);
  }
}
