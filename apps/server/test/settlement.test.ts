import { createBounty, transition, type Bounty, type InternalEvent } from "@bitbounty/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryBountyRepo } from "../src/bounties/repo.js";
import { FakeBitnob } from "../src/e2e/fake-bitnob.js";
import { InMemoryEventBus } from "../src/github/pr/index.js";
import { InMemoryPayoutStore, PayoutService, type PayoutRails } from "../src/payouts/index.js";
import type { PayoutRequest } from "../src/payouts/service.js";
import { beneficiaryFromAccounts, readObjectionWindowMs, readPayoutAccounts, Settlement } from "../src/settlement/index.js";

const AT = "2026-10-17T22:00:00.000Z";

function setup(status: Bounty["status"], opts: { payouts?: boolean; claimant?: boolean; verdict?: Bounty["verdict"] } = {}) {
  const repo = new InMemoryBountyRepo();
  const { bounty } = createBounty({
    id: "b1",
    repoFullName: "o/r",
    issueNumber: 1,
    issueTitle: "t",
    amountXof: 10_000,
    criteria: [],
    funderKind: "human",
    funderId: "github:fatou",
    createdAt: AT,
  });
  repo.add({ ...bounty, status, verdict: opts.verdict ?? null }, opts.claimant === false ? undefined : { claimId: "c1", userId: "github:awa", login: "awa" });
  const bus = new InMemoryEventBus();
  const startPayout = vi.fn(async () => undefined);
  const sync = vi.fn(async () => undefined);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const settlement = new Settlement({
    repo,
    bus,
    startPayout: opts.payouts === false ? undefined : startPayout,
    sync,
    schedule: (fn) => fn(),
    log,
  }).register();
  const status_ = async () => (await repo.findById("b1"))!.status;
  return { repo, bus, settlement, startPayout, sync, log, status: status_ };
}

const ev = <T extends InternalEvent["type"]>(type: T, extra: object = {}) =>
  ({ type, bountyId: "b1", occurredAt: AT, ...extra }) as Extract<InternalEvent, { type: T }>;

describe("settlement", () => {
  it("verify.done records the verdict on a submitted bounty and re-renders the status comment", async () => {
    const { bus, repo, sync } = setup("submitted");
    await bus.publish(ev("verify.done", { prNumber: 2, headSha: "abc", verdict: "pass" }));
    expect((await repo.findById("b1"))!).toMatchObject({ status: "submitted", verdict: "pass" });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("verify.done after the merge changes nothing", async () => {
    const { bus, repo } = setup("on_hold");
    await bus.publish(ev("verify.done", { prNumber: 2, headSha: "abc", verdict: "pass" }));
    expect((await repo.findById("b1"))!).toMatchObject({ status: "on_hold", verdict: null });
  });

  it("a merge that verified the bounty starts the payout to the claimant", async () => {
    const { bus, startPayout } = setup("verified");
    await bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    expect(startPayout).toHaveBeenCalledWith({ bountyId: "b1", userId: "github:awa", amountXof: 10_000 });
  });

  it("/pay that verified the bounty starts the payout too", async () => {
    const { bus, startPayout } = setup("verified");
    await bus.publish(ev("maintainer.pay", { actorLogin: "fatou" }));
    expect(startPayout).toHaveBeenCalledTimes(1);
  });

  it("a merge that left the bounty on_hold pays nothing", async () => {
    const { bus, startPayout } = setup("on_hold");
    await bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: false }));
    expect(startPayout).not.toHaveBeenCalled();
  });

  it("no claimant or no payouts configured: logged, nothing sent", async () => {
    const a = setup("verified", { claimant: false });
    await a.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    expect(a.startPayout).not.toHaveBeenCalled();
    expect(a.log.error).toHaveBeenCalled();
    const b = setup("verified", { payouts: false });
    await b.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    expect(b.log.warn).toHaveBeenCalledWith(expect.stringContaining("payouts aren't configured"));
  });

  it("payout events move the bounty verified → paying → paid and are published", async () => {
    const { settlement, bus, status } = setup("verified");
    await settlement.applyPayoutEvent(ev("payout.started", { payoutId: "p1", attempt: 1 }));
    expect(await status()).toBe("paying");
    await settlement.applyPayoutEvent(ev("payout.succeeded", { payoutId: "p1", bitnobPayoutId: "bp1" }));
    expect(await status()).toBe("paid");
    expect(bus.published.map((e) => e.type)).toEqual(["payout.started", "payout.succeeded"]);
  });

  it("a failed attempt → payout_failed, the retry → paying again", async () => {
    const { settlement, status } = setup("paying");
    await settlement.applyPayoutEvent(ev("payout.failed", { payoutId: "p1", attempt: 1, error: "x" }));
    expect(await status()).toBe("payout_failed");
    await settlement.applyPayoutEvent(ev("payout.started", { payoutId: "p1", attempt: 2 }));
    expect(await status()).toBe("paying");
  });

  it("a replayed payout.succeeded on a paid bounty is dropped, not published twice", async () => {
    const { settlement, bus, log } = setup("paid");
    await settlement.applyPayoutEvent(ev("payout.succeeded", { payoutId: "p1", bitnobPayoutId: "bp1" }));
    expect(bus.published).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("ignored"));
  });

  it("a status comment that fails to update doesn't break the flow", async () => {
    const { bus, sync, repo } = setup("submitted");
    sync.mockRejectedValueOnce(new Error("GitHub down"));
    await bus.publish(ev("verify.done", { prNumber: 2, headSha: "abc", verdict: "fail" }));
    expect((await repo.findById("b1"))!.verdict).toBe("fail");
  });
});

