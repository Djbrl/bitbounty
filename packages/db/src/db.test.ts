import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { migrationsFolder } from "./migrate.js";
import * as schema from "./schema.js";
import { SEED_IDS, seed } from "./seed.js";

const { bounties, bountyStatus, claims, events, fundings, ledger, payoutAccounts, payouts, submissions, users } =
  schema;

interface Target {
  db: Database;
  migrate: () => Promise<void>;
  query: (sql: string) => Promise<{ rows: unknown[] }>;
  close: () => Promise<void>;
}

/** PGlite: an in-memory Postgres, always available. */
async function pgliteTarget(): Promise<Target> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  return {
    db,
    migrate: () => migratePglite(db, { migrationsFolder }),
    query: (sql) => client.query(sql),
    close: () => client.close(),
  };
}

/**
 * The real Postgres at DATABASE_URL. The suite runs in a throwaway database
 * created next to it (and dropped after), so it never touches the dev data.
 */
async function postgresTarget(url: string): Promise<Target> {
  const name = `bitbounty_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database "${name}"`);
  const testUrl = new URL(url);
  testUrl.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: testUrl.toString() });
  const db = drizzlePg(pool, { schema });
  return {
    db,
    migrate: () => migratePg(db, { migrationsFolder }),
    query: (sql) => pool.query(sql),
    close: async () => {
      await pool.end();
      await admin.query(`drop database if exists "${name}"`);
      await admin.end();
    },
  };
}

const databaseUrl = process.env.DATABASE_URL;

describe("on PGlite (in memory)", () => defineSuite(pgliteTarget));
describe.skipIf(!databaseUrl)("on Postgres (DATABASE_URL)", () => defineSuite(() => postgresTarget(databaseUrl!)));

