import { BitnobError, type LightningPayment, type PayLightningInput, type RequestOptions } from "@bitbounty/bitnob";
import type { InternalEvent, Payout } from "@bitbounty/core";
import { describe, expect, it, vi } from "vitest";
import { signBitnobPayload } from "../src/bitnob/signature.js";
import { bitnobWebhookRoutes } from "../src/bitnob/webhook.js";
import { GithubDispatcher } from "../src/github/dispatcher.js";
import { InMemoryEventStore } from "../src/github/event-store.js";
import {
  BankCodes,
  InMemoryPayoutStore,
  LnurlError,
  PayoutConfigError,
  PayoutService,
  maskPhone,
  payoutSats,
  readBankCodeFallback,
  toLightningOutcome,
  type LightningRails,
  type LnurlResolver,
  type PayoutStore,
} from "../src/payouts/index.js";

const NOW = new Date("2026-10-18T00:00:00Z");
/** 600 FCFA/USDT × 100 000 USDT/BTC = 60 000 000 FCFA/BTC → 10 000 FCFA = 16 666.67 sats → 16 666. */
const RATES = { xofPerUsdt: async () => 600, usdtPerBtc: async () => 100_000 };
const SATS = 16_666;

/**
 * What one `POST /api/lightning/pay` does at the fake Bitnob:
 * - pending / paid / failed: Bitnob takes it and answers with that status;
 * - paid-then-timeout / pending-then-502: Bitnob takes it, the answer is lost;
 * - lost: the request never reached Bitnob (timeout), nothing exists;
 * - 403 / 422 / 409 / 500: Bitnob answers that error; 403/422 create nothing.
 */
type PayMode = "pending" | "paid" | "failed" | "paid-then-timeout" | "pending-then-502" | "lost" | "403" | "422" | "409" | "500";

/**
 * A fake Bitnob Lightning wallet with the two guarantees the real one has:
 * pay is idempotent on `reference` (a replay returns the existing payment), and a BOLT11 settles
 * at most once. `settlements` counts money that actually left.
 */
class FakeLightning implements LightningRails {
  payments = new Map<string, LightningPayment & { request: string }>();
  calls: PayLightningInput[] = [];
  opts: (RequestOptions | undefined)[] = [];
  /** request (BOLT11) → reference that settled it. */
  settled = new Map<string, string>();
  /** Consumed one per pay call that creates a payment; "pending" when empty. Replays of a known reference don't consume. */
  plan: PayMode[] = [];
  getError: (() => Error) | null = null;
  private n = 0;

  get settlements() {
    return this.settled.size;
  }

  async payLightningInvoice(input: PayLightningInput, opts?: RequestOptions): Promise<LightningPayment> {
    this.calls.push(input);
    this.opts.push(opts);
    const existing = this.payments.get(input.reference);
    if (existing) return { ...existing };
    const mode = this.plan.shift() ?? "pending";
    if (mode === "lost") throw new BitnobError("POST /api/lightning/pay: timed out", 0, "TIMEOUT");
    if (mode === "403") throw new BitnobError("POST /api/lightning/pay failed: 403 FEATURE_NOT_ENABLED", 403, "FEATURE_NOT_ENABLED");
    if (mode === "422") throw new BitnobError("POST /api/lightning/pay failed: 422 INSUFFICIENT_BALANCE", 422, "INSUFFICIENT_BALANCE");
    if (mode === "500") throw new BitnobError("POST /api/lightning/pay failed: 500 INTERNAL", 500, "INTERNAL");
    const p = { id: `lnp-${++this.n}`, status: "pending", reference: input.reference, request: input.request };
    this.payments.set(input.reference, p);
    if (mode === "409") throw new BitnobError("POST /api/lightning/pay failed: 409 DUPLICATE_KEY_ERROR", 409, "DUPLICATE_KEY_ERROR");
    if (mode === "paid" || mode === "paid-then-timeout") this.settle(input.reference);
    if (mode === "failed") p.status = "failed";
    if (mode === "paid-then-timeout") throw new BitnobError("POST /api/lightning/pay: timed out", 0, "TIMEOUT");
    if (mode === "pending-then-502") throw new BitnobError("POST /api/lightning/pay failed: 502 BAD_GATEWAY", 502, "BAD_GATEWAY");
    return { ...p };
  }

