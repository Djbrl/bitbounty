import { BitnobError, type TradingOrder, type TradingQuote, type VirtualAccount } from "@bitbounty/bitnob";
import type { InternalEvent } from "@bitbounty/core";
import { describe, expect, it, vi } from "vitest";
import { signBitnobPayload } from "../src/bitnob/signature.js";
import { bitnobWebhookRoutes } from "../src/bitnob/webhook.js";
import {
  BitnobFunderCustomers,
  InMemoryFundingStore,
  InMemoryNgnAccountStore,
  NgnFunding,
  type FundingRecord,
  type NgnFundingOptions,
  type Rates,
} from "../src/funding/index.js";
import { GithubDispatcher } from "../src/github/dispatcher.js";
import { InMemoryEventStore } from "../src/github/event-store.js";

const T0 = new Date("2026-10-17T22:00:00Z").getTime();
/** 600 FCFA and 1,500 naira per USDT → 1 FCFA = 2.5 naira. */
const RATES: Rates = { xofPerUsdt: async () => 600, usdtPerBtc: async () => 100_000, ngnPerUsdt: async () => 1_500 };
const IDENTITY = { first_name: "Ada", last_name: "Okafor", phone_number: "+2348012345678", date_of_birth: "1990-01-01" };

/** Mirrors what the sandbox did on 2026-10-17 (see docs/bitnob-api.md, B4). */
class FakeBitnob {
  now = T0;
  accounts = new Map<string, VirtualAccount>();
  quotes: { id: string; quantity: string; quote_currency: string }[] = [];
  private quoteExpiry = new Map<string, number>();
  /** Orders by the reference we sent. */
  orders = new Map<string, TradingOrder>();
  orderCalls = 0;
  /** Order calls that fail with "quote expired" before one goes through. */
  expiredOrders = 0;
  quoteTtlMs = 30_000;
  /** Status new orders come back with (the sandbox order was `filled`). */
  orderStatus = "filled";
  /** Thrown by createTradingQuote (e.g. the sandbox's balance cap). */
  quoteError: BitnobError | null = null;
  /** Thrown once by createTradingOrder: `before` = nothing placed, `after` = placed but the answer was lost. */
  orderNetworkError: "before" | "after" | null = null;
  depositKobo = "100000";
  simulateCalls = 0;
  private n = 0;
  createCustomer = vi.fn(async () => ({ id: "cust-lagos" }) as never);
  async createVirtualAccount(input: { reference: string; customer_id: string }) {
    const va = { id: `va-${++this.n}`, account_number: `90000${this.n}`, account_name: "Ada Okafor", bank_name: "Sandbox Bank", reference: input.reference, customer_id: input.customer_id, currency: "NGN", status: "active" };
    this.accounts.set(va.id, va);
    return va;
  }
  async simulateDeposit(id: string) {
    this.simulateCalls++;
    return {
      transaction: { id: `tx-${++this.n}`, virtual_account_id: id, amount: this.depositKobo, currency: "NGN", status: "completed", reference: `sbx-dep-${this.n}` },
      new_balance: "0",
    };
  }
  async createTradingQuote(input: { quantity: string; quote_currency: string }) {
    if (this.quoteError) throw this.quoteError;
    const q = { id: `q-${++this.n}`, quantity: input.quantity, quote_currency: input.quote_currency };
    this.quotes.push(q);
    this.quoteExpiry.set(q.id, this.now + this.quoteTtlMs);
    return {
      ...q,
      base_currency: "NGN",
      side: "SELL",
      price: "0.0000000067",
      expires_at: new Date(this.now + this.quoteTtlMs).toISOString(),
      exchange: { send_quantity: input.quantity, send_currency: "NGN", receive_quantity: "0.00018", receive_currency: "BTC" },
    } as TradingQuote;
  }
  async createTradingOrder(input: { quote_id: string; reference: string; quantity: string }) {
    this.orderCalls++;
    if (this.orderNetworkError === "before") {
      this.orderNetworkError = null;
      throw new BitnobError("fetch failed", 0, "NETWORK");
    }
    // Idempotent on reference: the same reference returns the existing order.
    const existing = this.orders.get(input.reference);
    if (existing) return existing;
    if (this.expiredOrders > 0) {
      this.expiredOrders--;
      throw new BitnobError("quote expired", 422, "QUOTE_EXPIRED");
    }
    if ((this.quoteExpiry.get(input.quote_id) ?? 0) <= this.now) throw new BitnobError("quote expired", 422, "QUOTE_EXPIRED");
    const o = { id: `order-${++this.n}`, status: this.orderStatus, quote_id: input.quote_id, reference: input.reference, quantity: input.quantity } as TradingOrder;
    this.orders.set(input.reference, o);
    if (this.orderNetworkError === "after") {
      this.orderNetworkError = null;
      throw new BitnobError("bad gateway", 502, "HTTP_502");
    }
    return o;
  }
  /** By id only: the real API answers 400 "invalid id" for a reference. */
  async getTradingOrder(id: string) {
    const o = [...this.orders.values()].find((x) => x.id === id);
    if (!o) throw new BitnobError("GET /api/trading/orders: 400 VALIDATION_ERROR: invalid id", 400, "VALIDATION_ERROR");
    return o;
  }
  /** Orders that sold something. */
  get sells() {
    return [...this.orders.values()].filter((o) => !["failed", "cancelled", "expired"].includes(o.status)).length;
  }
}

