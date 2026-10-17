import { BitnobError, type Payout as BitnobPayout, type RequestOptions } from "@bitbounty/bitnob";
import type { InternalEvent } from "@bitbounty/core";
import { describe, expect, it, vi } from "vitest";
import { signBitnobPayload } from "../src/bitnob/signature.js";
import { bitnobWebhookRoutes } from "../src/bitnob/webhook.js";
import { GithubDispatcher } from "../src/github/dispatcher.js";
import { InMemoryEventStore } from "../src/github/event-store.js";
import {
  BankCodes,
  InMemoryPayoutStore,
  PayoutService,
  maskPhone,
  readBankCodeFallback,
  type Beneficiary,
  type PayoutRails,
} from "../src/payouts/index.js";

const NOW = new Date("2026-10-17T20:00:00Z");
const AWA: Beneficiary = { provider: "wave", phoneE164: "+221771234567", accountName: "Awa Diop", country: "SN" };

/**
 * What one finalize call does at the fake Bitnob:
 * - ok: commits (debit + release), answers `finalizeStatus`;
 * - commit-then-timeout / commit-then-502: commits, but the answer is lost;
 * - timeout: never reached Bitnob (nothing committed);
 * - reject: Bitnob refuses (422), nothing committed, payout stays INITIATED.
 */
type FinalizeMode = "ok" | "commit-then-timeout" | "commit-then-502" | "timeout" | "reject";

/** A fake Bitnob: one payout per reference, statuses we control, finalize only once per payout. */
class FakeRails implements PayoutRails {
  payouts = new Map<string, BitnobPayout>();
  calls: string[] = [];
  /** Payout ids whose finalize actually went through (money moved). */
  committed: string[] = [];
  finalizeOpts: (RequestOptions | undefined)[] = [];
  banks: { bank_name: string; bank_code: string }[] | null = [
    { bank_name: "Orange Money", bank_code: "OM_SN" },
    { bank_name: "Wave Mobile Money", bank_code: "WAVE_SN" },
    { bank_name: "Free Money", bank_code: "FREE_SN" },
  ];
  quoteError: (() => Error) | null = null;
  initializeError: (() => Error) | null = null;
  initializeFailures = 0;
  /** Consumed one per finalize call; "ok" when empty. */
  finalizePlan: FinalizeMode[] = [];
  /** Status returned by a successful finalize. */
  finalizeStatus = "processing";
  /** What the quote settles, if not what was asked. */
  settleOverride: string | null = null;
  private n = 0;

  async getBanks() {
    this.calls.push("banks");
    return this.banks as unknown as { bank_name: string; bank_code: string }[];
  }