function defineSuite(connect: () => Promise<Target>) {
  let t: Target;
  let db: Database;
  const client = { query: (sql: string) => t.query(sql) };
  const migrate = () => t.migrate();

  beforeAll(async () => {
    t = await connect();
    db = t.db;
    await migrate();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe("migrations", () => {
    it("create every table on an empty database", async () => {
      const { rows } = (await client.query(
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
      )) as { rows: { table_name: string }[] };
      expect(rows.map((r) => r.table_name)).toEqual([
        "agents",
        "bounties",
        "claims",
        "events",
        "fundings",
        "installations",
        "ledger",
        "payout_accounts",
        "payouts",
        "repos",
        "submissions",
        "users",
      ]);
    });

    it("can run twice without failing", async () => {
      await expect(migrate()).resolves.not.toThrow();
    });
  });

  describe("seed", () => {
    beforeAll(async () => {
      await seed(db);
    });

    it("creates one bounty in every status", async () => {
      const rows = await db.select({ status: bounties.status }).from(bounties);
      expect(rows.map((r) => r.status).sort()).toEqual([...bountyStatus.enumValues].sort());
    });

    it("gives each status the rows it implies", async () => {
      const paidId = SEED_IDS.bounty("paid");
      const [payout] = await db.select().from(payouts).where(eq(payouts.bountyId, paidId));
      expect(payout).toMatchObject({ status: "succeeded", reference: `pay-${paidId}`, amountXof: 10_000 });

      const unfundedId = SEED_IDS.bounty("unfunded");
      expect(await db.select().from(claims).where(eq(claims.bountyId, unfundedId))).toHaveLength(0);
      const [funding] = await db.select().from(fundings).where(eq(fundings.bountyId, unfundedId));
      expect(funding?.status).toBe("pending");

      const failedId = SEED_IDS.bounty("payout_failed");
      const [failed] = await db.select().from(payouts).where(eq(payouts.bountyId, failedId));
      expect(failed).toMatchObject({ status: "failed", attempts: 3 });

      const [sub] = await db.select().from(submissions).where(eq(submissions.bountyId, SEED_IDS.bounty("verified")));
      expect(sub?.verdict).toBe("pass");
      expect(sub?.mergedAt).toBeInstanceOf(Date);
    });

    it("keeps every bounty's ledger equal to the money still held for it", async () => {
      const all = await db.select().from(bounties);
      const lines = await db.select().from(ledger);
      const held = new Set(["funded", "claimed", "submitted", "verified", "paying", "on_hold", "payout_failed"]);
      for (const b of all) {
        const sum = lines.filter((l) => l.bountyId === b.id).reduce((s, l) => s + l.amount, 0);
        expect(sum, b.status).toBe(held.has(b.status) ? b.amountXof : 0);
      }
    });

    it("gives every bounty a timeline that starts with its creation", async () => {
      const all = await db.select().from(bounties);
      const rows = await db.select().from(events);
      for (const b of all) {
        const timeline = rows.filter((e) => e.bountyId === b.id).sort((x, y) => +x.receivedAt - +y.receivedAt);
        expect(timeline[0]?.type, b.status).toBe("bounty.created");
      }
      const paid = rows.filter((e) => e.bountyId === SEED_IDS.bounty("paid")).map((e) => e.type);
      expect(paid).toEqual(expect.arrayContaining(["funding.paid", "claim.created", "pr.merged", "payout.succeeded"]));
    });

    it("only pays out to verified accounts", async () => {
      const rows = await db
        .select({ status: payoutAccounts.status })
        .from(payouts)
        .innerJoin(payoutAccounts, eq(payouts.userId, payoutAccounts.userId));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status === "verified")).toBe(true);
    });

    it("can run again and gives the same result", async () => {
      await seed(db);
      const [b] = await db.select({ n: count() }).from(bounties);
      const [u] = await db.select({ n: count() }).from(users);
      expect(b?.n).toBe(bountyStatus.enumValues.length);
      expect(u?.n).toBe(3);
    });
  });

  describe("constraints", () => {
    it("stores the same webhook event only once", async () => {
      const event = { source: "github" as const, externalId: "delivery-dup", type: "issue_comment.created", payload: {} };
      await db.insert(events).values(event).onConflictDoNothing();
      await db.insert(events).values(event).onConflictDoNothing();
      const rows = await db.select().from(events).where(eq(events.externalId, "delivery-dup"));
      expect(rows).toHaveLength(1);
      await expect(db.insert(events).values(event)).rejects.toThrow();
    });

    it("allows the same external id from two different sources", async () => {
      await db.insert(events).values({ source: "bitnob", externalId: "delivery-dup", type: "deposit.success", payload: {} });
      const rows = await db.select().from(events).where(eq(events.externalId, "delivery-dup"));
      expect(rows).toHaveLength(2);
    });

    it("refuses a second payout with the same reference", async () => {
      const paidId = SEED_IDS.bounty("paid");
      await expect(
        db.insert(payouts).values({ bountyId: paidId, userId: SEED_IDS.awa, amountXof: 10_000, reference: `pay-${paidId}` }),
      ).rejects.toThrow();
    });

    it("refuses a second payout for the same bounty, even with another reference", async () => {
      const paidId = SEED_IDS.bounty("paid");
      await expect(
        db.insert(payouts).values({ bountyId: paidId, userId: SEED_IDS.awa, amountXof: 10_000, reference: "pay-other" }),
      ).rejects.toThrow();
    });

    it("refuses a second active claim on the same bounty", async () => {
      await expect(
        db.insert(claims).values({
          bountyId: SEED_IDS.bounty("claimed"),
          userId: SEED_IDS.moussa,
          expiresAt: new Date(),
        }),
      ).rejects.toThrow();
      // a released claim next to the active one is fine
      await db.insert(claims).values({
        bountyId: SEED_IDS.bounty("claimed"),
        userId: SEED_IDS.moussa,
        status: "released",
        expiresAt: new Date(),
      });
    });

    it.each([
      ["a zero bounty amount", `update bounties set amount_xof = 0 where id = '${SEED_IDS.bounty("funded")}'`],
      ["a negative bounty amount", `update bounties set amount_xof = -5000 where id = '${SEED_IDS.bounty("funded")}'`],
      ["a negative payout amount", `update payouts set amount_xof = -1 where bounty_id = '${SEED_IDS.bounty("paid")}'`],
      ["negative attempts", `update payouts set attempts = -3 where bounty_id = '${SEED_IDS.bounty("paid")}'`],
      ["a spam score above 1", `update submissions set spam_score = 7 where bounty_id = '${SEED_IDS.bounty("verified")}'`],
      ["a phone that isn't E.164", `update payout_accounts set phone_e164 = 'hello' where user_id = '${SEED_IDS.awa}'`],
      ["a test amount outside 100-199", `update payout_accounts set test_amount_xof = 5000 where user_id = '${SEED_IDS.awa}'`],
      ["a zero funding amount", `update fundings set source_amount = 0 where bounty_id = '${SEED_IDS.bounty("funded")}'`],
      ["a negative agent budget", `update agents set monthly_budget_xof = -1 where id = '${SEED_IDS.agent}'`],
      // B6
      ["a Lightning Address that isn't user@domain", `update payout_accounts set lightning_address = 'awa' where user_id = '${SEED_IDS.awa}'`],
      ["an upper-case Lightning Address", `update payout_accounts set lightning_address = 'Awa@Blink.sv' where user_id = '${SEED_IDS.awa}'`],
      ["a payout account with nowhere to pay", `update payout_accounts set phone_e164 = null where user_id = '${SEED_IDS.awa}'`],
      ["a zero sats payout", `update payouts set amount_sats = 0 where bounty_id = '${SEED_IDS.bounty("paid")}'`],
      ["an unknown payout rail", `update payouts set rail = 'carrier_pigeon' where bounty_id = '${SEED_IDS.bounty("paid")}'`],
    ])("refuses %s", async (_label, query) => {
      await expect(client.query(query)).rejects.toThrow();
    });

    it("B6: a payout account can be a Lightning Address only, and a payout row keeps its Lightning details", async () => {
      await client.query(
        `update payout_accounts set lightning_address = 'awa@blink.sv', phone_e164 = null, provider = null, account_name = null where user_id = '${SEED_IDS.awa}'`,
      );
      const [acc] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, SEED_IDS.awa));
      expect(acc).toMatchObject({ lightningAddress: "awa@blink.sv", phoneE164: null });
      await client.query(
        `update payouts set rail = 'lightning', amount_sats = 2217, xof_per_btc = 45100000.5, payment_hash = 'ab' where bounty_id = '${SEED_IDS.bounty("paid")}'`,
      );
      const [p] = await db.select().from(payouts).where(eq(payouts.bountyId, SEED_IDS.bounty("paid")));
      expect(p).toMatchObject({ rail: "lightning", amountSats: 2217, xofPerBtc: 45100000.5 });
    });

    it("refuses two bounties on the same issue", async () => {
      await expect(
        db.insert(bounties).values({
          repoId: SEED_IDS.repo,
          issueNumber: 1,
          issueTitle: "duplicate",
          amountXof: 1_000,
          funderKind: "human",
          funderId: SEED_IDS.maintainer,
        }),
      ).rejects.toThrow();
    });

    it("refuses a status outside the contract", async () => {
      await expect(
        client.query(`update bounties set status = 'approved' where id = '${SEED_IDS.bounty("funded")}'`),
      ).rejects.toThrow();
    });
  });
}