function setup(over: Partial<NgnFundingOptions> = {}) {
  const bitnob = new FakeBitnob();
  const fundings = new InMemoryFundingStore();
  const accounts = new InMemoryNgnAccountStore();
  const events: InternalEvent[] = [];
  const credited: { funding: FundingRecord; reason: string }[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let id = 0;
  const ngn = new NgnFunding({
    client: bitnob,
    fundings,
    accounts,
    rates: RATES,
    customers: new BitnobFunderCustomers(bitnob),
    emit: (e) => {
      events.push(e);
    },
    credit: (f, reason) => {
      credited.push({ funding: f, reason });
    },
    now: () => new Date(bitnob.now),
    newId: () => `f${++id}`,
    log,
    ...over,
  });
  return { bitnob, fundings, accounts, events, credited, log, ngn };
}

const TARGET = { bountyId: "b1", amountXof: 10_000, funderId: "lagos-co" };
const deposit = (va: string, ref: string, kobo: number) => ({ virtualAccountId: va, reference: ref, amountMinor: kobo, currency: "NGN" });

describe("naira account", () => {
  it("opens a naira account for bounty + fee + buffer, in whole naira", async () => {
    const { ngn, bitnob } = setup();
    const { funding, account } = await ngn.account(TARGET, IDENTITY);
    // 10,800 FCFA × 2.5 = 27,000 naira.
    expect(account).toMatchObject({ virtualAccountId: "va-1", accountNumber: "900001", bankName: "Sandbox Bank", requiredNaira: 27_000, receivedKobo: 0, state: "collecting" });
    expect(funding).toMatchObject({ rail: "ngn", sourceAmount: 2_700_000, sourceCurrency: "NGN", bitnobRef: "va-1", amountXof: 10_000 });
    expect(bitnob.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ country_code: "NGA", first_name: "Ada", date_of_birth: "1990-01-01" }));
  });

  it("asking again returns the same account", async () => {
    const { ngn, bitnob } = setup();
    await ngn.account(TARGET, IDENTITY);
    const again = await ngn.account(TARGET, IDENTITY);
    expect(again.account.virtualAccountId).toBe("va-1");
    expect(bitnob.accounts.size).toBe(1);
  });

  it("asks for at least ₦500 (Bitnob's trading minimum)", async () => {
    const { ngn } = setup();
    expect((await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY)).account.requiredNaira).toBe(500);
  });
});

