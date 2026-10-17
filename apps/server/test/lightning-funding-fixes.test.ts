/** Regression tests for the #63 review fixes (B1-review-fixes). */
import { BitnobError, type CreateLightningInvoiceInput, type LightningInvoice } from "@bitbounty/bitnob";
import { createBounty, type BountyStatus, type InternalEvent } from "@bitbounty/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryBountyRepo } from "../src/bounties/repo.js";
import {
  applyFundingPaid,
  BitnobFunderCustomers,
  InMemoryFundingStore,
  LightningFunding,
  type FundingRecord,
  type LightningFundingOptions,
  type Rates,
} from "../src/funding/index.js";

const T0 = new Date("2026-10-17T20:00:00Z").getTime();
const RATES: Rates = { xofPerUsdt: async () => 600, usdtPerBtc: async () => 100_000, ngnPerUsdt: async () => 1_500 };
const TARGET = { bountyId: "b1", amountXof: 10_000, funderId: "jib" };

class FakeLightning {
  invoices = new Map<string, LightningInvoice>();
  created: { amount: number; reference: string }[] = [];
  private n = 0;
  async createLightningInvoice(input: CreateLightningInvoiceInput): Promise<LightningInvoice> {
    this.created.push({ amount: input.amount, reference: input.reference ?? "" });
    const id = `inv-${++this.n}`;
    const inv: LightningInvoice = { id, request: `lnbc${id}`, payment_hash: `hash-${id}`, status: "pending" };
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

function setup(over: Partial<LightningFundingOptions> = {}) {
  let now = T0;
  const client = new FakeLightning();
  const store = new InMemoryFundingStore();
  const events: InternalEvent[] = [];
  const credited: FundingRecord[] = [];
  let id = 0;
  const funding = new LightningFunding({
    client,
    store,
    rates: RATES,
    customers: new BitnobFunderCustomers({ createCustomer: async () => ({ id: "cust-1" }) as never }),
    emit: (e) => void events.push(e),
    credit: (f) => void credited.push(f),
    now: () => new Date(now),
    newId: () => `f${++id}-0000000000`,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  });
  return { client, store, events, credited, funding, advance: (ms: number) => (now += ms) };
}

afterEach(() => vi.useRealTimers());

describe("funding.paid is delivered exactly once (outbox)", () => {
  it("emit throws once: the row stays un-notified and the next poll delivers it", async () => {
    const events: InternalEvent[] = [];
    let fail = true;
    const { funding, client, store } = setup({
      emit: (e) => {
        if (fail) {
          fail = false;
          throw new Error("queue down");
        }
        events.push(e);
      },
    });
    const f = await funding.invoice(TARGET);
    client.pay(f.bitnobRef);
    await funding.poll();
    expect(events).toHaveLength(0);
    expect(await store.get(f.id)).toMatchObject({ status: "paid", fundsBounty: true, notifiedAt: null });

    await funding.poll();
    expect(events).toMatchObject([{ type: "funding.paid", bountyId: "b1", fundingId: f.id, amountXof: 10_000 }]);
    expect((await store.get(f.id))!.notifiedAt).toBeTruthy();

    await funding.poll();
    expect(events).toHaveLength(1);
  });

  it("a failed credit is retried by the outbox too, and never becomes a funding.paid", async () => {
    const credited: FundingRecord[] = [];
    let fail = true;
    const { funding, client, events, advance } = setup({
      credit: (f) => {
        if (fail) {
          fail = false;
          throw new Error("ledger down");
        }
        credited.push(f);
      },
    });
    const old = await funding.invoice(TARGET);
    advance(900_000 - 30_000);
    const fresh = await funding.invoice(TARGET);
    client.pay(old.bitnobRef);
    client.pay(fresh.bitnobRef);
    await funding.poll();
    expect(credited).toHaveLength(0);
    await funding.poll();
    expect(credited.map((f) => f.id)).toEqual([fresh.id]);
    expect(events).toMatchObject([{ type: "funding.paid", fundingId: old.id }]);
  });
});

describe("invoice()", () => {
  it("concurrent calls for one bounty share one invoice", async () => {
    const { funding, client } = setup();
    const all = await Promise.all([funding.invoice(TARGET), funding.invoice(TARGET), funding.invoice(TARGET)]);
    expect(new Set(all.map((f) => f.id)).size).toBe(1);
    expect(client.created).toHaveLength(1);
  });

  it("Bitnob 409 DUPLICATE_KEY_ERROR: returns the open invoice another process stored", async () => {
    const { funding, client, store } = setup();
    const template = await funding.invoice({ ...TARGET, bountyId: "tmp" });
    client.createLightningInvoice = async () => {
      await store.create({ ...template, id: "other-process", bountyId: "b1", bitnobRef: "inv-other" });
      throw new BitnobError("duplicate", 409, "DUPLICATE_KEY_ERROR");
    };
    expect((await funding.invoice(TARGET)).id).toBe("other-process");
  });

  it("Bitnob 409 with nothing stored: retries once with a fresh reference", async () => {
    const { funding, client } = setup();
    const create = client.createLightningInvoice.bind(client);
    let first = true;
    client.createLightningInvoice = async (input) => {
      if (first) {
        first = false;
        throw new BitnobError("duplicate", 409, "DUPLICATE_KEY_ERROR");
      }
      return create(input);
    };
    const f = await funding.invoice(TARGET);
    expect(f.status).toBe("pending");
    expect(client.created.map((c) => c.reference)).toEqual(["fund-b1-1-f1-00000"]);
  });

  it("other Bitnob errors still fail", async () => {
    const { funding, client } = setup();
    client.createLightningInvoice = async () => {
      throw new BitnobError("bad", 400, "VALIDATION_ERROR");
    };
    await expect(funding.invoice(TARGET)).rejects.toThrow("bad");
  });
});

describe("local expiry", () => {
  it("an invoice Bitnob still calls pending is expired locally after expiresAt + grace", async () => {
    const { funding, store, advance } = setup();
    const f = await funding.invoice(TARGET);
    advance(900_000 + 60_000);
    await funding.poll();
    expect((await store.get(f.id))!.status).toBe("pending"); // inside the 10 min grace
    advance(600_000);
    await funding.poll();
    expect((await store.get(f.id))!.status).toBe("expired");
    expect(await store.listPending("lightning")).toHaveLength(0);
  });

  it("a payment found on that last check still counts", async () => {
    const { funding, client, store, events, advance } = setup();
    const f = await funding.invoice(TARGET);
    advance(900_000 + 700_000);
    client.pay(f.bitnobRef);
    await funding.poll();
    expect((await store.get(f.id))!.status).toBe("paid");
    expect(events).toHaveLength(1);
  });
});

describe("startPolling", () => {
  it("never runs two passes at once", async () => {
    vi.useFakeTimers();
    const { funding } = setup();
    let running = 0;
    let max = 0;
    let calls = 0;
    funding.poll = async () => {
      calls++;
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 10_000)); // a slow Bitnob
      running--;
    };
    const stop = funding.startPolling(1_000, 5_000);
    await vi.advanceTimersByTimeAsync(25_000);
    stop();
    expect(max).toBe(1);
    expect(calls).toBeGreaterThan(1);
  });
});