  async createPayoutQuote(input: Parameters<PayoutRails["createPayoutQuote"]>[0]) {
    this.calls.push(`quote:${input.reference}`);
    if (this.quoteError) throw this.quoteError();
    // Bitnob is idempotent on reference: same reference → same quote.
    for (const p of this.payouts.values()) if (p.reference === input.reference) return p;
    const n = ++this.n;
    const p = {
      id: `bp-${n}`,
      quote_id: `QT-${n}`,
      status: "QUOTE",
      reference: input.reference,
      settlement_amount: this.settleOverride ?? input.settlement_amount,
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

  /** Behaves like Bitnob behind the real client: with retries left, a lost answer is replayed. */
  async finalizePayout(quoteId: string, opts?: RequestOptions) {
    this.calls.push(`finalize:${quoteId}`);
    this.finalizeOpts.push(opts);
    const retries = opts?.retries ?? 2;
    const mode = this.finalizePlan.shift() ?? "ok";
    const p = this.byQuote(quoteId);
    const once = (): BitnobPayout => {
      if (p.status !== "INITIATED") {
        throw new BitnobError(`payout already ${p.status}`, 409, "PAYOUT_ALREADY_FINALIZED");
      }
      if (mode === "reject") throw new BitnobError("insufficient balance", 422, "INSUFFICIENT_FUNDS");
      if (mode === "timeout") throw new BitnobError("timed out", 0, "TIMEOUT");
      p.status = mode === "ok" ? this.finalizeStatus : "processing";
      this.committed.push(p.id);
      if (mode === "commit-then-timeout") throw new BitnobError("timed out", 0, "TIMEOUT");
      if (mode === "commit-then-502") throw new BitnobError("bad gateway", 502, "HTTP_502");
      return p;
    };
    let last: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        return once();
      } catch (err) {
        last = err;
        const status = err instanceof BitnobError ? err.status : 0;
        if (!(status === 0 || status >= 500)) throw err;
      }
    }
    throw last;
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

  /** Bitnob expiring a payout that was never finalized. */
  expire(id: string) {
    const p = this.payouts.get(id)!;
    if (p.status === "QUOTE" || p.status === "INITIATED") p.status = "expired";
  }

  count(prefix: string) {
    return this.calls.filter((c) => c.startsWith(prefix)).length;
  }

  /** Payouts that are or were on their way to the developer. */
  live() {
    return [...this.payouts.values()].filter((p) => p.status === "processing" || p.status === "success");
  }
}

function setup(opts: { rails?: FakeRails; store?: InMemoryPayoutStore; beneficiary?: Beneficiary; bankCodes?: Record<string, Record<string, string>> } = {}) {
  const rails = opts.rails ?? new FakeRails();
  const store = opts.store ?? new InMemoryPayoutStore();
  const events: InternalEvent[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let id = 0;
  const service = new PayoutService({
    rails,
    store,
    emit: (e) => {
      events.push(e);
    },
    getBeneficiary: async () => opts.beneficiary ?? AWA,
    callbackUrl: "https://bitbounty.test/webhooks/bitnob",
    bankCodes: opts.bankCodes ?? {},
    schedule: (fn, ms) => timers.push({ fn, ms }),
    now: () => NOW,
    newId: () => `payout-${++id}`,
    log,
  });
  /** Runs the scheduled retries, one by one, until none are left. */
  const flushRetries = async () => {
    while (timers.length) {
      timers.shift()!.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const types = () => events.map((e) => (e.type === "payout.started" || e.type === "payout.failed" ? `${e.type}#${e.attempt}` : e.type));
  return { rails, store, service, events, timers, flushRetries, types, log };
}

const success = (p: BitnobPayout) => ({
  bitnobPayoutId: p.id,
  quoteId: p.quote_id,
  reference: p.reference,
  outcome: "success" as const,
  rawStatus: "success",
});

const quoteOf = (rails: FakeRails, reference: string) =>
  rails.createPayoutQuote({ from_asset: "USDT", to_currency: "XOF", country: "SN", source: "offchain", settlement_amount: "10000", payment_reason: "bounty", reference });

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

  it("finalize is sent with retries: 0 (no client-level replay)", async () => {
    const { service, rails } = setup();
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(rails.finalizeOpts).toEqual([{ retries: 0 }]);
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

  it("refuses a quote that doesn't settle the bounty amount, without initializing", async () => {
    const rails = new FakeRails();
    rails.settleOverride = "9950";
    const { service, store, timers } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(await store.getByBounty("b1")).toMatchObject({ status: "failed", lastError: expect.stringContaining("settles 9950 XOF, expected 10000") });
    expect(rails.count("initialize")).toBe(0);
    expect(timers).toHaveLength(0);
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

  it.each([
    ["quote", 401],
    ["quote", 422],
    ["initialize", 401],
    ["initialize", 422],
  ] as const)("%s %i is not retried: failed after one attempt", async (stage, status) => {
    const rails = new FakeRails();
    const err = () => new BitnobError(`rejected ${status}`, status, "X");
    if (stage === "quote") rails.quoteError = err;
    else {
      rails.initializeError = err;
      rails.initializeFailures = 99;
    }
    const { service, store, timers, types } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(await store.getByBounty("b1")).toMatchObject({ status: "failed", attempts: 1 });
    expect(timers).toHaveLength(0);
    expect(types()).toEqual(["payout.started#1", "payout.failed#1"]);
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

  it("an invalid phone number fails the attempt cleanly, without leaking the number", async () => {
    const { service, store } = setup({ beneficiary: { ...AWA, provider: "free" as const, phoneE164: "+22" } });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    const row = (await store.getByBounty("b1"))!;
    expect(row.lastError).toContain("invalid phone number");
    expect(row.lastError).not.toContain("+22 ");
  });
});

describe("phone numbers stay out of errors and events", () => {
  it("masks the number Bitnob echoes in an error", async () => {
    const rails = new FakeRails();
    rails.initializeError = () => new BitnobError("account 221771234567 is not registered on Wave", 400, "VALIDATION");
    rails.initializeFailures = 1;
    const { service, store, events, log } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    const row = (await store.getByBounty("b1"))!;
    const failed = events.find((e) => e.type === "payout.failed")!;
    for (const text of [row.lastError!, JSON.stringify(failed), JSON.stringify(log.warn.mock.calls)]) {
      expect(text).not.toContain("221771234567");
      expect(text).not.toContain("771234567");
    }
    expect(row.lastError).toContain("2217******67");
  });

  it("maskPhone keeps the prefix and the last two digits", () => {
    expect(maskPhone("+221771234567")).toBe("+2217******67");
    expect(maskPhone("221771234567")).toBe("2217******67");
    expect(maskPhone("+22")).toBe("+**");
  });
});

describe("finalize errors: ask Bitnob, never assume (blocking #1)", () => {
  it("finalize times out after Bitnob committed: one finalize, no retry, poll finds it paid", async () => {
    const rails = new FakeRails();
    rails.finalizePlan = ["commit-then-timeout"];
    const { service, store, timers, types } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect((await store.getByBounty("b1"))!.status).toBe("processing");
    expect(timers).toHaveLength(0);
    // The real client would have replayed it; we sent it once.
    expect(rails.count("finalize")).toBe(1);

    rails.payouts.get("bp-1")!.status = "success";
    await service.poll();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(rails.count("finalize")).toBe(1);
    expect(rails.count("quote")).toBe(1);
    expect(types()).toEqual(["payout.started#1", "payout.succeeded"]);
  });

  it("reviewer repro: finalize commits then times out; the replay would get 409; pay-b1-2 must never start", async () => {
    // The fake replays like the real client when retries aren't 0: commit, timeout, replay → 409.
    const unsafe = new FakeRails();
    await quoteOf(unsafe, "x");
    unsafe.byQuote("QT-1").status = "INITIATED";
    unsafe.finalizePlan = ["commit-then-timeout"];
    await expect(unsafe.finalizePayout("QT-1")).rejects.toMatchObject({ status: 409 });

    const rails = new FakeRails();
    rails.finalizePlan = ["commit-then-timeout"];
    const { service, store, timers, flushRetries } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await flushRetries();
    await service.poll();
    expect(timers).toHaveLength(0);
    expect(rails.count("quote:pay-b1-2")).toBe(0);
    expect(rails.committed).toEqual(["bp-1"]);
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 1 });
  });

  it("a finalize that answers 409 while Bitnob is processing stays processing (no 2nd attempt)", async () => {
    const rails = new FakeRails();
    const { service, store, timers } = setup({ rails });
    // Make the first finalize hit a payout someone already finalized.
    const orig = rails.initializePayout.bind(rails);
    rails.initializePayout = async (q, input) => {
      const p = await orig(q, input);
      p.status = "processing";
      rails.committed.push(p.id);
      return p;
    };
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 1, lastError: expect.stringContaining("already processing (Bitnob: processing, polling)") });
    expect(timers).toHaveLength(0);
    expect(rails.count("get:bp-1")).toBe(1);
  });

  it("finalize 5xx after commit, then Bitnob says success: paid once", async () => {
    const rails = new FakeRails();
    rails.finalizePlan = ["commit-then-502"];
    const { service, store } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    await service.poll();
    expect((await store.getByBounty("b1"))!.attempts).toBe(1);
    rails.payouts.get("bp-1")!.status = "success";
    await service.poll();
    expect((await store.getByBounty("b1"))!.status).toBe("succeeded");
    expect(rails.committed).toEqual(["bp-1"]);
  });

  it("finalize 422 (replaces the old 'finalize 4xx is a definite failure'): stays processing until Bitnob says expired", async () => {
    const rails = new FakeRails();
    rails.finalizePlan = ["reject"];
    const { service, store, timers, flushRetries } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    // Bitnob still shows INITIATED: we don't know enough to start attempt 2.
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 1 });
    expect(timers).toHaveLength(0);
    await service.poll();
    await service.poll();
    expect(rails.count("finalize")).toBe(1);

    rails.expire("bp-1");
    await service.poll();
    await flushRetries();
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 2, quoteId: "QT-2" });
    expect(rails.committed).toEqual(["bp-2"]);
  });

  it("finalize error and Bitnob doesn't know the payout: the attempt fails", async () => {
    const rails = new FakeRails();
    rails.finalizePlan = ["timeout"];
    const orig = rails.getPayout.bind(rails);
    rails.getPayout = async () => {
      throw new BitnobError("not found", 404, "NOT_FOUND");
    };
    const { service, store, timers } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(await store.getByBounty("b1")).toMatchObject({ status: "pending", attempts: 1, lastError: expect.stringContaining("no payout bp-1") });
    expect(timers).toHaveLength(1);
    rails.getPayout = orig;
  });

  it("finalize error and the status check fails too: stays processing, no retry", async () => {
    const rails = new FakeRails();
    rails.finalizePlan = ["commit-then-timeout"];
    rails.getPayout = async () => {
      throw new BitnobError("bad gateway", 502, "HTTP_502");
    };
    const { service, store, timers } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 1 });
    expect(timers).toHaveLength(0);
  });
});

