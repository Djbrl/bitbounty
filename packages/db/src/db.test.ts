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
import { SEED_IDS, resetDatabase, seed, seedId } from "./seed.js";

const { bounties, claims, events, fundings, installations, ledger, payoutAccounts, payouts, repos, submissions, users } =
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

    it("tells a demo story with no failure on the board", async () => {
      const rows = await db.select({ status: bounties.status }).from(bounties);
      const count = (s: string) => rows.filter((r) => r.status === s).length;
      expect(rows).toHaveLength(9);
      expect(count("paid")).toBe(3);
      for (const s of ["unfunded", "funded", "claimed", "submitted", "verified"]) expect(count(s), s).toBeGreaterThan(0);
      for (const s of ["payout_failed", "on_hold", "paying", "refunded", "cancelled"]) expect(count(s), s).toBe(0);
      const titles = (await db.select({ t: bounties.issueTitle }).from(bounties)).map((r) => r.t).join(" ");
      expect(titles).not.toMatch(/orange money|wave/i);
      expect(titles).toMatch(/wolof/i);
    });

    it("gives each status the rows it implies", async () => {
      const paidId = SEED_IDS.bounty("paid");
      const [payout] = await db.select().from(payouts).where(eq(payouts.bountyId, paidId));
      expect(payout).toMatchObject({ status: "succeeded", reference: `pay-${paidId}`, amountXof: 10_000, attempts: 1 });
      expect(await db.select().from(payouts).where(eq(payouts.status, "failed"))).toHaveLength(0);

      const unfundedId = SEED_IDS.bounty("unfunded");
      expect(await db.select().from(claims).where(eq(claims.bountyId, unfundedId))).toHaveLength(0);
      const [funding] = await db.select().from(fundings).where(eq(fundings.bountyId, unfundedId));
      expect(funding?.status).toBe("pending");

      const [sub] = await db.select().from(submissions).where(eq(submissions.bountyId, SEED_IDS.bounty("verified")));
      expect(sub?.verdict).toBe("pass");
      expect(sub?.mergedAt).toBeInstanceOf(Date);
    });

    it("has an agent-funded bounty and a naira funding from Lagos", async () => {
      const [byAgent] = await db.select().from(bounties).where(eq(bounties.funderKind, "agent"));
      expect(byAgent?.funderId).toBe(SEED_IDS.agent);
      const ngn = await db.select().from(fundings).where(eq(fundings.rail, "ngn"));
      expect(ngn).toHaveLength(1);
      expect(ngn[0]).toMatchObject({ sourceCurrency: "NGN", status: "paid" });
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
      expect(rows.some((e) => e.type === "payout.failed")).toBe(false);
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
      const snapshot = async () => ({
        bounties: (await db.select({ id: bounties.id, status: bounties.status }).from(bounties)).sort((a, b) => a.id.localeCompare(b.id)),
        users: (await db.select({ n: count() }).from(users))[0]?.n,
        ledger: (await db.select({ n: count() }).from(ledger))[0]?.n,
        events: (await db.select({ n: count() }).from(events))[0]?.n,
      });
      const before = await snapshot();
      await seed(db);
      expect(await snapshot()).toEqual(before);
      expect(before.bounties).toHaveLength(9);
      expect(before.users).toBe(5);
    });

    it("keeps rows it did not write, and removes rows an older seed wrote", async () => {
      // A real bounty created by the live server on another repo, funded by the seeded maintainer.
      const [inst] = await db.insert(installations).values({ githubInstallationId: 424242, accountLogin: "someone" }).returning();
      const [repo] = await db.insert(repos).values({ installationId: inst!.id, githubRepoId: 434343, fullName: "Djbrl/bitbounty-demo" }).returning();
      const [real] = await db
        .insert(bounties)
        .values({ repoId: repo!.id, issueNumber: 1, issueTitle: "real", amountXof: 5_000, funderKind: "human", funderId: SEED_IDS.maintainer })
        .returning();
      await db.insert(events).values({ bountyId: real!.id, source: "github", externalId: "real-delivery", type: "issue_comment", payload: {} });
      // A leftover from the previous seed (11 bounties): its last id is not in the new story.
      const stale = seedId(5, 11);
      await db.insert(bounties).values({
        id: stale,
        repoId: SEED_IDS.repo,
        issueNumber: 999,
        issueTitle: "Support Orange Money in the onboarding form",
        amountXof: 8_000,
        status: "payout_failed",
        funderKind: "human",
        funderId: SEED_IDS.maintainer,
      });

      await seed(db);
      expect(await db.select().from(bounties).where(eq(bounties.id, real!.id))).toHaveLength(1);
      expect(await db.select().from(events).where(eq(events.externalId, "real-delivery"))).toHaveLength(1);
      expect(await db.select().from(bounties).where(eq(bounties.id, stale))).toHaveLength(0);
      // The maintainer the real bounty points at is still there.
      expect(await db.select().from(users).where(eq(users.id, SEED_IDS.maintainer))).toHaveLength(1);

      await db.delete(events).where(eq(events.externalId, "real-delivery"));
      await db.delete(bounties).where(eq(bounties.id, real!.id));
      await db.delete(repos).where(eq(repos.id, repo!.id));
      await db.delete(installations).where(eq(installations.id, inst!.id));
    });

    it("reuses the maintainer the server already knows", async () => {
      await resetDatabase(db);
      const [djbrl] = await db.insert(users).values({ githubId: 12345, login: "djbrl" }).returning();
      await seed(db);
      const humans = await db.select({ f: bounties.funderId }).from(bounties).where(eq(bounties.funderKind, "human"));
      const funders = new Set(humans.map((r) => r.f));
      expect(funders.has(djbrl!.id)).toBe(true);
      expect(funders.has(SEED_IDS.maintainer)).toBe(false);
      // Back to the plain seed for the constraint tests.
      await resetDatabase(db);
      await seed(db);
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
    ])("refuses %s", async (_label, query) => {
      await expect(client.query(query)).rejects.toThrow();
    });

    it("refuses two bounties on the same issue", async () => {
      await expect(
        db.insert(bounties).values({
          repoId: SEED_IDS.repo,
          issueNumber: 7, // sunu-wallet #7 is seeded
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
