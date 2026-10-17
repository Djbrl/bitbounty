import { BitnobError, type Payout as BitnobPayout } from "@bitbounty/bitnob";
import type { InternalEvent } from "@bitbounty/core";
import { describe, expect, it, vi } from "vitest";
import { signBitnobPayload } from "../src/bitnob/signature.js";
import { bitnobWebhookRoutes } from "../src/bitnob/webhook.js";
import { GithubDispatcher } from "../src/github/dispatcher.js";
import { InMemoryEventStore } from "../src/github/event-store.js";
import { BankCodes, InMemoryPayoutStore, PayoutService, type Beneficiary, type PayoutRails } from "../src/payouts/index.js";

const NOW = new Date("2026-10-17T20:00:00Z");
const AWA: Beneficiary = { provider: "wave", phoneE164: "+221771234567", accountName: "Awa Diop", country: "SN" };

/** A fake Bitnob: one payout per reference, statuses we control. */
class FakeRails implements PayoutRails {
  payouts = new Map<string, BitnobPayout>();
  calls: string[] = [];
  initializeError: (() => Error) | null = null;
  initializeFailures = 0;
  finalizeError: (() => Error) | null = null;
  /** Status returned by finalize. */
  finalizeStatus = "processing";
  private n = 0;

  async getBanks() {
    this.calls.push("banks");
    return [
      { bank_name: "Orange Money", bank_code: "OM_SN" },
      { bank_name: "Wave Mobile Money", bank_code: "WAVE_SN" },
      { bank_name: "Free Money", bank_code: "FREE_SN" },
    ];
  }

  async createPayoutQuote(input: Parameters<PayoutRails["createPayoutQuote"]>[0]) {
    this.calls.push(`quote:${input.reference}`);
    // Bitnob is idempotent on reference: same reference → same quote.
    for (const p of this.payouts.values()) if (p.reference === input.reference) return p;
    const n = ++this.n;
    const p = {
      id: `bp-${n}`,
      quote_id: `QT-${n}`,
      status: "QUOTE",
      reference: input.reference,
      settlement_amount: input.settlement_amount,
      expires_at: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    } as unknown as BitnobPayout;
    this.payouts.set(p.id, p);
    return p;
  }

  async initializePayout(quoteId: string, input: Parameters<PayoutRails["initializePayout"]>[1]) {
    this.calls.push(`initialize:${quoteId}`);
    if (this.initializeFailures > 0 && this.initializeError) {
      this.initializeFailures--;
      throw this.initializeError();
    }
    const p = this.byQuote(quoteId);
    p.status = "INITIATED";
    p.beneficiary = input.beneficiary;
    return p;
  }

  async finalizePayout(quoteId: string) {
    this.calls.push(`finalize:${quoteId}`);
    const p = this.byQuote(quoteId);
    if (this.finalizeError) {
      p.status = "processing"; // Bitnob did get it, we just never heard back.
      throw this.finalizeError();
    }
    p.status = this.finalizeStatus;
    return p;
  }

  async getPayout(id: string) {
    this.calls.push(`get:${id}`);
    const p = this.payouts.get(id);
    if (!p) throw new BitnobError("not found", 404, "NOT_FOUND");
    return p;
  }

  byQuote(quoteId: string) {
    for (const p of this.payouts.values()) if (p.quote_id === quoteId) return p;
    throw new BitnobError("quote not found", 404, "NOT_FOUND");
  }

  count(prefix: string) {
    return this.calls.filter((c) => c.startsWith(prefix)).length;
  }
}

