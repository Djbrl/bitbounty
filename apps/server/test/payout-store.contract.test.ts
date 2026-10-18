import type { LightningPayment, PayLightningInput } from "@bitbounty/bitnob";
import type { Payout } from "@bitbounty/core";
import { SEED_IDS, createDb, runMigrations, seed } from "@bitbounty/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzlePayoutStore, InMemoryPayoutStore, PayoutService, type PayoutStore } from "../src/payouts/index.js";

/**
 * The `PayoutStore` contract, on the in-memory store and on Postgres (`DrizzlePayoutStore`, B6),
 * plus "kill the server mid-payout and restart → resumes, pays once" on a real database.
 * The Postgres half needs DATABASE_URL (it creates and drops its own `bitbounty_test_*` database).
 */
const url = process.env.DATABASE_URL;

function contract(name: string, make: () => Promise<{ store: PayoutStore; bounty: (n: number) => string }>) {
  describe(name, () => {
    let store: PayoutStore;
    let bounty: (n: number) => string;
    beforeAll(async () => {
      ({ store, bounty } = await make());
    });

    const row = (n: number, over: Partial<Payout> = {}): Payout => ({
      id: crypto.randomUUID(),
      bountyId: bounty(n),
      userId: "github:awa-dev",
      amountXof: 10_000,
      quoteId: null,
      bitnobPayoutId: null,
      reference: `pay-${bounty(n)}`,
      status: "pending",
      attempts: 0,
      lastError: null,
      paidAt: null,
      rail: "lightning",
      ...over,
    });

    it("create: one row per bounty, even with concurrent creates; user ids come back as github:<login>", async () => {
      const results = await Promise.all([store.create(row(0)), store.create(row(0)), store.create(row(0))]);
      expect(results.filter((r) => r.inserted)).toHaveLength(1);
      expect(new Set(results.map((r) => r.payout.id)).size).toBe(1);
      expect(results[0]!.payout).toMatchObject({ userId: "github:awa-dev", status: "pending", rail: "lightning", amountXof: 10_000 });
    });

    it("update is a compare-and-set on (status, attempts): of two concurrent claims, one wins", async () => {
      const { payout } = await store.create(row(1));
      const claims = await Promise.all([
        store.update(payout.id, { status: "pending", attempts: 0 }, { status: "processing", attempts: 1 }),
        store.update(payout.id, { status: "pending", attempts: 0 }, { status: "processing", attempts: 1 }),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await store.update(payout.id, { status: "processing", attempts: 2 }, { lastError: "x" })).toBeNull();
      expect(await store.update(payout.id, { status: "pending" }, { lastError: "x" })).toBeNull();
    });

    it("B1: saving an invoice expects payment_request IS NULL and marking the send sent_at IS NULL: one winner each", async () => {
      const payout = (await store.getByBounty(bounty(1)))!; // claimed (processing, attempt 1) by the test above
      const expect1 = { status: "processing" as const, attempts: 1, unset: ["paymentRequest"] as const };
      const invoices = await Promise.all([
        store.update(payout.id, expect1, { paymentRequest: "lnbc-a", paymentHash: "aa".repeat(32) }),
        store.update(payout.id, expect1, { paymentRequest: "lnbc-b", paymentHash: "bb".repeat(32) }),
      ]);
      expect(invoices.filter(Boolean)).toHaveLength(1);
      const expect2 = { status: "processing" as const, attempts: 1, unset: ["sentAt"] as const };
      const sends = await Promise.all([
        store.update(payout.id, expect2, { sentAt: "2026-10-18T00:00:00.000Z" }),
        store.update(payout.id, expect2, { sentAt: "2026-10-18T00:00:01.000Z" }),
      ]);
      expect(sends.filter(Boolean)).toHaveLength(1);
      // Both columns set: neither guard passes any more, the plain CAS still does.
      expect(await store.update(payout.id, { status: "processing", attempts: 1, unset: ["paymentRequest", "sentAt"] }, { lastError: "x" })).toBeNull();
      expect(await store.update(payout.id, { status: "processing", attempts: 1 }, { lastError: null })).toBeTruthy();
    });

    it("keeps the Lightning details (sats, rate, invoice, hash, expiry, sentAt, preimage) and clears them with null", async () => {
      const { payout } = await store.create(row(2));
      const at = "2026-10-18T00:10:00.000Z";
      const saved = await store.update(
        payout.id,
        { status: "pending", attempts: 0 },
        {
          status: "processing",
          attempts: 1,
          lightningAddress: "awa@blink.sv",
          amountSats: 16_666,
          xofPerBtc: 60_000_000.5,
          paymentRequest: "lntb166660n1…",
          paymentHash: "ab".repeat(32),
          invoiceExpiresAt: at,
          sentAt: at,
          bitnobPayoutId: "lnp-1",
        },
      );
      expect(saved).toMatchObject({ amountSats: 16_666, xofPerBtc: 60_000_000.5, invoiceExpiresAt: at, sentAt: at, lightningAddress: "awa@blink.sv" });
      expect(await store.findByBitnob({ bitnobPayoutId: "lnp-1" })).toMatchObject({ id: payout.id });
      // An empty patch still checks the expected state.
      expect(await store.update(payout.id, { status: "processing", attempts: 1 }, {})).toMatchObject({ id: payout.id });
      const cleared = await store.update(payout.id, { status: "processing", attempts: 1 }, { paymentRequest: null, sentAt: null, amountSats: null });
      expect(cleared).toMatchObject({ paymentRequest: null, sentAt: null, amountSats: null, paymentHash: "ab".repeat(32) });
      expect((await store.listByStatus("processing")).map((p) => p.id)).toContain(payout.id);
    });

    it("unknown ids read as nothing", async () => {
      expect(await store.get(crypto.randomUUID())).toBeUndefined();
      expect(await store.findByBitnob({ bitnobPayoutId: "nope" })).toBeUndefined();
      expect(await store.findByBitnob({})).toBeUndefined();
    });

    it("kill the server mid-payout and restart: the new process resumes from the store and pays once", async () => {
      const payments = new Map<string, LightningPayment>();
      let settled = 0;
      let dead = false;
      const rails = {
        async payLightningInvoice(input: PayLightningInput): Promise<LightningPayment> {
          const existing = payments.get(input.reference);
          if (existing) return existing;
          const p = { id: `lnp-${input.reference}`, status: "paid", reference: input.reference, preimage: "cd".repeat(32) };
          payments.set(input.reference, p);
          settled++;
          // Process A dies while waiting for the answer: it never comes back.
          if (dead) return new Promise<never>(() => {});
          return p;
        },
        async getLightningPayment(id: string): Promise<LightningPayment> {
          for (const p of payments.values()) if (p.id === id) return p;
          throw new Error("404");
        },
      };
      const service = () =>
        new PayoutService({
          rails,
          resolver: { invoiceFor: async (_a, msat) => ({ bolt11: `lntb-${msat}`, paymentHash: "ef".repeat(32), amountMsat: msat, expiresAt: new Date(Date.now() + 600_000).toISOString() }) },
          rates: { xofPerUsdt: async () => 600, usdtPerBtc: async () => 100_000 },
          store,
          emit: () => {},
          getPayee: async () => ({ lightningAddress: "awa@blink.sv" }),
          log: { info() {}, warn() {}, error() {} },
        });
      const req = { bountyId: bounty(3), userId: "github:awa-dev", amountXof: 10_000 };
      dead = true;
      void service().start(req);
      for (let i = 0; i < 50 && !(await store.getByBounty(bounty(3)))?.sentAt; i++) await new Promise((r) => setTimeout(r, 20));
      expect((await store.getByBounty(bounty(3)))!).toMatchObject({ status: "processing", attempts: 1 });

      dead = false;
      const b = service();
      await b.resume();
      await b.start(req); // a redelivered trigger after the restart, too
      expect((await store.getByBounty(bounty(3)))!).toMatchObject({ status: "succeeded", attempts: 1, preimage: "cd".repeat(32) });
      // (resume also drives the other rows this suite left `processing`: only this bounty is checked.)
      const mine = [...payments.keys()].filter((k) => k.startsWith(`pay-${bounty(3)}-`));
      expect(mine).toEqual([`pay-${bounty(3)}-1`]);
      expect(settled).toBe(payments.size);
    });
  });
}

const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
contract("InMemoryPayoutStore", async () => ({ store: new InMemoryPayoutStore(), bounty: (n) => ids[n]! }));

describe.skipIf(!url)("on Postgres (DATABASE_URL)", () => {
  const name = `bitbounty_test_payouts_${process.pid}_${Date.now()}`;
  let admin: pg.Client;
  let conn: ReturnType<typeof createDb>;

  afterAll(async () => {
    await conn?.close();
    await admin?.query(`drop database if exists "${name}"`);
    await admin?.end();
  });

  // The seed's bounties without a payout row (payouts.bounty_id is a foreign key).
  const free = ["unfunded", "funded", "claimed", "submitted"] as const;
  contract("DrizzlePayoutStore", async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database "${name}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${name}`;
    conn = createDb(testUrl.toString());
    await runMigrations(conn.db);
    await seed(conn.db);
    return { store: new DrizzlePayoutStore(conn.db), bounty: (n) => SEED_IDS.bounty(free[n]!) };
  });
});