describe("poll never re-finalizes an initialized payout (blocking #1)", () => {
  it("poll with INITIATED waits, even across many polls and a restart", async () => {
    const rails = new FakeRails();
    rails.finalizePlan = ["timeout"]; // finalize never reached Bitnob, but we can't know that
    const { service, store } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(rails.payouts.get("bp-1")!.status).toBe("INITIATED");
    for (let i = 0; i < 3; i++) await service.poll();
    await setup({ rails, store }).service.resume();
    expect(rails.count("finalize")).toBe(1);
    expect(rails.count("initialize")).toBe(1);
    expect((await store.getByBounty("b1"))!.status).toBe("processing");
  });

  it("server killed after initialize: restart doesn't finalize; once Bitnob expires it, attempt 2 pays once", async () => {
    const rails = new FakeRails();
    const store = new InMemoryPayoutStore();
    // What the first process left behind: attempt 1 initialized; finalize maybe sent.
    await store.create({
      id: "payout-1", bountyId: "b1", userId: "u", amountXof: 10_000, quoteId: null, bitnobPayoutId: null,
      reference: "pay-b1", status: "processing", attempts: 1, lastError: null, paidAt: null,
    });
    const q = await quoteOf(rails, "pay-b1-1");
    await store.update("payout-1", { status: "processing" }, { quoteId: q.quote_id, bitnobPayoutId: q.id });
    q.status = "INITIATED";

    const { service, flushRetries } = setup({ rails, store });
    await service.resume();
    await service.resume();
    expect(rails.count("finalize")).toBe(0);

    rails.expire("bp-1");
    await service.poll();
    await flushRetries();
    expect(rails.count("finalize:QT-2")).toBe(1);
    expect(rails.committed).toEqual(["bp-2"]);
  });

  it("server killed between claiming and saving the quote: restart finds the same quote and pays once", async () => {
    const rails = new FakeRails();
    const store = new InMemoryPayoutStore();
    await store.create({
      id: "payout-1", bountyId: "b1", userId: "u", amountXof: 10_000, quoteId: null, bitnobPayoutId: null,
      reference: "pay-b1", status: "processing", attempts: 1, lastError: null, paidAt: null,
    });
    // The quote was created at Bitnob, but the process died before saving its id.
    await quoteOf(rails, "pay-b1-1");

    const { service } = setup({ rails, store });
    await service.resume();
    expect(rails.payouts.size).toBe(1);
    expect(rails.count("finalize")).toBe(1);
    expect((await store.getByBounty("b1"))!.quoteId).toBe("QT-1");
  });

  it("server killed after finalize while Bitnob already paid: restart marks it paid, pays nothing more", async () => {
    const rails = new FakeRails();
    rails.finalizePlan = ["commit-then-timeout"];
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
    const q = await quoteOf(rails, "pay-b1-1");
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

  it("a crash between create and the first claim: resume runs attempt 1", async () => {
    const rails = new FakeRails();
    const store = new InMemoryPayoutStore();
    await store.create({
      id: "payout-1", bountyId: "b1", userId: "u", amountXof: 10_000, quoteId: null, bitnobPayoutId: null,
      reference: "pay-b1", status: "pending", attempts: 0, lastError: null, paidAt: null,
    });
    const { service } = setup({ rails, store });
    await service.resume();
    expect(await store.getByBounty("b1")).toMatchObject({ status: "processing", attempts: 1, quoteId: "QT-1" });
    expect(rails.count("finalize")).toBe(1);
  });

  it("an update for a payout that isn't ours returns null", async () => {
    const { service } = setup();
    expect(await service.handleUpdate({ bitnobPayoutId: "x", quoteId: "y", reference: "z", outcome: "success", rawStatus: "success" })).toBeNull();
  });
});

describe("invariant: at most one attempt ever reaches processing/success at Bitnob", () => {
  /** Small deterministic PRNG so failures are reproducible by seed. */
  const rng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const MODES: FinalizeMode[] = ["ok", "commit-then-timeout", "commit-then-502", "timeout", "reject"];

  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i", async (seed) => {
    const rand = rng(seed);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const rails = new FakeRails();
    rails.finalizePlan = Array.from({ length: 10 }, () => pick(MODES));
    if (rand() < 0.3) {
      rails.initializeError = () => new BitnobError("provider down", 400, "X");
      rails.initializeFailures = Math.floor(rand() * 3);
    }
    const store = new InMemoryPayoutStore();
    let s = setup({ rails, store });
    await s.service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });

    for (let step = 0; step < 25; step++) {
      const action = pick(["poll", "restart", "retry", "expire", "settle", "webhook"] as const);
      const current = (await store.getByBounty("b1"))!;
      const remote = current.bitnobPayoutId ? rails.payouts.get(current.bitnobPayoutId) : undefined;
      if (action === "poll") await s.service.poll();
      else if (action === "restart") {
        s = setup({ rails, store });
        await s.service.resume();
      } else if (action === "retry") await s.flushRetries();
      else if (action === "expire" && remote) rails.expire(remote.id);
      else if (action === "settle" && remote?.status === "processing") remote.status = "success";
      else if (action === "webhook" && remote && (remote.status === "success" || remote.status === "expired")) {
        await s.service.handleUpdate({ ...success(remote), outcome: remote.status === "success" ? "success" : "failed", rawStatus: remote.status });
      }

      expect(rails.live().length, `seed ${seed} step ${step} ${action}: ${JSON.stringify([...rails.payouts.values()].map((p) => p.status))}`).toBeLessThanOrEqual(1);
      expect(rails.committed.length).toBeLessThanOrEqual(1);
      const row = (await store.getByBounty("b1"))!;
      if (row.status === "succeeded") expect(rails.payouts.get(row.bitnobPayoutId!)!.status).toBe("success");
    }
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

describe("BankCodes (blocking #2)", () => {
  it("caches a non-empty directory per country and errors on an unknown provider", async () => {
    const getBanks = vi.fn(async () => [{ bank_name: "Wave", bank_code: "W" }]);
    const banks = new BankCodes({ getBanks });
    expect(await banks.resolve("sn", "wave")).toBe("W");
    expect(await banks.resolve("SN", "wave")).toBe("W");
    expect(getBanks).toHaveBeenCalledTimes(1);
    await expect(banks.resolve("SN", "orange")).rejects.toThrow('no Bitnob bank_code for orange in SN');
  });

  it("{banks: null} (sandbox SN) doesn't crash, isn't cached, and uses the configured fallback", async () => {
    let answer: { bank_name: string; bank_code: string }[] | null = null;
    const getBanks = vi.fn(async () => answer as unknown as { bank_name: string; bank_code: string }[]);
    const banks = new BankCodes({ getBanks }, { SN: { wave: "WAVE_CFG" } });
    expect(await banks.resolve("SN", "wave")).toBe("WAVE_CFG");
    await expect(banks.resolve("SN", "orange")).rejects.toThrow(/list is empty and BITNOB_SN_BANK_CODES has no "orange" entry/);
    answer = [{ bank_name: "Orange Money", bank_code: "OM" }];
    expect(await banks.resolve("SN", "orange")).toBe("OM");
    expect(getBanks).toHaveBeenCalledTimes(3);
  });

  it("a payout with no bank code anywhere fails once with a clear error, no retries", async () => {
    const rails = new FakeRails();
    rails.banks = null;
    const { service, store, timers } = setup({ rails });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(await store.getByBounty("b1")).toMatchObject({ status: "failed", lastError: expect.stringContaining("BITNOB_SN_BANK_CODES") });
    expect(timers).toHaveLength(0);
    expect(rails.count("finalize")).toBe(0);
  });

  it("a payout uses the fallback code when Bitnob lists no banks", async () => {
    const rails = new FakeRails();
    rails.banks = null;
    const { service } = setup({ rails, bankCodes: { SN: { wave: "WAVE_CFG" } } });
    await service.start({ bountyId: "b1", userId: "u", amountXof: 10_000 });
    expect(rails.payouts.get("bp-1")!.beneficiary?.bank_code).toBe("WAVE_CFG");
  });

  it("readBankCodeFallback parses BITNOB_<CC>_BANK_CODES and rejects bad config", () => {
    expect(readBankCodeFallback({ BITNOB_SN_BANK_CODES: '{"wave":"W1","orange":""}', OTHER: "x" })).toEqual({ SN: { wave: "W1" } });
    expect(readBankCodeFallback({ BITNOB_SN_BANK_CODES: "" })).toEqual({});
    expect(() => readBankCodeFallback({ BITNOB_SN_BANK_CODES: "nope" })).toThrow("not valid JSON");
    expect(() => readBankCodeFallback({ BITNOB_SN_BANK_CODES: '{"mtn":"x"}' })).toThrow('unknown provider "mtn"');
  });
});