describe("done when: simulated deposits → naira sold for bitcoin → funding.paid", () => {
  it("adds up ₦1,000 simulated deposits, converts once, emits funding.paid", async () => {
    const { ngn, bitnob, events } = setup();
    const { funding } = await ngn.account(TARGET, IDENTITY);
    const account = await ngn.simulateUntilFunded(funding.id);
    expect(account).toMatchObject({ state: "converted", receivedKobo: 2_700_000, btcReceived: "0.00018" });
    expect(account.depositRefs).toHaveLength(27);
    expect(bitnob.quotes).toEqual([{ id: expect.any(String), quantity: "27000", quote_currency: "BTC" }]);
    expect(events).toEqual([
      { type: "funding.paid", bountyId: "b1", occurredAt: new Date(T0).toISOString(), fundingId: funding.id, rail: "ngn", amountXof: 10_000 },
    ]);
  });

  it("a signed deposit webhook (B5) counts the same way", async () => {
    const { ngn, events } = setup();
    const { account } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY); // ₦500
    const dispatcher = new GithubDispatcher();
    ngn.register(dispatcher);
    const app = bitnobWebhookRoutes({ secret: "s", store: new InMemoryEventStore(), dispatcher, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    const body = JSON.stringify({ event: "virtual_account.deposit.success", eventId: "e1", data: { virtual_account_id: account.virtualAccountId, amount: "50000", currency: "NGN", reference: "bank-tx-1" } });
    const res = await app.request("/webhooks/bitnob", { method: "POST", body, headers: { "x-bitnob-signature": signBitnobPayload("s", body) } });
    expect(res.status).toBe(200);
    expect(events.map((e) => e.type)).toEqual(["funding.paid"]);
  });
});

describe("reviewer checklist", () => {
  it("a deposit into an account not linked to any bounty funds nothing and is logged", async () => {
    const { ngn, events, log } = setup();
    await ngn.account(TARGET, IDENTITY);
    expect(await ngn.handleDeposit(deposit("va-unknown", "tx-1", 5_000_000))).toBeNull();
    expect(events).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("not linked to a bounty"));
  });

  it("the naira quote expired before ordering: a fresh quote is taken", async () => {
    const { ngn, bitnob, events } = setup();
    bitnob.expiredOrders = 2;
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    const a = await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    expect(a?.state).toBe("converted");
    expect(bitnob.quotes).toHaveLength(3);
    expect([...bitnob.orders.keys()]).toEqual([`ngn-${funding.id}-3`]);
    expect(events).toHaveLength(1);
  });

  it("a quote that arrives already expired is not used", async () => {
    const { ngn, bitnob } = setup();
    bitnob.quoteTtlMs = 0;
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    const a = await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    expect(a).toMatchObject({ state: "collecting", lastError: "quote already expired" });
    expect(bitnob.orders.size).toBe(0);
  });

  it("every quote expired: back to collecting, retried on resume", async () => {
    const { ngn, bitnob, events } = setup();
    bitnob.expiredOrders = 3;
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    expect((await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000)))?.state).toBe("collecting");
    expect(events).toHaveLength(0);
    await ngn.resume();
    expect(events).toHaveLength(1);
  });

  it("the same deposit reported twice (webhook + simulate response) counts once", async () => {
    const { ngn, accounts } = setup();
    const { funding } = await ngn.account(TARGET, IDENTITY);
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 100_000));
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 100_000));
    expect((await accounts.getByFunding(funding.id))!.receivedKobo).toBe(100_000);
  });

  it("not enough yet: no conversion", async () => {
    const { ngn, bitnob } = setup();
    const { funding } = await ngn.account(TARGET, IDENTITY);
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 2_699_999));
    expect(bitnob.quotes).toHaveLength(0);
  });

  it("an over-deposit converts everything and credits the extra to the funder", async () => {
    const { ngn, credited, bitnob } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 80_050));
    expect(bitnob.quotes[0]!.quantity).toBe("800");
    expect(credited.map((c) => c.reason)).toEqual(["over-deposit of 30050 kobo"]);
  });

  it("a deposit after the bounty is funded is credited, not converted again", async () => {
    const { ngn, credited, events, bitnob } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-2", 50_000));
    expect(events).toHaveLength(1);
    expect(bitnob.quotes).toHaveLength(1);
    expect(credited[0]!.reason).toContain("late naira deposit");
  });

  it("deposits racing each other convert once", async () => {
    const { ngn, events, bitnob } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    await Promise.all([
      ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000)),
      ngn.handleDeposit(deposit(funding.bitnobRef, "tx-2", 50_000)),
      ngn.handleDeposit(deposit(funding.bitnobRef, "tx-3", 50_000)),
    ]);
    expect(bitnob.orders.size).toBe(1);
    expect(events).toHaveLength(1);
  });

  it.each([
    ["no reference", { virtualAccountId: "va-1", reference: null, amountMinor: 1, currency: "NGN" }],
    ["no amount", { virtualAccountId: "va-1", reference: "x", amountMinor: null, currency: "NGN" }],
    ["wrong currency", { virtualAccountId: "va-1", reference: "x", amountMinor: 50_000, currency: "USD" }],
  ])("ignores a deposit with %s", async (_n, d) => {
    const { ngn, accounts } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    expect(await ngn.handleDeposit(d)).toBeNull();
    expect((await accounts.getByFunding(funding.id))!.receivedKobo).toBe(0);
  });

  /** What a process killed mid-conversion leaves: converting, attempt n's reference and quote saved. */
  async function crashedAt(attempt: number) {
    const s = setup();
    const { funding } = await s.ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    await s.accounts.addDeposit(funding.bitnobRef, "tx-1", 50_000);
    const quote = await s.bitnob.createTradingQuote({ quantity: "500", quote_currency: "BTC" });
    const ref = `ngn-${funding.id}-${attempt}`;
    await s.accounts.update(funding.id, "collecting", { state: "converting", claimedKobo: 50_000, orderAttempt: attempt, orderReference: ref, quoteId: quote.id });
    return { ...s, funding, ref, quote };
  }

  it("server killed after the order went through: resume re-POSTs the reference, no second sell", async () => {
    const { ngn, bitnob, accounts, events, funding, ref } = await crashedAt(1);
    bitnob.orders.set(ref, { id: "order-x", status: "filled", reference: ref } as TradingOrder);
    bitnob.now += 60_000; // the quote is long gone: only the idempotent re-POST can return the order
    await ngn.resume();
    expect(bitnob.sells).toBe(1);
    expect(events).toHaveLength(1);
    expect((await accounts.getByFunding(funding.id))!.orderId).toBe("order-x");
  });

  it("attempt 1 expired, attempt 2 filled, then a crash: resume does not sell again", async () => {
    const { ngn, bitnob, events, ref } = await crashedAt(2);
    bitnob.orders.set(ref, { id: "order-2", status: "filled", reference: ref } as TradingOrder);
    bitnob.now += 60_000;
    await ngn.resume();
    expect(bitnob.sells).toBe(1);
    expect(bitnob.quotes).toHaveLength(1); // the one from crashedAt: no fresh quote
    expect(events).toHaveLength(1);
    await ngn.resume();
    expect(events).toHaveLength(1);
  });

  it("server killed before the order: resume converts it with the next reference", async () => {
    const { ngn, bitnob, events, funding } = await crashedAt(1);
    bitnob.now += 60_000;
    await ngn.resume();
    expect(events).toHaveLength(1);
    expect([...bitnob.orders.keys()]).toEqual([`ngn-${funding.id}-2`]);
  });

  it("a pending order is looked up by id on resume, never by reference", async () => {
    const { ngn, bitnob, accounts, events } = setup();
    bitnob.orderStatus = "pending";
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    const a = await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    expect(a).toMatchObject({ state: "converting", orderId: expect.stringMatching(/^order-/) });
    expect(events).toHaveLength(0); // no funding.paid for a pending order
    const getById = vi.spyOn(bitnob, "getTradingOrder");
    await ngn.resume();
    expect(events).toHaveLength(0);
    bitnob.orders.get(`ngn-${funding.id}-1`)!.status = "filled";
    await ngn.resume();
    expect(getById).toHaveBeenCalledWith(a!.orderId);
    expect(events).toHaveLength(1);
    expect(bitnob.sells).toBe(1);
    expect((await accounts.getByFunding(funding.id))!.state).toBe("converted");
  });

  it("a funded bounty refuses a new naira account", async () => {
    const { ngn } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    await expect(ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY)).rejects.toMatchObject({ code: "ALREADY_FUNDED" });
  });
});

