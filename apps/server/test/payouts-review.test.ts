import { BitnobError, type LightningPayment, type PayLightningInput } from "@bitbounty/bitnob";
import type { InternalEvent, Payout } from "@bitbounty/core";
import { describe, expect, it, vi } from "vitest";
import { payoutView } from "../src/api/views.js";
import {
  InMemoryPayoutStore,
  PayoutService,
  readMaxPayoutSats,
  type LightningRails,
  type LnurlResolver,
  type PayoutServiceOptions,
} from "../src/payouts/index.js";
import { publicPayoutReason } from "../src/settlement/status-extras.js";

/**
 * Review fixes for #102 (B1–B4, M1, L1, L3). The fake Bitnob here is deliberately **not**
 * idempotent on `reference`: a second pay with a known reference is refused (400 duplicate),
 * the way a real API may behave, so any code path that "replays to find out" and then reads the
 * refusal as "not paid" shows up as a second payment.
 */
const NOW = new Date("2026-10-18T00:00:00Z");
const RATES = { xofPerUsdt: async () => 600, usdtPerBtc: async () => 100_000 }; // 60 M FCFA/BTC
const SATS = 16_666; // 10 000 FCFA
const START = { bountyId: "b1", userId: "github:awa", amountXof: 10_000 };

type Mode = "pending" | "paid" | "lost" | "422";

class StrictBitnob implements LightningRails {
  calls: PayLightningInput[] = [];
  gets: string[] = [];
  lookups: { reference?: string; paymentHash?: string }[] = [];
  payments = new Map<string, LightningPayment & { request: string }>();
  /** BOLT11 → reference that settled it: money that actually left. */
  settled = new Map<string, string>();
  plan: Mode[] = [];
  /** `GET /api/lightning/invoices/:id` 404s for payments (unverified endpoint). */
  getById404 = true;
  /** Lookup by reference finds the payment (true) or never does (false). */
  lookupWorks = true;
  private n = 0;

  async payLightningInvoice(input: PayLightningInput): Promise<LightningPayment> {
    this.calls.push(input);
    if (this.payments.has(input.reference)) {
      throw new BitnobError("POST /api/lightning/pay failed: 400 DUPLICATE_REFERENCE: reference already used", 400, "DUPLICATE_REFERENCE");
    }
    const mode = this.plan.shift() ?? "pending";
    if (mode === "lost") throw new BitnobError("POST /api/lightning/pay: timed out", 0, "TIMEOUT");
    if (mode === "422") throw new BitnobError("POST /api/lightning/pay failed: 422 INSUFFICIENT_BALANCE", 422, "INSUFFICIENT_BALANCE");
    const p = { id: `lnp-${++this.n}`, status: "pending", reference: input.reference, request: input.request };
    this.payments.set(input.reference, p);
    if (mode === "paid") this.settle(input.reference);
    return { ...p };
  }

  async getLightningPayment(id: string): Promise<LightningPayment> {
    this.gets.push(id);
    if (!this.getById404) for (const p of this.payments.values()) if (p.id === id) return { ...p };
    throw new BitnobError(`GET /api/lightning/invoices/${id} failed: 404`, 404, "NOT_FOUND");
  }

  async findLightningPayment(q: { reference?: string; paymentHash?: string }): Promise<LightningPayment | null> {
    this.lookups.push(q);
    if (!this.lookupWorks) return null;
    const p = q.reference ? this.payments.get(q.reference) : undefined;
    return p ? { ...p } : null;
  }

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
}