describe("PAYOUT_ACCOUNTS", () => {
  it("reads accounts by GitHub login, country SN by default", async () => {
    const accounts = readPayoutAccounts({
      PAYOUT_ACCOUNTS: '{"Awa-Dev":{"provider":"wave","phone":"+221771234567","name":"Awa Diop"},"kofi":{"provider":"orange","phone":"+233201234567","name":"Kofi","country":"gh"}}',
    });
    const get = beneficiaryFromAccounts(accounts);
    expect(await get("github:awa-dev")).toEqual({ provider: "wave", phoneE164: "+221771234567", accountName: "Awa Diop", country: "SN" });
    expect((await get("github:kofi")).country).toBe("GH");
    await expect(get("github:nobody")).rejects.toThrow("no payout account for @nobody");
  });

  it("empty → no accounts", () => {
    expect(readPayoutAccounts({}).size).toBe(0);
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["a bad provider", '{"a":{"provider":"mpesa","phone":"+221771234567","name":"A"}}'],
    ["a phone without +", '{"a":{"provider":"wave","phone":"221771234567","name":"A"}}'],
    ["no name", '{"a":{"provider":"wave","phone":"+221771234567"}}'],
  ])("refuses %s at boot", (_n, value) => {
    expect(() => readPayoutAccounts({ PAYOUT_ACCOUNTS: value })).toThrow("PAYOUT_ACCOUNTS");
  });
});

// ---- Review fixes on #85: the objection window, boot validation, missing accounts, restarts ----