describe("review fixes (#65)", () => {
  it.each([
    ["422 INSUFFICIENT_FUNDS", new BitnobError("POST /api/trading/quotes failed: 422 INSUFFICIENT_FUNDS: insufficient balance", 422, "INSUFFICIENT_FUNDS")],
    ["400 INVALID_AMOUNT", new BitnobError("POST /api/trading/quotes failed: 400 INVALID_AMOUNT: amount above configured maximum", 400, "INVALID_AMOUNT")],
  ])("a quote refused with %s is not re-quoted, and simulate stops depositing", async (_n, err) => {
    const { ngn, bitnob, events } = setup();
    bitnob.quoteError = err;
    const quote = vi.spyOn(bitnob, "createTradingQuote");
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY); // ₦500 → 1 simulated deposit
    const a = await ngn.simulateUntilFunded(funding.id);
    expect(a).toMatchObject({ state: "collecting", lastError: err.message });
    expect(quote).toHaveBeenCalledTimes(1);
    expect(bitnob.simulateCalls).toBe(1);
    expect(events).toHaveLength(0);
    // Calling it again tries one conversion, no more deposits.
    await ngn.simulateUntilFunded(funding.id);
    expect(bitnob.simulateCalls).toBe(1);
    expect(quote).toHaveBeenCalledTimes(2);
  });

  it("an order refused for another reason than expiry is not retried with a new quote", async () => {
    const { ngn, bitnob } = setup();
    vi.spyOn(bitnob, "createTradingOrder").mockRejectedValue(new BitnobError("insufficient balance", 422, "INSUFFICIENT_FUNDS"));
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    const a = await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    expect(a).toMatchObject({ state: "collecting", lastError: "insufficient balance", orderReference: null });
    expect(bitnob.quotes).toHaveLength(1);
  });

  it("refuses a bounty above maxNaira before opening an account", async () => {
    const { ngn, bitnob } = setup({ maxNaira: 3_000 });
    await expect(ngn.account(TARGET, IDENTITY)).rejects.toMatchObject({ code: "AMOUNT_TOO_LARGE" }); // ₦27,000
    expect(bitnob.accounts.size).toBe(0);
  });

  it("simulate gives up early when the deposits needed exceed maxCalls", async () => {
    const { ngn, bitnob } = setup();
    const { funding } = await ngn.account(TARGET, IDENTITY); // ₦27,000 = 27 deposits
    await expect(ngn.simulateUntilFunded(funding.id, 10)).rejects.toThrow(/more than 10 simulated deposits/);
    expect(bitnob.simulateCalls).toBe(1);
  });

  it("a deposit landing during the conversion is credited once, not sold", async () => {
    const { ngn, bitnob, credited, events } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    const realOrder = bitnob.createTradingOrder.bind(bitnob);
    vi.spyOn(bitnob, "createTradingOrder").mockImplementationOnce(async (input) => {
      await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-during", 20_000));
      return realOrder(input);
    });
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    expect(bitnob.quotes[0]!.quantity).toBe("500");
    expect(events).toHaveLength(1);
    expect(credited.map((c) => c.reason)).toEqual(["late naira deposit of 20000 kobo (during conversion)"]);
  });

  it("a deposit during a conversion that then fails is sold on the retry, never credited", async () => {
    const { ngn, bitnob, credited, events } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    vi.spyOn(bitnob, "createTradingOrder").mockImplementationOnce(async () => {
      await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-during", 20_000));
      throw new BitnobError("insufficient balance", 422, "INSUFFICIENT_FUNDS");
    });
    await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    await ngn.resume();
    expect(bitnob.quotes.map((q) => q.quantity)).toEqual(["500", "700"]);
    expect(events).toHaveLength(1);
    expect(credited.map((c) => c.reason)).toEqual(["over-deposit of 20000 kobo"]);
  });

  it("network error after the order was placed: reference kept, resume re-POSTs it, one sell", async () => {
    const { ngn, bitnob, accounts, events } = setup();
    bitnob.orderNetworkError = "after";
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    const a = await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000));
    expect(a).toMatchObject({ state: "converting", orderReference: `ngn-${funding.id}-1`, lastError: "bad gateway" });
    expect(events).toHaveLength(0);
    bitnob.now += 60_000;
    await ngn.resume();
    expect(bitnob.sells).toBe(1);
    expect(events).toHaveLength(1);
    expect((await accounts.getByFunding(funding.id))!.state).toBe("converted");
  });

  it("network error before the order existed: resume moves to the next reference", async () => {
    const { ngn, bitnob, events } = setup();
    bitnob.orderNetworkError = "before";
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    expect((await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000)))?.state).toBe("converting");
    bitnob.now += 60_000;
    await ngn.resume();
    expect([...bitnob.orders.keys()]).toEqual([`ngn-${funding.id}-2`]);
    expect(events).toHaveLength(1);
  });

  it("a quote with less than the safety margin left is not used", async () => {
    const { ngn, bitnob } = setup();
    bitnob.quoteTtlMs = 2_000;
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    expect(await ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000))).toMatchObject({ state: "collecting", lastError: "quote already expired" });
    expect(bitnob.orderCalls).toBe(0);
  });

  it("crash between converted and markPaid: resume emits funding.paid once", async () => {
    const { ngn, bitnob, fundings, events } = setup();
    const { funding } = await ngn.account({ ...TARGET, amountXof: 100 }, IDENTITY);
    const markPaid = vi.spyOn(fundings, "markPaid").mockRejectedValueOnce(new Error("killed"));
    await expect(ngn.handleDeposit(deposit(funding.bitnobRef, "tx-1", 50_000))).rejects.toThrow("killed");
    markPaid.mockRestore();
    expect(events).toHaveLength(0);
    await ngn.resume();
    await ngn.resume();
    expect(events).toHaveLength(1);
    expect(bitnob.sells).toBe(1);
  });
});