  async getLightningPayment(id: string): Promise<LightningPayment> {
    if (this.getError) throw this.getError();
    for (const p of this.payments.values()) if (p.id === id) return { ...p };
    throw new BitnobError(`GET /api/lightning/invoices/${id} failed: 404`, 404, "NOT_FOUND");
  }

  /** The Lightning network delivers the payment (once per invoice). */
  settle(reference: string) {
    const p = this.payments.get(reference)!;
    if (this.settled.has(p.request)) {
      p.status = "failed";
      return;
    }
    this.settled.set(p.request, reference);
    p.status = "paid";
    p.preimage = "ab".repeat(32);
  }

  fail(reference: string) {
    this.payments.get(reference)!.status = "failed";
  }

  pending() {
    return [...this.payments.values()].filter((p) => p.status === "pending");
  }

  references() {
    return new Set(this.calls.map((c) => c.reference));
  }
}

/** LNURL-pay fake: a fresh invoice (distinct payment hash) for every call, or the configured error. */
class FakeResolver implements LnurlResolver {
  calls: { address: string; msat: number }[] = [];
  errors: Error[] = [];
  expiresInMs = 600_000;
  now = () => NOW;
  async invoiceFor(address: string, amountMsat: number) {
    this.calls.push({ address, msat: amountMsat });
    const err = this.errors.shift();
    if (err) throw err;
    const n = this.calls.length;
    return {
      bolt11: `lntb-invoice-${n}-${amountMsat}`,
      paymentHash: n.toString(16).padStart(64, "0"),
      amountMsat,
      expiresAt: new Date(this.now().getTime() + this.expiresInMs).toISOString(),
    };
  }
}

