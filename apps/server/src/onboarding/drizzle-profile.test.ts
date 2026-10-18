import { createDb, runMigrations, seed } from "@bitbounty/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleProfileStore, installedReposOf } from "./drizzle-profile.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("DrizzleProfileStore (DATABASE_URL)", () => {
  const name = `bitbounty_test_profile_${process.pid}_${Date.now()}`;
  let admin: pg.Client;
  let conn: ReturnType<typeof createDb>;
  let store: DrizzleProfileStore;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database "${name}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${name}`;
    conn = createDb(testUrl.toString());
    await runMigrations(conn.db);
    await seed(conn.db);
    store = new DrizzleProfileStore(conn.db);
  });

  afterAll(async () => {
    await conn?.close();
    await admin?.query(`drop database if exists "${name}"`);
    await admin?.end();
  });

  it("an unknown login reads as not onboarded, with default preferences", async () => {
    expect(await store.get("nobody-yet")).toMatchObject({ defaultMode: null, onboardedAt: null, lightningAddress: null, preferences: { step: 1, currency: "xof" } });
  });

  it("saves mode, preferences, onboardedAt (once) and the Lightning Address", async () => {
    await store.update("Awa-New", { defaultMode: "hunt", preferences: { role: "hunt", stack: ["Go"], step: 2 } });
    const done = await store.update("awa-new", { preferences: { step: 3 }, done: true });
    expect(done).toMatchObject({ defaultMode: "hunt", preferences: { role: "hunt", stack: ["Go"], step: 3 } });
    expect(done.onboardedAt).toMatch(/^\d{4}-/);
    expect((await store.update("awa-new", { done: true })).onboardedAt).toBe(done.onboardedAt);
    await store.setLightningAddress("awa-new", "awa@blink.sv");
    await store.setLightningAddress("awa-new", "awa2@blink.sv");
    expect((await store.get("AWA-NEW")).lightningAddress).toBe("awa2@blink.sv");
  });

  it("lists repos under the user's installations", async () => {
    expect(Array.isArray(await installedReposOf(conn.db, "Djbrl"))).toBe(true);
  });
});