function setup(opts: { rails?: FakeRails; store?: InMemoryPayoutStore; beneficiary?: Beneficiary } = {}) {
  const rails = opts.rails ?? new FakeRails();
  const store = opts.store ?? new InMemoryPayoutStore();
  const events: InternalEvent[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let id = 0;
  const service = new PayoutService({
    rails,
    store,
    emit: (e) => {
      events.push(e);
    },
    getBeneficiary: async () => opts.beneficiary ?? AWA,
    callbackUrl: "https://bitbounty.test/webhooks/bitnob",
    schedule: (fn, ms) => timers.push({ fn, ms }),
    now: () => NOW,
    newId: () => `payout-${++id}`,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  /** Runs the scheduled retries, one by one, until none are left. */
  const flushRetries = async () => {
    while (timers.length) {
      timers.shift()!.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const types = () => events.map((e) => (e.type === "payout.started" || e.type === "payout.failed" ? `${e.type}#${e.attempt}` : e.type));
  return { rails, store, service, events, timers, flushRetries, types };
}

const success = (p: BitnobPayout) => ({
  bitnobPayoutId: p.id,
  quoteId: p.quote_id,
  reference: p.reference,
  outcome: "success" as const,
  rawStatus: "success",
});

describe("happy path", () => {
  it("quote → initialize → finalize, then the success webhook pays it", async () => {
    const { service, rails, types } = setup();
    const row = await service.start({ bountyId: "b1", userId: "u-awa", amountXof: 10_000 });
    expect(row).toMatchObject({ status: "processing", attempts: 1, reference: "pay-b1", quoteId: "QT-1", bitnobPayoutId: "bp-1" });
    expect(rails.calls).toEqual(["quote:pay-b1-1", "banks", "initialize:QT-1", "finalize:QT-1"]);
    const sent = rails.payouts.get("bp-1")!;
    expect(sent.settlement_amount).toBe("10000");
    expect(sent.beneficiary).toEqual({
      destination_type: "mobile_money",
      country: "SN",
      account_name: "Awa Diop",
      account_number: "221771234567",
      bank_code: "WAVE_SN",
    });

    const paid = await service.handleUpdate(success(sent));
    expect(paid).toMatchObject({ status: "succeeded", paidAt: NOW.toISOString() });
    expect(types()).toEqual(["payout.started#1", "payout.succeeded"]);
  });

  it("a finalize that answers success right away is paid without waiting", async () => {
    const rails = new FakeRails();
    rails.finalizeStatus = "success";
    const { service, events } = setup({ rails });
    expect((await service.start({ bountyId: "b1", userId: "u", amountXof: 5_000 })).status).toBe("succeeded");
    expect(events.at(-1)).toMatchObject({ type: "payout.succeeded", payoutId: "payout-1", bitnobPayoutId: "bp-1" });
  });

  it("pays an Orange Money account with Orange's bank code", async () => {
    const { service, rails } = setup({ beneficiary: { ...AWA, provider: "orange" } });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 5_000 });
    expect(rails.payouts.get("bp-1")!.beneficiary?.bank_code).toBe("OM_SN");
  });
});

describe("never pays twice (reviewer checklist)", () => {
  it("a duplicate trigger does nothing", async () => {
    const { service, rails } = setup();
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(rails.count("finalize")).toBe(1);
  });

  it("two triggers at the same time: only one runs", async () => {
    const { service, rails } = setup();
    await Promise.all([
      service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 }),
      service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 }),
      service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 }),
    ]);
    expect(rails.count("quote")).toBe(1);
    expect(rails.count("finalize")).toBe(1);
  });

  it("the success webhook sent twice pays and emits once", async () => {
    const { service, rails, types } = setup();
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await service.handleUpdate(success(rails.payouts.get("bp-1")!));
    await service.handleUpdate(success(rails.payouts.get("bp-1")!));
    expect(types()).toEqual(["payout.started#1", "payout.succeeded"]);
  });

  it("a late `processing` after `success` is ignored", async () => {
    const { service, rails } = setup();
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await service.handleUpdate(success(rails.payouts.get("bp-1")!));
    const late = await service.handleUpdate({ ...success(rails.payouts.get("bp-1")!), outcome: "processing", rawStatus: "processing" });
    expect(late?.status).toBe("succeeded");
  });

  it("a paid bounty can't be started again", async () => {
    const { service, rails } = setup();
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await service.handleUpdate(success(rails.payouts.get("bp-1")!));
    expect((await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 })).status).toBe("succeeded");
    expect(rails.count("quote")).toBe(1);
  });

  it("refuses a second trigger with another recipient or amount", async () => {
    const { service } = setup();
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await expect(service.start({ bountyId: "b1", userId: "someone-else", amountXof: 10_000 })).rejects.toThrow("already has a payout");
    await expect(service.start({ bountyId: "b1", userId: "u", amountXof: 20_000 })).rejects.toThrow("already has a payout");
  });

  it.each([0, -5, 99.5, Number.NaN])("refuses amount %s", async (amountXof) => {
    const { service, rails } = setup();
    await expect(service.start({ bountyId: "b1", userId: "u", amountXof })).rejects.toThrow("positive integer");
    expect(rails.calls).toEqual([]);
  });
});