function setup(over: { ln?: FakeLightning; resolver?: FakeResolver; store?: PayoutStore; emit?: (e: InternalEvent) => void | Promise<void>; now?: () => Date } = {}) {
  const ln = over.ln ?? new FakeLightning();
  const resolver = over.resolver ?? new FakeResolver();
  const store = over.store ?? new InMemoryPayoutStore();
  const events: InternalEvent[] = [];
  const timers: (() => void)[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new PayoutService({
    rails: ln,
    resolver,
    rates: RATES,
    store,
    emit: async (e) => {
      if (over.emit) await over.emit(e);
      events.push(e);
    },
    getPayee: async (userId) => {
      if (userId === "github:nobody") throw new PayoutConfigError("no payout account for @nobody");
      return { lightningAddress: "awa@blink.sv" };
    },
    retryDelaysMs: [5_000, 30_000],
    schedule: (fn) => void timers.push(fn),
    now: over.now ?? (() => NOW),
    log,
  });
  const flushRetries = async () => {
    for (const t of timers.splice(0)) t();
    await new Promise((r) => setImmediate(r));
  };
  const types = () => events.map((e) => e.type);
  return { service, ln, resolver, store, events, timers, log, flushRetries, types };
}

const START = { bountyId: "b1", userId: "github:awa", amountXof: 10_000 };

describe("FCFA → sats", () => {
  it("integer, rounded down, with the rate used", async () => {
    expect(await payoutSats(RATES, 10_000)).toEqual({ sats: SATS, xofPerBtc: 60_000_000 });
    expect((await payoutSats(RATES, 599)).sats).toBe(998); // 998.33
    await expect(payoutSats({ xofPerUsdt: async () => 0, usdtPerBtc: async () => 1 }, 1)).rejects.toThrow("unusable");
  });

  it("maps Bitnob Lightning statuses; a preimage is proof of payment", () => {
    expect(toLightningOutcome("PAID")).toBe("success");
    expect(toLightningOutcome("settled")).toBe("success");
    expect(toLightningOutcome("expired")).toBe("failed");
    expect(toLightningOutcome("pending")).toBe("processing");
    expect(toLightningOutcome(undefined, "ab".repeat(32))).toBe("success");
    expect(toLightningOutcome("in_flight", "")).toBe("processing");
  });
});

describe("happy path", () => {
  it("Lightning Address → invoice for the exact sats → one pay call (pay-<bounty>-1) → paid on poll", async () => {
    const { service, ln, resolver, store, events, types } = setup();
    const row = await service.start(START);
    expect(resolver.calls).toEqual([{ address: "awa@blink.sv", msat: SATS * 1000 }]);
    expect(ln.calls).toEqual([{ request: `lntb-invoice-1-${SATS * 1000}`, reference: "pay-b1-1", max_fee: 167 }]);
    expect(ln.opts).toEqual([{ retries: 0 }]);
    expect(row).toMatchObject({ status: "processing", attempts: 1, rail: "lightning", amountSats: SATS, xofPerBtc: 60_000_000, bitnobPayoutId: "lnp-1" });
    expect(row.sentAt).toBe(NOW.toISOString());

    ln.settle("pay-b1-1");
    await service.poll();
    const done = (await store.getByBounty("b1"))!;
    expect(done).toMatchObject({ status: "succeeded", paidAt: NOW.toISOString(), preimage: "ab".repeat(32) });
    expect(types()).toEqual(["payout.started", "payout.succeeded"]);
    expect(events[1]).toMatchObject({ bitnobPayoutId: "lnp-1" });
    expect(ln.settlements).toBe(1);
  });

  it("a pay call that answers paid right away is done without waiting", async () => {
    const { service, ln, types } = setup();
    ln.plan = ["paid"];
    expect(await service.start(START)).toMatchObject({ status: "succeeded" });
    expect(types()).toEqual(["payout.started", "payout.succeeded"]);
  });

  it("sends BITNOB_PAYOUT_CUSTOMER_ID when configured, the same on every call", async () => {
    const ln = new FakeLightning();
    const service = new PayoutService({
      rails: ln,
      resolver: new FakeResolver(),
      rates: RATES,
      store: new InMemoryPayoutStore(),
      emit: () => {},
      getPayee: async () => ({ lightningAddress: "awa@blink.sv" }),
      customerId: "cust-1",
      now: () => NOW,
      log: { info() {}, warn() {}, error() {} },
    });
    await service.start(START);
    expect(ln.calls[0]).toMatchObject({ customer_id: "cust-1" });
  });

  it("logs and errors never contain the full Lightning Address", async () => {
    const { service, log, resolver, store } = setup();
    resolver.errors = [new LnurlError("aw***@blink.sv: LNURL server unreachable", true)];
    await service.start(START);
    const all = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, (await store.getByBounty("b1"))!.lastError]);
    expect(all).not.toContain("awa@blink.sv");
  });
});

