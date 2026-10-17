import type { LightningInvoice } from "@bitbounty/bitnob";
import type { InternalEvent } from "@bitbounty/core";
import { describe, expect, it, vi } from "vitest";
import {
  BitnobFunderCustomers,
  BitnobRates,
  InMemoryFundingStore,
  LightningFunding,
  priceBounty,
  toInvoiceStatus,
  xofToNaira,
  xofToSats,
  type FundingRecord,
  type Rates,
} from "../src/funding/index.js";

const T0 = new Date("2026-10-17T20:00:00Z").getTime();
/** 600 FCFA per USDT, 100,000 USDT per BTC → 1 sat = 0.6 FCFA. */
const RATES: Rates = {
  xofPerUsdt: async () => 600,
  usdtPerBtc: async () => 100_000,
  ngnPerUsdt: async () => 1_500,
};

class FakeLightning {
  invoices = new Map<string, LightningInvoice>();
  created: { amount: number; reference: string; customer_id: string }[] = [];
  private n = 0;
  async createLightningInvoice(input: { customer_id: string; amount: number; reference: string; expiry: number }) {
    this.created.push({ amount: input.amount, reference: input.reference, customer_id: input.customer_id });
    const id = `inv-${++this.n}`;
    const inv: LightningInvoice = { id, request: `lnbcrt${input.amount}n1${id}`, payment_hash: `hash-${id}`, status: "pending" };
    this.invoices.set(id, inv);
    return inv;
  }
  async getLightningInvoice(id: string) {
    return this.invoices.get(id)!;
  }
  pay(id: string) {
    this.invoices.get(id)!.status = "paid";
  }
}