describe("with the shared bounty repo", () => {
  function withRepo(status: BountyStatus, amountXof = 10_000) {
    const repo = new InMemoryBountyRepo();
    const { bounty } = createBounty({
      id: "b1",
      repoFullName: "o/r",
      issueNumber: 1,
      issueTitle: "t",
      amountXof,
      criteria: [],
      funderKind: "human",
      funderId: "jib",
      createdAt: new Date(T0).toISOString(),
    });
    repo.bounties.set("b1", { ...bounty, status });
    return { ...setup({ bounties: repo }), repo };
  }

  it("takes amountXof from the stored bounty, not from the caller", async () => {
    const { funding, client } = withRepo("unfunded", 5_000);
    const f = await funding.invoice({ bountyId: "b1", funderId: "jib", amountXof: 1 });
    expect(f.amountXof).toBe(5_000);
    expect(client.created[0]!.amount).toBe(9_000); // 5,400 FCFA at 0.6 FCFA/sat
  });

  it.each([
    ["cancelled", "NOT_FUNDABLE"],
    ["funded", "ALREADY_FUNDED"],
    ["claimed", "ALREADY_FUNDED"],
  ] as const)("a %s bounty gets no invoice (%s)", async (status, code) => {
    const { funding, client } = withRepo(status);
    await expect(funding.invoice({ bountyId: "b1", funderId: "jib" })).rejects.toMatchObject({ code });
    expect(client.created).toHaveLength(0);
  });

  it("an unknown bounty gets no invoice", async () => {
    const { funding } = withRepo("unfunded");
    await expect(funding.invoice({ bountyId: "nope", funderId: "jib" })).rejects.toMatchObject({
      code: "BOUNTY_NOT_FOUND",
    });
  });

  it("applyFundingPaid moves the bounty to funded once; a re-delivery is a no-op", async () => {
    const { repo } = withRepo("unfunded");
    const published: InternalEvent[] = [];
    const apply = applyFundingPaid(repo, { publish: async (e) => void published.push(e) }, { info: vi.fn(), error: vi.fn() });
    const event: InternalEvent = {
      type: "funding.paid",
      bountyId: "b1",
      occurredAt: new Date(T0).toISOString(),
      fundingId: "f1",
      rail: "lightning",
      amountXof: 10_000,
    };
    await apply(event);
    await apply(event);
    expect((await repo.findById("b1"))!.status).toBe("funded");
    expect(published).toHaveLength(1);
  });

  it("end to end: invoice paid → bounty funded, even when the first delivery fails", async () => {
    const repo = new InMemoryBountyRepo();
    const { bounty } = createBounty({
      id: "b1",
      repoFullName: "o/r",
      issueNumber: 1,
      issueTitle: "t",
      amountXof: 10_000,
      criteria: [],
      funderKind: "human",
      funderId: "jib",
      createdAt: new Date(T0).toISOString(),
    });
    repo.bounties.set("b1", bounty);
    const published: InternalEvent[] = [];
    const apply = applyFundingPaid(repo, { publish: async (e) => void published.push(e) }, { info: vi.fn(), error: vi.fn() });
    let fail = true;
    const { funding, client } = setup({
      bounties: repo,
      emit: async (e) => {
        if (fail) {
          fail = false;
          throw new Error("db blip");
        }
        await apply(e);
      },
    });
    const f = await funding.invoice({ bountyId: "b1", funderId: "jib" });
    client.pay(f.bitnobRef);
    await funding.poll();
    expect((await repo.findById("b1"))!.status).toBe("unfunded");
    await funding.poll();
    expect((await repo.findById("b1"))!.status).toBe("funded");
    expect(published).toHaveLength(1);
  });
});