describe("never pays twice", () => {
  it("a duplicate trigger does nothing", async () => {
    const { service, ln } = setup();
    await service.start(START);
    await service.start(START);
    expect(ln.calls).toHaveLength(1);
  });

  it("two triggers at the same time: one row, one invoice, one payment", async () => {
    const { service, ln, resolver, types } = setup();
    await Promise.all([service.start(START), service.start(START), service.start(START)]);
    expect(resolver.calls).toHaveLength(1);
    expect(ln.calls).toHaveLength(1);
    expect(types()).toEqual(["payout.started"]);
  });

  it("refuses a second trigger with another recipient or amount", async () => {
    const { service } = setup();
    await service.start(START);
    await expect(service.start({ ...START, amountXof: 20_000 })).rejects.toThrow("another user or for another amount");
    await expect(service.start({ ...START, userId: "github:mallory" })).rejects.toThrow("another user or for another amount");
  });

  it("Bitnob times out on /lightning/pay but actually paid: no second payment", async () => {
    const { service, ln, store, types } = setup();
    ln.plan = ["paid-then-timeout"];
    const row = await service.start(START);
    expect(row).toMatchObject({ status: "processing", attempts: 1 });
    expect(row.lastError).toContain("outcome unknown");
    expect(types()).toEqual(["payout.started"]); // not failed: maybe paid

    await service.poll();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
    // The check replayed the SAME reference with the SAME invoice: Bitnob returned the existing payment.
    expect(ln.calls).toHaveLength(2);
    expect(new Set(ln.calls.map((c) => `${c.reference}|${c.request}`)).size).toBe(1);
    expect(ln.settlements).toBe(1);
    expect(types()).toEqual(["payout.started", "payout.succeeded"]);
  });

  it("the request never reached Bitnob (timeout): the replay is the first real send, paid once", async () => {
    const { service, ln, store } = setup();
    ln.plan = ["lost", "paid"];
    await service.start(START);
    expect(ln.payments.size).toBe(0);
    await service.poll();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(ln.references()).toEqual(new Set(["pay-b1-1"]));
    expect(ln.settlements).toBe(1);
  });

  it("502 after Bitnob took it, then status reads fail: stays processing, never a new reference", async () => {
    const { service, ln, store, timers } = setup();
    ln.plan = ["pending-then-502"];
    await service.start(START);
    ln.getError = () => new BitnobError("GET … failed: 503", 503, "UNAVAILABLE");
    for (let i = 0; i < 5; i++) await service.poll();
    const row = (await store.getByBounty("b1"))!;
    expect(row).toMatchObject({ status: "processing", attempts: 1 });
    expect(timers).toHaveLength(0);
    expect(ln.references()).toEqual(new Set(["pay-b1-1"]));
  });

  it("409 on pay (reference already used) is not a failure: maybe paid, we ask", async () => {
    const { service, ln, store, timers } = setup();
    ln.plan = ["409"];
    expect(await service.start(START)).toMatchObject({ status: "processing" });
    expect(timers).toHaveLength(0);
    ln.settle("pay-b1-1");
    await service.poll();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
  });

  it("success reported twice (poll + webhook), and late `pending` after `paid`: one payout.succeeded", async () => {
    const { service, ln, types } = setup();
    await service.start(START);
    ln.settle("pay-b1-1");
    await service.poll();
    await service.handleUpdate({ reference: "pay-b1-1", bitnobPaymentId: "lnp-1", status: "paid" });
    await service.handleUpdate({ reference: "pay-b1-1", bitnobPaymentId: "lnp-1", status: "pending" });
    expect(types()).toEqual(["payout.started", "payout.succeeded"]);
  });

  it("a webhook about an earlier attempt doesn't touch the current one", async () => {
    const { service, ln, store, flushRetries } = setup();
    ln.plan = ["failed", "pending"];
    await service.start(START);
    await flushRetries();
    expect((await store.getByBounty("b1"))!.attempts).toBe(2);
    await service.handleUpdate({ reference: "pay-b1-1", bitnobPaymentId: "lnp-1", status: "paid" });
    expect((await store.getByBounty("b1"))!.status).toBe("processing");
    expect(await service.handleUpdate({ reference: "pay-zzz-1", bitnobPaymentId: null, status: "paid" })).toBeNull();
  });
});