describe("funder customers (KYC)", () => {
  it("a funder first seen by Lightning (email only) gets a KYC customer for the naira account", async () => {
    const createCustomer = vi.fn(async (input: { reference?: string }) => ({ id: `cust-${input.reference}` }) as never);
    const customers = new BitnobFunderCustomers({ createCustomer });
    expect(await customers.customerId("acme")).toBe("cust-funder-acme");
    expect(await customers.customerId("acme", { country_code: "NGA", ...IDENTITY })).toBe("cust-funder-acme-kyc");
    expect(createCustomer).toHaveBeenLastCalledWith(expect.objectContaining({ email: "funder-acme+kyc@bitbounty.invalid", first_name: "Ada" }));
    expect(await customers.customerId("acme", IDENTITY)).toBe("cust-funder-acme-kyc");
    expect(createCustomer).toHaveBeenCalledTimes(2);
  });

  it("naira first: one KYC customer, reused by Lightning", async () => {
    const createCustomer = vi.fn(async (input: { reference?: string }) => ({ id: `cust-${input.reference}` }) as never);
    const customers = new BitnobFunderCustomers({ createCustomer });
    expect(await customers.customerId("acme", IDENTITY)).toBe("cust-funder-acme");
    expect(await customers.customerId("acme")).toBe("cust-funder-acme");
    expect(createCustomer).toHaveBeenCalledTimes(1);
  });
});
