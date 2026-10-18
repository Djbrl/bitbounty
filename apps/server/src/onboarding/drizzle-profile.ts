import { payoutAccounts, users, type Database } from "@bitbounty/db";
import { eq, sql } from "drizzle-orm";
import { ensureUserId } from "../bounties/drizzle-repo.js";
import { normalizePreferences, type Profile, type ProfilePatch, type ProfileStore } from "./profile.js";

/** U1: the onboarding answers on `users` (L1 columns + `preferences`) and `payout_accounts.lightning_address`. */
export class DrizzleProfileStore implements ProfileStore {
  constructor(private readonly db: Database) {}

  async get(login: string): Promise<Profile> {
    const [row] = await this.db
      .select({
        defaultMode: users.defaultMode,
        onboardedAt: users.onboardedAt,
        preferences: users.preferences,
        lightningAddress: payoutAccounts.lightningAddress,
      })
      .from(users)
      .leftJoin(payoutAccounts, eq(payoutAccounts.userId, users.id))
      .where(sql`lower(${users.login}) = lower(${login})`)
      .limit(1);
    return {
      defaultMode: row?.defaultMode ?? null,
      onboardedAt: row?.onboardedAt ? row.onboardedAt.toISOString() : null,
      preferences: normalizePreferences(row?.preferences),
      lightningAddress: row?.lightningAddress ?? null,
    };
  }

  async update(login: string, patch: ProfilePatch): Promise<Profile> {
    const id = await ensureUserId(this.db, login);
    const cur = await this.get(login);
    const set: Partial<typeof users.$inferInsert> = {};
    if (patch.preferences) set.preferences = { ...normalizePreferences(patch.preferences, cur.preferences) };
    if (patch.done && !cur.onboardedAt) set.onboardedAt = new Date();
    if (Object.keys(set).length) await this.db.update(users).set(set).where(eq(users.id, id));
    return this.get(login);
  }

  async setLightningAddress(login: string, address: string): Promise<void> {
    const userId = await ensureUserId(this.db, login);
    await this.db
      .insert(payoutAccounts)
      .values({ userId, lightningAddress: address, country: "SN" })
      .onConflictDoUpdate({ target: payoutAccounts.userId, set: { lightningAddress: address } });
  }
}