describe("retries", () => {
  it("a forced failure is retried with a new invoice and reference, 3 times, then failed (money stays reserved)", async () => {
    const { service, ln, resolver, store, types, flushRetries } = setup();
    ln.plan = ["failed", "failed", "failed"];
    await service.start(START);
    await flushRetries();
    await flushRetries();
    await flushRetries();
    expect((await store.getByBounty("b1"))!).toMatchObject({ status: "failed", attempts: 3 });
    expect(resolver.calls).toHaveLength(3);
    expect([...ln.references()]).toEqual(["pay-b1-1", "pay-b1-2", "pay-b1-3"]);
    expect(ln.settlements).toBe(0);
    expect(types()).toEqual(["payout.started", "payout.failed", "payout.started", "payout.failed", "payout.started", "payout.failed"]);
  });

  it("uses the configured backoff, and a new attempt starts only after Bitnob said the last one failed", async () => {
    const delays: number[] = [];
    const ln = new FakeLightning();
    const service = new PayoutService({
      rails: ln,
      resolver: new FakeResolver(),
      rates: RATES,
      store: new InMemoryPayoutStore(),
      emit: () => {},
      getPayee: async () => ({ lightningAddress: "awa@blink.sv" }),
      retryDelaysMs: [5_000, 30_000],
      schedule: (fn, ms) => {
        delays.push(ms);
        // When the retry runs, attempt 1's payment must be failed at Bitnob.
        expect(ln.payments.get(`pay-b1-${delays.length}`)?.status).toBe("failed");
        setImmediate(fn);
      },
      now: () => NOW,
      log: { info() {}, warn() {}, error() {} },
    });
    ln.plan = ["failed", "failed", "failed"];
    await service.start(START);
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    expect(delays).toEqual([5_000, 30_000]);
  });

  it("fails once (Bitnob reports failed later), succeeds on attempt 2: paid once", async () => {
    const { service, ln, store, flushRetries } = setup();
    await service.start(START);
    ln.fail("pay-b1-1");
    await service.poll();
    await flushRetries();
    ln.settle("pay-b1-2");
    await service.poll();
    expect((await store.getByBounty("b1"))!).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(ln.settlements).toBe(1);
  });

  it("403 FEATURE_NOT_ENABLED (our sandbox today): not retryable, nothing paid", async () => {
    const { service, ln, timers, types } = setup();
    ln.plan = ["403"];
    const row = await service.start(START);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row.lastError).toContain("FEATURE_NOT_ENABLED");
    expect(timers).toHaveLength(0);
    expect(ln.payments.size).toBe(0);
    expect(types()).toEqual(["payout.started", "payout.failed"]);
  });

  it("422 (e.g. balance) is a refusal: nothing paid, retried later", async () => {
    const { service, ln, timers } = setup();
    ln.plan = ["422"];
    expect(await service.start(START)).toMatchObject({ status: "pending", attempts: 1 });
    expect(timers).toHaveLength(1);
    expect(ln.payments.size).toBe(0);
  });

  it("5xx on pay is NOT a refusal: maybe paid, stays processing", async () => {
    const { service, ln, timers } = setup();
    ln.plan = ["500"];
    expect(await service.start(START)).toMatchObject({ status: "processing" });
    expect(timers).toHaveLength(0);
  });

  it("an invoice that expired before it was sent is replaced (new attempt), never sent", async () => {
    let now = NOW;
    const resolver = new FakeResolver();
    const store = new InMemoryPayoutStore();
    const a = setup({ resolver, store, now: () => now });
    // Crash right after the invoice was saved.
    await store.create({ id: "p1", bountyId: "b1", userId: "github:awa", amountXof: 10_000, quoteId: null, bitnobPayoutId: null, reference: "pay-b1", status: "processing", attempts: 1, lastError: null, paidAt: null, rail: "lightning", paymentRequest: "lntb-old", amountSats: SATS, invoiceExpiresAt: new Date(NOW.getTime() + 60_000).toISOString() });
    now = new Date(NOW.getTime() + 10 * 60_000);
    await a.service.resume();
    expect(a.ln.calls).toHaveLength(0);
    expect((await store.get("p1"))!).toMatchObject({ status: "pending", lastError: "invoice expired before it was sent" });
  });
});

