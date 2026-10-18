import { createDb, runMigrations } from "@bitbounty/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzlePreferencesStore, InMemoryPreferencesStore, type PreferencesStore } from "./preferences.js";

const url = process.env.DATABASE_URL;

/** Same behaviour in memory and on Postgres. */
function preferencesContract(store: () => PreferencesStore) {
  it("starts not onboarded, stamps onboardedAt on the first mode, keeps it on later changes (login case-insensitive)", async () => {
    const s = store();
    const login = `dev-${process.pid}-${Date.now()}`;
    expect(await s.get(login)).toEqual({ defaultMode: null, onboardedAt: null });
    const first = await s.setDefaultMode(login, "maintain", new Date("2026-10-18T09:00:00Z"));
    expect(first).toEqual({ defaultMode: "maintain", onboardedAt: "2026-10-18T09:00:00.000Z" });
    const second = await s.setDefaultMode(login.toUpperCase(), "hunt", new Date("2026-10-19T09:00:00Z"));
    expect(second).toEqual({ defaultMode: "hunt", onboardedAt: "2026-10-18T09:00:00.000Z" });
    expect(await s.get(login)).toEqual(second);
  });
}

describe("InMemoryPreferencesStore", () => preferencesContract(() => new InMemoryPreferencesStore()));

describe.skipIf(!url)("DrizzlePreferencesStore (DATABASE_URL)", () => {
  const name = `bitbounty_test_prefs_${process.pid}_${Date.now()}`;
  let admin: pg.Client;
  let conn: ReturnType<typeof createDb>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database "${name}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${name}`;
    conn = createDb(testUrl.toString());
    await runMigrations(conn.db);
  });

  afterAll(async () => {
    await conn?.close();
    await admin?.query(`drop database if exists "${name}"`);
    await admin?.end();
  });

  preferencesContract(() => new DrizzlePreferencesStore(conn.db));
});