const WINDOW_MS = 1440 * 60_000;
const BENEFICIARY = { provider: "wave" as const, phoneE164: "+221771234567", accountName: "Awa Diop", country: "SN" };
const quiet = { info: () => {}, warn: () => {}, error: () => {} };
/** Lets the fire-and-forget payout chain (timer → start → payout.started) run to the end. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** Settlement + the real B2 PayoutService on FakeBitnob, with timers the test fires by hand. */
function windowSetup(opts: { status?: Bounty["status"]; repo?: InMemoryBountyRepo; objectionMs?: number } = {}) {
  let repo = opts.repo;
  if (!repo) {
    repo = new InMemoryBountyRepo();
    const { bounty } = createBounty({
      id: "b1",
      repoFullName: "o/r",
      issueNumber: 1,
      issueTitle: "t",
      amountXof: 10_000,
      criteria: [],
      funderKind: "human",
      funderId: "github:fatou",
      createdAt: AT,
    });
    repo.add({ ...bounty, status: opts.status ?? "verified", verdict: "pass" }, { claimId: "c1", userId: "github:awa", login: "awa" });
  }
  const r = repo;
  const bus = new InMemoryEventBus();
  const fake = new FakeBitnob();
  const finalize = vi.spyOn(fake, "finalizePayout");
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const store = new InMemoryPayoutStore();
  const holder: { payouts?: PayoutService } = {};
  const startPayout = vi.fn((req: PayoutRequest) => holder.payouts!.start(req));
  const settlement = new Settlement({
    repo: r,
    bus,
    startPayout,
    objectionMs: opts.objectionMs ?? WINDOW_MS,
    schedule: opts.objectionMs === 0 ? (fn) => fn() : (fn, ms) => void timers.push({ fn, ms }),
    log: quiet,
  }).register();
  holder.payouts = new PayoutService({
    rails: fake as unknown as PayoutRails,
    store,
    emit: settlement.applyPayoutEvent,
    getBeneficiary: async () => BENEFICIARY,
    callbackUrl: "https://bitbounty.test/webhooks/bitnob",
    schedule: () => {},
    log: quiet,
  });
  /** What a GitHub command does: transition, compare-and-set, publish (handle-comment.ts `apply`). */
  const move = async (event: InternalEvent) => {
    const t = transition((await r.findById("b1"))!, event);
    if (!t.ok) throw new Error(t.message);
    expect(await r.update(t.bounty, t.from)).toBeTruthy();
    await bus.publish(t.event);
  };
  const fireAll = async () => {
    for (const t of timers.splice(0)) t.fn();
    await flush();
  };
  const status = async () => (await r.findById("b1"))!.status;
  return { repo: r, bus, fake, finalize, timers, store, startPayout, move, fireAll, status };
}

describe("objection window (review #85, finding 1)", () => {
  it("merge → /hold during the window → the timer fires and nothing is paid", async () => {
    const s = windowSetup();
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    expect(s.timers).toHaveLength(1);
    expect(s.timers[0]!.ms).toBe(WINDOW_MS);
    await s.move(ev("maintainer.hold", { actorLogin: "fatou" }));
    await s.fireAll();
    expect(s.startPayout).not.toHaveBeenCalled();
    expect(s.finalize).not.toHaveBeenCalled();
    expect(await s.store.getByBounty("b1")).toBeUndefined();
    expect(await s.status()).toBe("on_hold");
  });

  it("the timer re-reads the bounty: a status change it never heard about still stops the payout", async () => {
    const s = windowSetup();
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    const b = (await s.repo.findById("b1"))!;
    expect(await s.repo.update({ ...b, status: "on_hold" }, "verified")).toBeTruthy(); // no event on the bus
    await s.fireAll();
    expect(s.startPayout).not.toHaveBeenCalled();
    expect(s.finalize).not.toHaveBeenCalled();
  });

  it("merge → /hold → /reject (cancelled, back to funded) during the window → nothing is paid", async () => {
    const s = windowSetup();
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await s.move(ev("maintainer.hold", { actorLogin: "fatou" }));
    await s.move(ev("maintainer.reject", { actorLogin: "fatou", reason: "not what we asked" }));
    await s.fireAll();
    expect(s.finalize).not.toHaveBeenCalled();
    expect(await s.status()).toBe("funded");
  });

  it("merge → /hold → /pay → exactly one finalize, after the new window", async () => {
    const s = windowSetup();
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await s.move(ev("maintainer.hold", { actorLogin: "fatou" }));
    await s.move(ev("maintainer.pay", { actorLogin: "fatou" }));
    expect(s.timers).toHaveLength(2);
    // The merge's timer was cancelled by /hold: firing it alone pays nothing.
    s.timers.shift()!.fn();
    await flush();
    expect(s.finalize).not.toHaveBeenCalled();
    await s.fireAll();
    expect(s.startPayout).toHaveBeenCalledTimes(1);
    expect(s.finalize).toHaveBeenCalledTimes(1);
    expect(await s.status()).toBe("paying");
  });

  it("a redelivered merge during the window → one payout, one finalize", async () => {
    const s = windowSetup();
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await s.fireAll();
    expect(s.startPayout).toHaveBeenCalledTimes(1);
    expect(s.finalize).toHaveBeenCalledTimes(1);
  });

  it("a redelivered merge with no window (demo) → one finalize", async () => {
    const s = windowSetup({ objectionMs: 0 });
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await flush();
    await s.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await s.bus.publish(ev("maintainer.pay", { actorLogin: "fatou" }));
    await flush();
    expect(s.finalize).toHaveBeenCalledTimes(1);
    expect(await s.status()).toBe("paying");
  });
});