describe("LNURL / account errors: nothing reaches Bitnob", () => {
  it("LNURL server down or slow → attempt failed cleanly, retried later, pay never called", async () => {
    const { service, ln, resolver, store, timers, flushRetries } = setup();
    resolver.errors = [new LnurlError("aw***@blink.sv: LNURL server timed out after 10000 ms", true)];
    const row = await service.start(START);
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(row.lastError).toMatch(/^lnurl unreachable: /);
    expect(timers).toHaveLength(1);
    expect(ln.calls).toHaveLength(0);
    await flushRetries();
    expect((await store.getByBounty("b1"))!).toMatchObject({ status: "processing", attempts: 2 });
    expect(ln.calls).toHaveLength(1);
  });

  it("invoice for a different amount (or out of min/max) → failed, not retried, nothing paid", async () => {
    const { service, ln, resolver, timers } = setup();
    resolver.errors = [new LnurlError("aw***@blink.sv: invoice is for 16667000 msat, we asked 16666000 msat", false)];
    const row = await service.start(START);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row.lastError).toMatch(/^lnurl refused: /);
    expect(timers).toHaveLength(0);
    expect(ln.calls).toHaveLength(0);
  });

  it("no payout account → failed at once, not retried", async () => {
    const { service, ln, timers } = setup();
    const row = await service.start({ ...START, userId: "github:nobody" });
    expect(row).toMatchObject({ status: "failed" });
    expect(row.lastError).toContain("no payout account for @nobody");
    expect(timers).toHaveLength(0);
    expect(ln.calls).toHaveLength(0);
  });

  it("a rate outage is retryable", async () => {
    const store = new InMemoryPayoutStore();
    const timers: unknown[] = [];
    const service = new PayoutService({
      rails: new FakeLightning(),
      resolver: new FakeResolver(),
      rates: { xofPerUsdt: () => Promise.reject(new Error("GET /api/exchange-rates: network error")), usdtPerBtc: RATES.usdtPerBtc },
      store,
      emit: () => {},
      getPayee: async () => ({ lightningAddress: "awa@blink.sv" }),
      schedule: (fn) => void timers.push(fn),
      now: () => NOW,
      log: { info() {}, warn() {}, error() {} },
    });
    expect(await service.start(START)).toMatchObject({ status: "pending" });
    expect(timers).toHaveLength(1);
  });
});

describe("the bounty must be `paying` before any money moves (I2 gap fixed in B6)", () => {
  it("payout.started refused (save failed / bounty on hold) → no LNURL, no Bitnob call, attempt undone", async () => {
    let refuse = true;
    const { service, ln, resolver, store, types } = setup({
      emit: (e) => {
        if (e.type === "payout.started" && refuse) throw new Error("bounty b1 is verified, not moved to paying");
      },
    });
    const row = await service.start(START);
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
    expect(row.lastError).toContain("wasn't moved to paying");
    expect(resolver.calls).toHaveLength(0);
    expect(ln.calls).toHaveLength(0);
    expect(types()).toEqual([]);

    // Later (bounty saved fine, e.g. after /pay or on boot): the same row pays, attempt 1, once.
    refuse = false;
    await service.start(START);
    expect((await store.getByBounty("b1"))!).toMatchObject({ status: "processing", attempts: 1 });
    expect(ln.references()).toEqual(new Set(["pay-b1-1"]));
  });

  it("order is: payout.started (gate) → LNURL → Bitnob", async () => {
    const order: string[] = [];
    const ln = new FakeLightning();
    const pay = ln.payLightningInvoice.bind(ln);
    ln.payLightningInvoice = async (i, o) => (order.push("bitnob"), pay(i, o));
    const resolver = new FakeResolver();
    const inv = resolver.invoiceFor.bind(resolver);
    resolver.invoiceFor = async (a, m) => (order.push("lnurl"), inv(a, m));
    const { service } = setup({ ln, resolver, emit: (e) => void order.push(e.type) });
    await service.start(START);
    expect(order).toEqual(["payout.started", "lnurl", "bitnob"]);
  });
});