function setup() {
  let now = T0;
  const client = new FakeLightning();
  const store = new InMemoryFundingStore();
  const events: InternalEvent[] = [];
  const credited: { funding: FundingRecord; reason: string }[] = [];
  const createCustomer = vi.fn(async () => ({ id: "cust-1" }) as never);
  let id = 0;
  const funding = new LightningFunding({
    client,
    store,
    rates: RATES,
    customers: new BitnobFunderCustomers({ createCustomer }),
    emit: (e) => {
      events.push(e);
    },
    credit: (f, reason) => {
      credited.push({ funding: f, reason });
    },
    now: () => new Date(now),
    newId: () => `f${++id}`,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return { client, store, events, credited, funding, createCustomer, advance: (ms: number) => (now += ms) };
}

const TARGET = { bountyId: "b1", amountXof: 10_000, funderId: "jib" };

describe("pricing", () => {
  it("adds a 5% fee and a 3% buffer, rounded up, in whole FCFA", () => {
    expect(priceBounty(10_000)).toEqual({ amountXof: 10_000, feeXof: 500, bufferXof: 300, totalXof: 10_800 });
    expect(priceBounty(137)).toEqual({ amountXof: 137, feeXof: 7, bufferXof: 5, totalXof: 149 });
  });

  it("converts FCFA to sats and naira, rounding up to integers", async () => {
    expect(await xofToSats(RATES, 10_800)).toBe(18_000);
    expect(await xofToSats(RATES, 1)).toBe(2);
    expect(await xofToNaira(RATES, 10_800)).toBe(27_000);
    expect(await xofToNaira(RATES, 1)).toBe(3);
  });

  it("BitnobRates reads Bitnob, caches, and refuses a zero rate", async () => {
    const getExchangeRate = vi.fn(async (_f: string, to: string) => ({ mid_rate: to === "XOF" ? "605.5" : "0" }) as never);
    const getTradingPrice = vi.fn(async () => ({ price: "98000.5" }) as never);
    const rates = new BitnobRates({ getExchangeRate, getTradingPrice });
    expect(await rates.xofPerUsdt()).toBe(605.5);
    expect(await rates.xofPerUsdt()).toBe(605.5);
    expect(await rates.usdtPerBtc()).toBe(98000.5);
    expect(getExchangeRate).toHaveBeenCalledTimes(1);
    await expect(rates.ngnPerUsdt()).rejects.toThrow("unusable USDT/NGN rate");
  });

  it.each([
    ["paid", "paid"],
    ["SETTLED", "paid"],
    ["expired", "expired"],
    ["pending", "pending"],
    [undefined, "pending"],
  ])("invoice status %s → %s", (raw, expected) => {
    expect(toInvoiceStatus(raw)).toBe(expected);
  });
});

describe("invoice", () => {
  it("creates an invoice for bounty + fee + buffer in sats, for the funder's Bitnob customer", async () => {
    const { funding, client } = setup();
    const f = await funding.invoice(TARGET);
    expect(client.created).toEqual([{ amount: 18_000, reference: "fund-b1-1", customer_id: "cust-1" }]);
    expect(f).toMatchObject({
      bountyId: "b1",
      rail: "lightning",
      sourceAmount: 18_000,
      sourceCurrency: "BTC",
      bitnobRef: "inv-1",
      paymentRequest: "lnbcrt18000n1inv-1",
      paymentHash: "hash-inv-1",
      status: "pending",
      amountXof: 10_000,
      feeXof: 500,
      bufferXof: 300,
      expiresAt: new Date(T0 + 900_000).toISOString(),
    });
  });

  it("asking again returns the same open invoice", async () => {
    const { funding, client } = setup();
    const a = await funding.invoice(TARGET);
    const b = await funding.invoice(TARGET);
    expect(b.id).toBe(a.id);
    expect(client.created).toHaveLength(1);
  });

  it("reuses the Bitnob customer of a funder", async () => {
    const { funding, createCustomer } = setup();
    await funding.invoice(TARGET);
    await funding.invoice({ ...TARGET, bountyId: "b2" });
    expect(createCustomer).toHaveBeenCalledTimes(1);
  });

  it.each([0, 10.5, -1])("refuses amount %s", async (amountXof) => {
    const { funding, client } = setup();
    await expect(funding.invoice({ ...TARGET, amountXof })).rejects.toThrow("positive integer");
    expect(client.created).toHaveLength(0);
  });
});

describe("paid → funding.paid (done when)", () => {
  it("polling finds the paid invoice and emits funding.paid for the right bounty", async () => {
    const { funding, client, events, store } = setup();
    await funding.invoice({ ...TARGET, bountyId: "other" });
    const f = await funding.invoice(TARGET);
    client.pay(f.bitnobRef);
    await funding.poll();
    expect(events).toEqual([
      { type: "funding.paid", bountyId: "b1", occurredAt: new Date(T0).toISOString(), fundingId: f.id, rail: "lightning", amountXof: 10_000 },
    ]);
    expect((await store.get(f.id))!.status).toBe("paid");
  });

  it("a funded bounty refuses a new invoice", async () => {
    const { funding, client } = setup();
    const f = await funding.invoice(TARGET);
    client.pay(f.bitnobRef);
    await funding.check(f.id);
    await expect(funding.invoice(TARGET)).rejects.toMatchObject({ code: "ALREADY_FUNDED" });
  });
});

describe("reviewer checklist", () => {
  it("an expiring invoice is replaced by a new one; the old one is no longer shown", async () => {
    const { funding, client, advance } = setup();
    const old = await funding.invoice(TARGET);
    advance(900_000 - 30_000); // 30 s left
    const fresh = await funding.invoice(TARGET);
    expect(fresh.id).not.toBe(old.id);
    expect(client.created.map((c) => c.reference)).toEqual(["fund-b1-1", "fund-b1-2"]);
    expect((await funding.invoice(TARGET)).id).toBe(fresh.id);
  });

  it("Bitnob reports the old invoice expired: marked expired, never emits", async () => {
    const { funding, client, events, store, advance } = setup();
    const old = await funding.invoice(TARGET);
    advance(900_000);
    client.invoices.get(old.bitnobRef)!.status = "expired";
    await funding.poll();
    expect((await store.get(old.id))!.status).toBe("expired");
    expect(events).toHaveLength(0);
  });

  it("the same invoice reported paid twice: funded once", async () => {
    const { funding, client, events } = setup();
    const f = await funding.invoice(TARGET);
    client.pay(f.bitnobRef);
    await Promise.all([funding.check(f.id), funding.check(f.id), funding.poll()]);
    await funding.poll();
    expect(events.filter((e) => e.type === "funding.paid")).toHaveLength(1);
  });

  it("two invoices paid for one bounty: funded once, the second credited to the funder", async () => {
    const { funding, client, events, credited, advance } = setup();
    const old = await funding.invoice(TARGET);
    advance(900_000 - 30_000);
    const fresh = await funding.invoice(TARGET);
    // The funder paid both: the old one just before it expired, then the new one.
    client.pay(old.bitnobRef);
    client.pay(fresh.bitnobRef);
    await funding.poll();
    expect(events.filter((e) => e.type === "funding.paid")).toHaveLength(1);
    expect(events[0]).toMatchObject({ fundingId: old.id });
    expect(credited).toHaveLength(1);
    expect(credited[0]).toMatchObject({ funding: { id: fresh.id, status: "paid", sourceAmount: 18_000 }, reason: expect.stringContaining("already funded") });
  });

  it("money on an invoice we had stopped showing still counts", async () => {
    const { funding, client, events, advance } = setup();
    const old = await funding.invoice(TARGET);
    advance(900_000 - 30_000);
    await funding.invoice(TARGET);
    client.pay(old.bitnobRef);
    await funding.poll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fundingId: old.id });
  });

  it("a Bitnob error while polling one invoice doesn't stop the others", async () => {
    const { funding, client, events } = setup();
    const a = await funding.invoice(TARGET);
    const b = await funding.invoice({ ...TARGET, bountyId: "b2" });
    client.pay(b.bitnobRef);
    client.invoices.delete(a.bitnobRef);
    const get = client.getLightningInvoice.bind(client);
    client.getLightningInvoice = async (id: string) => {
      if (id === a.bitnobRef) throw new Error("boom");
      return get(id);
    };
    await funding.poll();
    expect(events.map((e) => e.bountyId)).toEqual(["b2"]);
  });
});

describe("polling cadence", () => {
  it("poll(true) only checks invoices someone is watching, for 2 minutes", async () => {
    const { funding, client, events, advance } = setup();
    const a = await funding.invoice(TARGET);
    const b = await funding.invoice({ ...TARGET, bountyId: "b2" });
    client.pay(a.bitnobRef);
    client.pay(b.bitnobRef);
    funding.watch(a.id);
    await funding.poll(true);
    expect(events.map((e) => e.bountyId)).toEqual(["b1"]);
    advance(121_000);
    await funding.poll(true);
    expect(events).toHaveLength(1);
    await funding.poll();
    expect(events.map((e) => e.bountyId)).toEqual(["b1", "b2"]);
  });
});
