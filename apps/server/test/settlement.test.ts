import { createBounty, type Bounty, type InternalEvent } from "@bitbounty/core";
import { describe, expect, it, vi } from "vitest";
import { InMemoryBountyRepo } from "../src/bounties/repo.js";
import { InMemoryEventBus } from "../src/github/pr/index.js";
import { beneficiaryFromAccounts, readPayoutAccounts, Settlement } from "../src/settlement/index.js";

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