describe("kill the server mid-payout and restart → resumes, pays once", () => {
  const row = (over: Partial<Payout>): Payout => ({
    id: "p1",
    bountyId: "b1",
    userId: "github:awa",
    amountXof: 10_000,
    quoteId: null,
    bitnobPayoutId: null,
    reference: "pay-b1",
    status: "processing",
    attempts: 1,
    lastError: null,
    paidAt: null,
    rail: "lightning",
    ...over,
  });

  it("killed after the claim, before payout.started: restart runs the gate again, then pays once", async () => {
    const store = new InMemoryPayoutStore();
    await store.create(row({}));
    const { service, ln, types } = setup({ store });
    await service.resume();
    expect(types()).toEqual(["payout.started"]);
    expect(ln.references()).toEqual(new Set(["pay-b1-1"]));
  });

  it("killed after the invoice was saved, before sending: restart sends it once", async () => {
    const store = new InMemoryPayoutStore();
    await store.create(row({ paymentRequest: "lntb-saved", amountSats: SATS, invoiceExpiresAt: new Date(NOW.getTime() + 600_000).toISOString() }));
    const { service, ln, resolver } = setup({ store });
    await service.resume();
    expect(resolver.calls).toHaveLength(0);
    expect(ln.calls).toEqual([{ request: "lntb-saved", reference: "pay-b1-1", max_fee: 167 }]);
  });

  it("killed while the pay call was in flight (Bitnob paid it): restart finds it paid, pays nothing more", async () => {
    const store = new InMemoryPayoutStore();
    const ln = new FakeLightning();
    // Server A: the pay request reaches Bitnob (and settles) but A dies before reading the answer.
    const a = setup({ ln, store });
    const pay = ln.payLightningInvoice.bind(ln);
    ln.payLightningInvoice = async (i, o) => {
      await pay(i, o);
      ln.settle(i.reference);
      return new Promise<never>(() => {}); // never answers: the process is gone
    };
    void a.service.start(START);
    await new Promise((r) => setImmediate(r));
    expect((await store.getByBounty("b1"))!.sentAt).toBeTruthy();

    // Server B: same database, fresh process.
    ln.payLightningInvoice = pay;
    const b = setup({ ln, store });
    await b.service.resume();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(ln.settlements).toBe(1);
    expect(ln.references()).toEqual(new Set(["pay-b1-1"]));
    expect(b.types()).toEqual(["payout.succeeded"]);
  });

  it("a lost retry timer is picked up on restart", async () => {
    const store = new InMemoryPayoutStore();
    const a = setup({ store });
    a.ln.plan = ["failed"];
    await a.service.start(START);
    expect((await store.getByBounty("b1"))!.status).toBe("pending");
    const b = setup({ store, ln: a.ln });
    await b.service.resume();
    expect((await store.getByBounty("b1"))!).toMatchObject({ status: "processing", attempts: 2 });
  });

  it("a database error while polling is logged, never an unhandled rejection", async () => {
    const store = new InMemoryPayoutStore();
    store.listByStatus = () => Promise.reject(new Error('column "amount_sats" does not exist'));
    const { service, log } = setup({ store });
    await expect(service.poll()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("payouts not readable"));
  });

  it("mobile money rows (seed, B2) are never driven over Lightning", async () => {
    const store = new InMemoryPayoutStore();
    await store.create(row({ rail: "mobile_money", quoteId: "q", bitnobPayoutId: "PAYOUT_1" }));
    await store.create(row({ id: "p2", bountyId: "b2", reference: "pay-b2", status: "pending", attempts: 0, rail: undefined }));
    const { service, ln, types } = setup({ store });
    await service.resume();
    expect(ln.calls).toHaveLength(0);
    expect(types()).toEqual([]);
  });
});

describe("invariant (fuzzed): at most one payment ever settles per bounty", () => {
  const rng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const MODES: PayMode[] = ["pending", "paid", "failed", "paid-then-timeout", "pending-then-502", "lost", "409", "422", "500"];

  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i", async (seed) => {
    const rand = rng(seed);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const ln = new FakeLightning();
    ln.plan = Array.from({ length: 12 }, () => pick(MODES));
    const resolver = new FakeResolver();
    if (rand() < 0.3) resolver.errors = [new LnurlError("down", true)];
    const store = new InMemoryPayoutStore();
    let s = setup({ ln, resolver, store });
    await Promise.all([s.service.start(START), rand() < 0.5 ? s.service.start(START) : Promise.resolve()]);

    for (let step = 0; step < 30; step++) {
      const action = pick(["poll", "restart", "retry", "settle", "fail", "webhook", "start"] as const);
      const pending = ln.pending();
      if (action === "poll") await s.service.poll();
      else if (action === "restart") {
        s = setup({ ln, resolver, store });
        await s.service.resume();
      } else if (action === "retry") await s.flushRetries();
      else if (action === "start") await s.service.start(START);
      else if (action === "settle" && pending.length) ln.settle(pick(pending).reference!);
      else if (action === "fail" && pending.length) ln.fail(pick(pending).reference!);
      else if (action === "webhook" && ln.payments.size) {
        const p = pick([...ln.payments.values()]);
        await s.service.handleUpdate({ reference: p.reference!, bitnobPaymentId: p.id!, status: p.status! });
      }
      const paid = [...ln.payments.values()].filter((p) => p.status === "paid");
      expect(paid.length, `seed ${seed} step ${step} ${action}`).toBeLessThanOrEqual(1);
      expect(ln.settlements).toBeLessThanOrEqual(1);
      // A second reference is only ever sent after the first one failed at Bitnob (or never existed there).
      const refs = [...ln.references()];
      for (const ref of refs.slice(0, -1)) {
        const p = ln.payments.get(ref);
        expect(!p || p.status === "failed", `seed ${seed}: ${ref} is ${p?.status} but a later attempt was sent`).toBe(true);
      }
      const row = (await store.getByBounty("b1"))!;
      if (row.status === "succeeded") expect(ln.payments.get(`pay-b1-${row.attempts}`)?.status).toBe("paid");
    }
  });
});