describe("retries", () => {
  it("a forced failure is retried 3 times, then the payout is failed (money stays reserved)", async () => {
    const rails = new FakeRails();
    rails.initializeError = () => new BitnobError("invalid account", 400, "VALIDATION");
    rails.initializeFailures = 99;
    const { service, store, timers, flushRetries, types } = setup({ rails });

    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(timers.map((t) => t.ms)).toEqual([5_000]);
    await flushRetries();

    expect(rails.calls.filter((c) => c.startsWith("quote"))).toEqual(["quote:pay-b1-1", "quote:pay-b1-2", "quote:pay-b1-3"]);
    expect(rails.count("finalize")).toBe(0);
    expect(types()).toEqual([
      "payout.started#1",
      "payout.failed#1",
      "payout.started#2",
      "payout.failed#2",
      "payout.started#3",
      "payout.failed#3",
    ]);
    expect(await store.getByBounty("b1")).toMatchObject({ status: "failed", attempts: 3, lastError: expect.stringContaining("invalid account") });
    // No 4th attempt, even if triggered again.
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(rails.count("quote")).toBe(3);
  });

  it("uses the configured backoff between attempts", async () => {
    const rails = new FakeRails();
    rails.initializeError = () => new BitnobError("down", 400, "X");
    rails.initializeFailures = 99;
    const { service, timers } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    const delays = [timers[0]!.ms];
    timers.shift()!.fn();
    await new Promise((r) => setTimeout(r, 0));
    delays.push(timers[0]!.ms);
    expect(delays).toEqual([5_000, 30_000]);
  });

  it("fails once, succeeds on attempt 2", async () => {
    const rails = new FakeRails();
    rails.initializeError = () => new BitnobError("provider down", 400, "X");
    rails.initializeFailures = 1;
    const { service, store, flushRetries } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await flushRetries();
    const row = (await store.getByBounty("b1"))!;
    expect(row).toMatchObject({ status: "processing", attempts: 2, quoteId: "QT-2" });
    await service.handleUpdate(success(rails.payouts.get("bp-2")!));
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
  });

  it("an expired payout (webhook) is retried with a new quote", async () => {
    const { service, rails, store, flushRetries } = setup();
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await service.handleUpdate({ ...success(rails.payouts.get("bp-1")!), outcome: "failed", rawStatus: "expired" });
    await flushRetries();
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 2, quoteId: "QT-2" });
  });

  it("an unsupported provider fails the attempt cleanly", async () => {
    const { service, store } = setup({ beneficiary: { ...AWA, country: "SN", provider: "free" as const, phoneE164: "+22" } });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect((await store.getByBounty("b1"))!.lastError).toContain("invalid phone number");
  });
});