describe("restart safety (review #85, finding 4)", () => {
  it("after a restart (fresh payout store and timers), a merge or /pay on a bounty whose payout started pays nothing", async () => {
    const before = windowSetup({ objectionMs: 0 });
    await before.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await flush();
    expect(before.finalize).toHaveBeenCalledTimes(1);
    expect(await before.status()).toBe("paying");

    // Restart: same bounty table (Postgres), everything in memory is gone.
    const after = windowSetup({ repo: before.repo, objectionMs: 0 });
    await after.bus.publish(ev("pr.merged", { prNumber: 2, ciGreen: true }));
    await after.bus.publish(ev("maintainer.pay", { actorLogin: "fatou" }));
    await flush();
    expect(after.startPayout).not.toHaveBeenCalled();
    expect(after.finalize).not.toHaveBeenCalled();
  });

  it.each(["paying", "paid", "payout_failed"] as const)("/pay on a %s bounty is refused, so no second payout can start", async (status) => {
    const s = windowSetup({ status, objectionMs: 0 });
    const t = transition((await s.repo.findById("b1"))!, ev("maintainer.pay", { actorLogin: "fatou" }));
    expect(t.ok).toBe(false);
    // And even if the event reached the bus, settlement starts nothing.
    await s.bus.publish(ev("maintainer.pay", { actorLogin: "fatou" }));
    await flush();
    expect(s.startPayout).not.toHaveBeenCalled();
  });
});

describe("OBJECTION_WINDOW_MINUTES (review #85, finding 2)", () => {
  it.each([
    [undefined, 0],
    ["", 0],
    ["0", 0],
    ["1440", 86_400_000],
    [" 0.5 ", 30_000],
  ])("%j → %i ms", (value, ms) => {
    expect(readObjectionWindowMs(value === undefined ? {} : { OBJECTION_WINDOW_MINUTES: value })).toBe(ms);
  });

  it.each(["abc", "-5", "NaN", "Infinity", "1e3", "10 min", "40000"])("refuses %j", (value) => {
    expect(() => readObjectionWindowMs({ OBJECTION_WINDOW_MINUTES: value })).toThrow("OBJECTION_WINDOW_MINUTES must be");
  });

  describe("at boot", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it("the server refuses to start with a non-numeric value", async () => {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("BITNOB_CLIENT_ID", "");
      vi.stubEnv("OBJECTION_WINDOW_MINUTES", "one day");
      vi.resetModules();
      await expect(import("../src/app.js")).rejects.toThrow("OBJECTION_WINDOW_MINUTES must be");
    });
  });
});

describe("missing PAYOUT_ACCOUNTS entry (review #85, finding 3)", () => {
  it("fails the payout on the first attempt, not retryable, with the reason", async () => {
    const fake = new FakeBitnob();
    const quote = vi.spyOn(fake, "createPayoutQuote");
    const retries: unknown[] = [];
    const events: InternalEvent[] = [];
    const payouts = new PayoutService({
      rails: fake as unknown as PayoutRails,
      store: new InMemoryPayoutStore(),
      emit: (e) => void events.push(e),
      getBeneficiary: beneficiaryFromAccounts(readPayoutAccounts({})),
      callbackUrl: "https://bitbounty.test/webhooks/bitnob",
      retryDelaysMs: [0],
      schedule: (fn) => void retries.push(fn),
      log: quiet,
    });
    const row = await payouts.start({ bountyId: "b1", userId: "github:awa", amountXof: 10_000 });
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row.lastError).toContain("no payout account for @awa");
    expect(retries).toHaveLength(0);
    expect(quote).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["payout.started", "payout.failed"]);
  });
});