describe("wiring with the B5 receiver", () => {
  it("a signed Bitnob webhook carrying our reference settles the payout", async () => {
    const { service, store } = setup();
    const dispatcher = new GithubDispatcher();
    service.register(dispatcher);
    const app = bitnobWebhookRoutes({ secret: "s", store: new InMemoryEventStore(), dispatcher, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await service.start(START);
    const body = JSON.stringify({ event: "lightning.payment.success", event_id: "evt-1", data: { id: "lnp-1", reference: "pay-b1-1", status: "paid" } });
    const res = await app.request("/webhooks/bitnob", { method: "POST", body, headers: { "x-bitnob-signature": signBitnobPayload("s", body) } });
    expect(res.status).toBe(200);
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
  });

  it("ignores mobile money payout webhooks and events that aren't ours", async () => {
    const { service, store } = setup();
    const dispatcher = new GithubDispatcher();
    service.register(dispatcher);
    const app = bitnobWebhookRoutes({ secret: "s", store: new InMemoryEventStore(), dispatcher, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await service.start(START);
    for (const [i, payload] of [
      { event: "payouts.withdrawal.success", event_id: "e1", data: { id: "lnp-1", reference: "pay-b1-1", status: "success" } },
      { event: "lightning.payment.success", event_id: "e2", data: { reference: "fund-b1-1", status: "paid" } },
    ].entries()) {
      const body = JSON.stringify(payload);
      const res = await app.request("/webhooks/bitnob", { method: "POST", body, headers: { "x-bitnob-signature": signBitnobPayload("s", body) } });
      expect(res.status, String(i)).toBe(200);
    }
    expect((await store.getByBounty("b1"))!.status).toBe("processing");
  });
});

// Mobile money helpers kept for B3's test payout (onboarding).
describe("BankCodes / phone masking (B3)", () => {
  it("caches a non-empty directory per country and errors on an unknown provider", async () => {
    const getBanks = vi.fn(async () => [{ bank_name: "Wave", bank_code: "W" }]);
    const banks = new BankCodes({ getBanks });
    expect(await banks.resolve("sn", "wave")).toBe("W");
    expect(await banks.resolve("SN", "wave")).toBe("W");
    expect(getBanks).toHaveBeenCalledTimes(1);
    await expect(banks.resolve("SN", "orange")).rejects.toThrow("no Bitnob bank_code for orange in SN");
  });

  it("readBankCodeFallback parses BITNOB_<CC>_BANK_CODES and rejects bad config", () => {
    expect(readBankCodeFallback({ BITNOB_SN_BANK_CODES: '{"wave":"W1","orange":""}', OTHER: "x" })).toEqual({ SN: { wave: "W1" } });
    expect(() => readBankCodeFallback({ BITNOB_SN_BANK_CODES: "nope" })).toThrow("not valid JSON");
  });

  it("maskPhone keeps the prefix and the last two digits", () => {
    expect(maskPhone("+221771234567")).toBe("+2217******67");
    expect(maskPhone("+22")).toBe("+**");
  });
});