describe("unknown outcome and crashes (reviewer checklist)", () => {
  it("finalize times out: no retry, poll finds it paid", async () => {
    const rails = new FakeRails();
    rails.finalizeError = () => new BitnobError("timed out", 0, "TIMEOUT");
    const { service, store, timers, types } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect((await store.getByBounty("b1"))!.status).toBe("processing");
    expect(timers).toHaveLength(0);

    rails.payouts.get("bp-1")!.status = "success";
    await service.poll();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(rails.count("finalize")).toBe(1);
    expect(rails.count("quote")).toBe(1);
    expect(types()).toEqual(["payout.started#1", "payout.succeeded"]);
  });

  it("finalize 5xx then Bitnob says expired: only then a new attempt", async () => {
    const rails = new FakeRails();
    rails.finalizeError = () => new BitnobError("bad gateway", 502, "HTTP_502");
    const { service, store, flushRetries } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await service.poll(); // still processing at Bitnob
    expect((await store.getByBounty("b1"))!.attempts).toBe(1);
    rails.payouts.get("bp-1")!.status = "expired";
    rails.finalizeError = null;
    await service.poll();
    await flushRetries();
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 2 });
    expect(rails.count("finalize")).toBe(2);
  });

  it("finalize 4xx is a definite failure", async () => {
    const rails = new FakeRails();
    rails.finalizeError = () => new BitnobError("insufficient balance", 422, "INSUFFICIENT_FUNDS");
    const { service, store } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(await store.getByBounty("b1")).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("server killed after initialize: restart finalizes once", async () => {
    const rails = new FakeRails();
    const store = new InMemoryPayoutStore();
    // What the first process left behind: attempt 1 initialized, never finalized.
    await store.create({
      id: "payout-1", bountyId: "b1", userId: "u", amountXof: 10_000, quoteId: null, bitnobPayoutId: null,
      reference: "pay-b1", status: "processing", attempts: 1, lastError: null, paidAt: null,
    });
    const q = await rails.createPayoutQuote({ from_asset: "USDT", to_currency: "XOF", country: "SN", source: "offchain", settlement_amount: "10000", payment_reason: "bounty", reference: "pay-b1-1" });
    await store.update("payout-1", { status: "processing" }, { quoteId: q.quote_id, bitnobPayoutId: q.id });
    q.status = "INITIATED";

    const { service } = setup({ rails, store });
    await service.resume();
    await service.resume();
    expect(rails.count("finalize")).toBe(1);
    expect(rails.count("initialize")).toBe(0);
  });

  it("server killed between claiming and saving the quote: restart finds the same quote", async () => {
    const rails = new FakeRails();
    const store = new InMemoryPayoutStore();
    await store.create({
      id: "payout-1", bountyId: "b1", userId: "u", amountXof: 10_000, quoteId: null, bitnobPayoutId: null,
      reference: "pay-b1", status: "processing", attempts: 1, lastError: null, paidAt: null,
    });
    // The quote was created at Bitnob, but the process died before saving its id.
    await rails.createPayoutQuote({ from_asset: "USDT", to_currency: "XOF", country: "SN", source: "offchain", settlement_amount: "10000", payment_reason: "bounty", reference: "pay-b1-1" });

    const { service } = setup({ rails, store });
    await service.resume();
    expect(rails.payouts.size).toBe(1);
    expect(rails.count("finalize")).toBe(1);
    expect((await store.getByBounty("b1"))!.quoteId).toBe("QT-1");
  });

  it("server killed after finalize while Bitnob already paid: restart marks it paid, pays nothing more", async () => {
    const rails = new FakeRails();
    rails.finalizeError = () => new Error("process killed");
    const { service, store } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    rails.payouts.get("bp-1")!.status = "success";

    const restarted = setup({ rails, store });
    await restarted.service.resume();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(rails.count("finalize")).toBe(1);
  });

  it("the quote expired before initialize: new attempt with a new quote", async () => {
    const rails = new FakeRails();
    const store = new InMemoryPayoutStore();
    await store.create({
      id: "payout-1", bountyId: "b1", userId: "u", amountXof: 10_000, quoteId: null, bitnobPayoutId: null,
      reference: "pay-b1", status: "processing", attempts: 1, lastError: null, paidAt: null,
    });
    const q = await rails.createPayoutQuote({ from_asset: "USDT", to_currency: "XOF", country: "SN", source: "offchain", settlement_amount: "10000", payment_reason: "bounty", reference: "pay-b1-1" });
    q.expires_at = new Date(NOW.getTime() - 1).toISOString();
    await store.update("payout-1", { status: "processing" }, { quoteId: q.quote_id, bitnobPayoutId: q.id });

    const { service, flushRetries } = setup({ rails, store });
    await service.resume();
    await flushRetries();
    expect(rails.count("initialize:QT-1")).toBe(0);
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 2, quoteId: "QT-2", lastError: null });
  });

  it("a lost retry timer is picked up on restart", async () => {
    const rails = new FakeRails();
    rails.initializeError = () => new BitnobError("x", 400, "X");
    rails.initializeFailures = 1;
    const { service, store } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 }); // timer never fires
    const restarted = setup({ rails, store });
    await restarted.service.resume();
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 2 });
  });

  it("an update for a payout that isn't ours returns null", async () => {
    const { service } = setup();
    expect(await service.handleUpdate({ bitnobPayoutId: "x", quoteId: "y", reference: "z", outcome: "success", rawStatus: "success" })).toBeNull();
  });
});

describe("wiring with the B5 receiver", () => {
  it("a signed success webhook pays the bounty", async () => {
    const { service, rails, store } = setup();
    const dispatcher = new GithubDispatcher();
    service.register(dispatcher);
    const app = bitnobWebhookRoutes({ secret: "s", store: new InMemoryEventStore(), dispatcher, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    const p = rails.payouts.get("bp-1")!;
    const body = JSON.stringify({
      event: "payouts.withdrawal.success",
      event_id: "evt-1",
      data: { id: p.id, quote_id: p.quote_id, reference: p.reference, status: "success" },
    });
    const res = await app.request("/webhooks/bitnob", { method: "POST", body, headers: { "x-bitnob-signature": signBitnobPayload("s", body) } });
    expect(res.status).toBe(200);
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
  });
});

describe("BankCodes", () => {
  it("caches the directory per country and errors on an unknown provider", async () => {
    const getBanks = vi.fn(async () => [{ bank_name: "Wave", bank_code: "W" }]);
    const banks = new BankCodes({ getBanks });
    expect(await banks.resolve("sn", "wave")).toBe("W");
    expect(await banks.resolve("SN", "wave")).toBe("W");
    expect(getBanks).toHaveBeenCalledTimes(1);
    await expect(banks.resolve("SN", "orange")).rejects.toThrow("no orange payout rail for SN");
  });
});