class Resolver implements LnurlResolver {
  calls = 0;
  expiresInMs = 600_000;
  /** Resolves only when `release()` is called (to hold a worker inside LNURL). */
  hold: Promise<void> | null = null;
  constructor(private readonly now: () => Date) {}
  async invoiceFor(_address: string, amountMsat: number) {
    const n = ++this.calls;
    if (this.hold) await this.hold;
    return {
      bolt11: `lnbc-invoice-${n}`,
      paymentHash: n.toString(16).padStart(64, "0"),
      amountMsat,
      expiresAt: new Date(this.now().getTime() + this.expiresInMs).toISOString(),
    };
  }
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

const tick = () => new Promise((r) => setImmediate(r));

function setup(over: Partial<PayoutServiceOptions> & { ln?: StrictBitnob; store?: InMemoryPayoutStore; clock?: { now: Date } } = {}) {
  const clock = over.clock ?? { now: NOW };
  const ln = over.ln ?? new StrictBitnob();
  const store = over.store ?? new InMemoryPayoutStore();
  const resolver = (over.resolver as Resolver | undefined) ?? new Resolver(() => clock.now);
  const events: InternalEvent[] = [];
  const timers: (() => void)[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new PayoutService({
    rails: ln,
    rates: RATES,
    store,
    getPayee: async () => ({ lightningAddress: "awa@blink.sv" }),
    schedule: (fn) => void timers.push(fn),
    now: () => clock.now,
    log,
    ...over,
    resolver,
    emit: async (e) => {
      await over.emit?.(e);
      events.push(e);
    },
  });
  const flushRetries = async () => {
    for (const t of timers.splice(0)) t();
    await tick();
  };
  return { service, ln, store, resolver, events, timers, log, clock, flushRetries };
}

const later = (clock: { now: Date }, ms: number) => (clock.now = new Date(clock.now.getTime() + ms));

describe("B1: one invoice and one send per attempt, whatever races", () => {
  it("B1: a poll tick while payout.started is being applied does not send a second payment", async () => {
    const gate = deferred();
    let first = true;
    const s = setup({
      emit: async (e) => {
        if (e.type === "payout.started" && first) {
          first = false;
          await gate.promise;
        }
      },
    });
    const started = s.service.start(START);
    await tick();
    await s.service.poll(); // the row is `processing`, no invoice yet: must be left alone
    gate.release();
    await started;
    await s.service.poll();
    expect(s.ln.calls).toHaveLength(1);
    expect(s.resolver.calls).toBe(1);
    expect(s.ln.settled.size).toBeLessThanOrEqual(1);
  });

  it("B1: two processes (one polling while the other resolves LNURL) give exactly one pay call", async () => {
    const store = new InMemoryPayoutStore();
    const clock = { now: NOW };
    const ln = new StrictBitnob();
    const slow = new Resolver(() => clock.now);
    const hold = deferred();
    slow.hold = hold.promise;
    const a = setup({ store, ln, clock, resolver: slow });
    const b = setup({ store, ln, clock }); // a second server on the same database
    const started = a.service.start(START);
    await tick();
    expect(slow.calls).toBe(1); // A is inside LNURL resolution
    await b.service.poll(); // B finds the attempt processing without an invoice and drives it
    hold.release();
    await started;
    expect(ln.calls).toHaveLength(1);
    const row = (await store.getByBounty("b1"))!;
    expect(row.paymentRequest).toBe(ln.calls[0]!.request);
  });

  it("B1: the store refuses to save a second invoice or a second sentAt for the same attempt", async () => {
    const store = new InMemoryPayoutStore();
    const base: Payout = { id: "p1", bountyId: "b1", userId: "github:awa", amountXof: 1, quoteId: null, bitnobPayoutId: null, reference: "pay-b1", status: "processing", attempts: 1, lastError: null, paidAt: null, rail: "lightning" };
    await store.create(base);
    expect(await store.update("p1", { status: "processing", attempts: 1, unset: ["paymentRequest"] }, { paymentRequest: "inv-a" })).toBeTruthy();
    expect(await store.update("p1", { status: "processing", attempts: 1, unset: ["paymentRequest"] }, { paymentRequest: "inv-b" })).toBeNull();
    expect(await store.update("p1", { status: "processing", attempts: 1, unset: ["sentAt"] }, { sentAt: NOW.toISOString() })).toBeTruthy();
    expect(await store.update("p1", { status: "processing", attempts: 1, unset: ["sentAt"] }, { sentAt: NOW.toISOString() })).toBeNull();
    expect((await store.get("p1"))!.paymentRequest).toBe("inv-a");
  });
});

describe("B2: a refusal is only 'not paid' for the first request of an attempt", () => {
  it("B2: pay answered pending, invoice expired, nothing readable → stuck, never a new invoice", async () => {
    const s = setup();
    s.ln.lookupWorks = false;
    await s.service.start(START);
    expect(s.ln.calls).toHaveLength(1);
    later(s.clock, 11 * 60_000); // the invoice (10 min) expired
    for (let i = 0; i < 6; i++) {
      await s.service.poll();
      await s.flushRetries();
      later(s.clock, 3_600_000);
    }
    const row = (await s.store.getByBounty("b1"))!;
    expect(row).toMatchObject({ status: "processing", attempts: 1 });
    expect(row.lastError).toMatch(/^stuck: /);
    expect(s.resolver.calls).toBe(1);
    expect(new Set(s.ln.calls.map((c) => c.request))).toEqual(new Set(["lnbc-invoice-1"]));
    expect(s.log.error).toHaveBeenCalledWith(expect.stringContaining("stuck"));
    // Bitnob's status shows up later (webhook): applied, paid once.
    s.ln.settle("pay-b1-1");
    await s.service.handleUpdate({ reference: "pay-b1-1", bitnobPaymentId: "lnp-1", status: "paid" });
    expect((await s.store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(s.ln.settled.size).toBe(1);
  });

  it("B2: a re-send refused as 'reference already used' is not a failure", async () => {
    const s = setup();
    s.ln.lookupWorks = false;
    await s.service.start(START);
    await s.service.poll(); // nothing readable → one re-send → 400 duplicate
    expect(s.ln.calls).toHaveLength(2);
    const row = (await s.store.getByBounty("b1"))!;
    expect(row).toMatchObject({ status: "processing", attempts: 1 });
    expect(row.lastError).toContain("outcome unknown");
    expect(s.timers).toHaveLength(0);
    expect(s.events.map((e) => e.type)).toEqual(["payout.started"]);
  });

  it("B2: after Bitnob refused the first send (422), the next attempt pays the same invoice", async () => {
    const s = setup();
    s.ln.plan = ["422"];
    await s.service.start(START);
    expect((await s.store.getByBounty("b1"))!.status).toBe("pending");
    await s.flushRetries();
    expect(s.ln.calls.map((c) => c.reference)).toEqual(["pay-b1-1", "pay-b1-2"]);
    expect(s.ln.calls[1]!.request).toBe(s.ln.calls[0]!.request);
    expect(s.resolver.calls).toBe(1);
  });
});

describe("B3: status checks read, re-send at most once, back off", () => {
  it("B3: a lost pay call → lookups by reference, one re-send, then backoff (no pay call every tick)", async () => {
    const s = setup();
    s.ln.plan = ["lost", "lost"];
    s.ln.lookupWorks = false;
    await s.service.start(START);
    for (let i = 0; i < 40; i++) {
      await s.service.poll();
      later(s.clock, 15_000); // the 15 s polling timer, for 10 minutes
    }
    expect(s.ln.calls).toHaveLength(2); // the send and ONE re-send of the same reference
    expect(new Set(s.ln.calls.map((c) => `${c.reference}|${c.request}`)).size).toBe(1);
    expect(s.ln.lookups.length).toBeGreaterThan(1);
    expect(s.ln.lookups.length).toBeLessThan(15); // backed off, not every tick
    expect(s.ln.lookups[0]).toEqual({ reference: "pay-b1-1", paymentHash: "1".padStart(64, "0") });
  });

  it("B3: a payment found by reference is followed by reads only, until paid", async () => {
    const s = setup();
    await s.service.start(START);
    for (let i = 0; i < 5; i++) {
      await s.service.poll();
      later(s.clock, 3_600_000);
    }
    expect(s.ln.calls).toHaveLength(1);
    expect(s.ln.gets.length).toBeGreaterThan(0); // tried by id first
    s.ln.settle("pay-b1-1");
    await s.service.poll();
    expect((await s.store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(s.ln.calls).toHaveLength(1);
  });
});

describe("B4: payout cap and plausible rate", () => {
  it("B4: above MAX_PAYOUT_SATS → failed, not retried, nothing resolved or paid, public reason setup", async () => {
    const s = setup({ maxPayoutSats: 10_000 });
    const row = await s.service.start(START); // 16 666 sats
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row.lastError).toContain(`${SATS} sats is above MAX_PAYOUT_SATS=10000`);
    expect(publicPayoutReason(row.lastError!)).toBe("setup");
    expect(s.resolver.calls).toBe(0);
    expect(s.ln.calls).toHaveLength(0);
    expect(s.timers).toHaveLength(0);
  });

  it("B4: an implausible FCFA/BTC rate is refused the same way", async () => {
    const s = setup({ rates: { xofPerUsdt: async () => 600, usdtPerBtc: async () => 1 } }); // 600 FCFA/BTC
    const row = await s.service.start(START);
    expect(row).toMatchObject({ status: "failed" });
    expect(row.lastError).toContain("implausible rate");
    expect(publicPayoutReason(row.lastError!)).toBe("setup");
    expect(s.ln.calls).toHaveLength(0);
  });

  it("B4: MAX_PAYOUT_SATS defaults to 100 000 and refuses junk", () => {
    expect(readMaxPayoutSats({})).toBe(100_000);
    expect(readMaxPayoutSats({ MAX_PAYOUT_SATS: "2500" })).toBe(2500);
    expect(() => readMaxPayoutSats({ MAX_PAYOUT_SATS: "1e9" })).toThrow();
    expect(() => readMaxPayoutSats({ MAX_PAYOUT_SATS: "0" })).toThrow();
  });
});

describe("M1: resume only what settlement already started", () => {
  const row = (over: Partial<Payout>): Payout => ({ id: "p1", bountyId: "b1", userId: "github:awa", amountXof: 10_000, quoteId: null, bitnobPayoutId: null, reference: "pay-b1", status: "pending", attempts: 0, lastError: "not started, the bounty wasn't moved to paying: on hold", paidAt: null, rail: "lightning", ...over });

  it("M1: a pending row whose bounty is still verified (objection window) is not paid at boot", async () => {
    const store = new InMemoryPayoutStore();
    await store.create(row({}));
    const isPayable = vi.fn(async () => "bounty is verified, waiting for settlement" as const);
    const s = setup({ store, isPayable });
    await s.service.resume();
    expect(isPayable).toHaveBeenCalled();
    expect(s.events).toEqual([]);
    expect(s.ln.calls).toHaveLength(0);
    expect((await store.get("p1"))!.status).toBe("pending");
  });

  it("M1: an unsent processing row found at boot is re-checked: not payable → back to pending, no gate, no pay", async () => {
    const store = new InMemoryPayoutStore();
    await store.create(row({ status: "processing", attempts: 1, lastError: null }));
    const s = setup({ store, isPayable: async () => "the payout's developer is no longer the bounty's claimant" });
    await s.service.resume();
    expect(s.events).toEqual([]);
    expect(s.ln.calls).toHaveLength(0);
    expect((await store.get("p1"))!).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("M1: a payable pending row is resumed and paid once", async () => {
    const store = new InMemoryPayoutStore();
    await store.create(row({}));
    const s = setup({ store, isPayable: async () => true });
    await s.service.resume();
    expect(s.ln.calls).toHaveLength(1);
  });

  it("M1: a row the gate refused follows the bounty's new claimant and amount on the next start", async () => {
    const store = new InMemoryPayoutStore();
    await store.create(row({}));
    const s = setup({ store });
    const paid = await s.service.start({ bountyId: "b1", userId: "github:moussa", amountXof: 12_000 });
    expect(paid).toMatchObject({ userId: "github:moussa", amountXof: 12_000, status: "processing", attempts: 1 });
    // A row that was already sent never changes recipient.
    await expect(s.service.start({ bountyId: "b1", userId: "github:awa", amountXof: 10_000 })).rejects.toThrow("another user");
  });
});

describe("L1 / L3", () => {
  it("L1: the public payout view shows a short reason, never the raw error", () => {
    const view = payoutView(
      { id: "p1", bountyId: "b1", userId: "github:awa", amountXof: 1, quoteId: null, bitnobPayoutId: null, reference: "pay-b1", status: "failed", attempts: 3, lastError: "lnurl unreachable: aw***@blink.sv: LNURL server at 10.0.0.7 timed out (BITNOB_CLIENT_ID=abc)", paidAt: null, rail: "lightning" },
      NOW.toISOString(),
    );
    expect(view.lastError).toBe("the developer's Lightning wallet didn't answer");
  });

  it("L3: start() on a bounty with a legacy mobile money row logs why nothing is paid", async () => {
    const store = new InMemoryPayoutStore();
    await store.create({ id: "p1", bountyId: "b1", userId: "github:awa", amountXof: 10_000, quoteId: "q", bitnobPayoutId: null, reference: "pay-b1", status: "pending", attempts: 0, lastError: null, paidAt: null, rail: "mobile_money" });
    const s = setup({ store });
    await s.service.start(START);
    expect(s.ln.calls).toHaveLength(0);
    expect(s.log.warn).toHaveBeenCalledWith(expect.stringContaining("mobile_money payout row exists"));
  });
});
