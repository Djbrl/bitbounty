import { createBounty, transition, type Bounty, type InternalEvent } from "@bitbounty/core";
import { describe, expect, it } from "vitest";
import { InMemoryBountyRepo } from "../bounties/repo.js";
import { FundingError } from "../funding/lightning.js";
import { InMemoryNgnAccountStore } from "../funding/ngn.js";
import { InMemoryFundingStore, type FundingRecord } from "../funding/store.js";
import { InMemoryEventBus } from "../github/pr/fakes.js";
import { InMemoryPayoutStore } from "../payouts/store.js";
import { ActivityLog } from "./activity.js";
import { readApiRoutes, type ReadApiDeps } from "./routes.js";

const TOKEN = "internal-secret-token";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function setup(over: Partial<ReadApiDeps> = {}) {
  const repo = new InMemoryBountyRepo();
  const bus = new InMemoryEventBus();
  const activity = new ActivityLog(repo).attach(bus);
  const fundings = new InMemoryFundingStore();
  const payouts = new InMemoryPayoutStore();
  const routes = readApiRoutes({ repo, activity, fundings, payouts, internalToken: TOKEN, keepAliveMs: 50, ...over });
  const get = (path: string, user?: string) =>
    routes.request(path, { headers: user ? { authorization: `Bearer ${TOKEN}`, "x-bitbounty-user": user } : {} });

  /** Creates a bounty and walks it through `events` with transition(), publishing each one like the real modules. */
  async function story(n: number, login: string, steps: ((b: Bounty) => InternalEvent)[] = []) {
    const { bounty, event } = createBounty({
      id: uuid(n),
      repoFullName: "teranga-labs/bitnob-js",
      issueNumber: n,
      issueTitle: `Issue ${n}`,
      amountXof: 10_000,
      criteria: [{ text: "it works" }],
      funderKind: "human",
      funderId: `github:${login}`,
      createdAt: `2026-10-17T1${n % 10}:00:00.000Z`,
    });
    await repo.create(bounty);
    await bus.publish(event);
    let current = bounty;
    for (const step of steps) {
      const res = transition(current, step(current));
      if (!res.ok) throw new Error(res.message);
      await repo.update(res.bounty, current.status);
      current = res.bounty;
      await bus.publish(res.event);
    }
    return current;
  }
  return { repo, bus, activity, fundings, payouts, routes, get, story };
}

const at = (m: number) => new Date(Date.UTC(2026, 9, 17, 20, m)).toISOString();
const fund = (b: Bounty): InternalEvent => ({ type: "funding.paid", bountyId: b.id, occurredAt: at(1), fundingId: "f1", rail: "lightning", amountXof: b.amountXof });
const claim = (login: string) => (b: Bounty): InternalEvent => ({ type: "claim.created", bountyId: b.id, occurredAt: at(2), claimId: `c-${b.id}`, userId: `github:${login}` });
const pr = (b: Bounty): InternalEvent => ({ type: "pr.linked", bountyId: b.id, occurredAt: at(3), prNumber: 34, authorLogin: "awa", headSha: "abc" });
const verify = (b: Bounty): InternalEvent => ({ type: "verify.done", bountyId: b.id, occurredAt: at(4), prNumber: 34, headSha: "abc", verdict: "pass" });
const merge = (b: Bounty): InternalEvent => ({ type: "pr.merged", bountyId: b.id, occurredAt: at(5), prNumber: 34, ciGreen: true });
const payStart = (b: Bounty): InternalEvent => ({ type: "payout.started", bountyId: b.id, occurredAt: at(6), payoutId: "p1", attempt: 1 });
const paySuccess = (b: Bounty): InternalEvent => ({ type: "payout.succeeded", bountyId: b.id, occurredAt: at(11), payoutId: "p1", bitnobPayoutId: "PAYOUT_1" });

describe("GET /api/bounties and /api/bounties/:id", () => {
  it("lists real bounties as summaries, filters by status, 404 on unknown ids", async () => {
    const { get, story, repo } = await setup();
    await story(1, "fatou");
    const b2 = await story(2, "fatou", [fund, claim("awa")]);
    await repo.createClaim({ id: `c-${b2.id}`, bountyId: b2.id, userId: "github:awa", login: "awa", status: "active", expiresAt: at(90) });
    const all = (await (await get("/api/bounties")).json()) as { id: string; claimedBy: string | null; issueUrl: string; funderLogin: string }[];
    expect(all.map((b) => b.id)).toEqual([uuid(2), uuid(1)]);
    expect(all[0]).toMatchObject({ claimedBy: "awa", funderLogin: "fatou", issueUrl: "https://github.com/teranga-labs/bitnob-js/issues/2" });
    const claimed = (await (await get("/api/bounties?status=claimed")).json()) as unknown[];
    expect(claimed).toHaveLength(1);
    expect((await get(`/api/bounties/${uuid(99)}`)).status).toBe(404);
  });

  it("returns the detail with fundings, the active claim and a timeline built from the events", async () => {
    const { get, story, fundings, repo } = await setup();
    const b = await story(3, "fatou", [fund, claim("awa")]);
    await repo.createClaim({ id: `c-${b.id}`, bountyId: b.id, userId: "github:awa", login: "awa", status: "active", expiresAt: at(90) });
    await fundings.create({
      id: "f1", bountyId: b.id, rail: "lightning", sourceAmount: 2218, sourceCurrency: "BTC", bitnobRef: "fund-x-1", paymentHash: "h",
      status: "paid", paidAt: at(1), funderId: "github:fatou", amountXof: 10_000, feeXof: 500, bufferXof: 300, paymentRequest: "lntb1", expiresAt: at(15), createdAt: at(0),
    } as FundingRecord);
    const d = (await (await get(`/api/bounties/${b.id}`)).json()) as Record<string, any>;
    expect(d.status).toBe("claimed");
    expect(d.fundings[0]).toMatchObject({ rail: "lightning", feeXof: 500, bufferXof: 300 });
    expect(d.fundings[0]).not.toHaveProperty("paymentRequest");
    expect(d.claims[0]).toMatchObject({ userLogin: "awa", status: "active", extended: false });
    expect(d.timeline.map((e: { type: string; to: string }) => `${e.type}→${e.to}`)).toEqual([
      "bounty.created→unfunded",
      "funding.paid→funded",
      "claim.created→claimed",
    ]);
    expect(d.timeline[1]).toMatchObject({ actor: "bitnob", text: "Funded over Lightning" });
  });
});

describe("GET /api/board", () => {
  it("shows public bounties only and paid stats", async () => {
    const { get, story, payouts, repo } = await setup();
    await story(1, "fatou"); // unfunded: hidden
    const paid = await story(2, "fatou", [fund, claim("awa"), pr, verify, merge, payStart, paySuccess]);
    await repo.saveSubmission({ id: "s1", bountyId: paid.id, prNumber: 34, authorLogin: "awa", headSha: "abc", verdict: "pass", report: null, spamScore: null, mergedAt: at(5) });
    await payouts.create({ id: "p1", bountyId: paid.id, userId: "github:awa", amountXof: 10_000, quoteId: "q", bitnobPayoutId: "PAYOUT_1", reference: `pay-${paid.id}`, status: "succeeded", attempts: 1, lastError: null, paidAt: at(11) });
    const board = (await (await get("/api/board")).json()) as { stats: Record<string, number>; bounties: { id: string }[]; external: unknown[] };
    expect(board.bounties.map((b) => b.id)).toEqual([paid.id]);
    expect(board.stats).toEqual({ paidCount: 1, paidTotalXof: 10_000, medianMinutesMergeToPay: 6, developersPaid: 1 });
    expect(board.external).toEqual([]);
  });
});

describe("GET /api/dashboard", () => {
  it("signed in: only the maintainer's bounties, with actions; auth off: everything", async () => {
    const { get, story } = await setup();
    await story(1, "fatou");
    await story(2, "someone-else", [fund]);
    const mine = (await (await get("/api/dashboard", "Fatou")).json()) as Record<string, any>;
    expect(mine.maintainer).toBe("Fatou");
    expect(mine.bountyIds).toEqual([uuid(1)]);
    expect(mine.needsAction).toEqual([{ bountyId: uuid(1), action: "fund", text: "#1 is waiting for funding (10 000 FCFA)" }]);
    expect(mine.backlog).toEqual([]);
    expect(mine.bounties).toHaveLength(1);
    const open = await setup({ internalToken: undefined });
    await open.story(1, "fatou");
    await open.story(2, "someone-else", [fund]);
    const all = (await (await open.get("/api/dashboard")).json()) as Record<string, any>;
    expect(all.bountyIds).toHaveLength(2);
    expect(all.stats).toMatchObject({ heldXof: 10_000, activeCount: 1 });
  });

  it("with a token configured, refuses the dashboard without a valid session (forged user header too)", async () => {
    const { routes, story } = await setup();
    await story(1, "fatou");
    const forged = await routes.request("/api/dashboard", { headers: { authorization: "Bearer wrong-token-of-same-len", "x-bitbounty-user": "fatou" } });
    expect(forged.status).toBe(401);
    expect((await routes.request("/api/dashboard")).status).toBe(401);
  });
});

describe("GET /api/me, /api/users/:login, /api/receipts/:id", () => {
  it("/api/me needs the web session (internal token + user)", async () => {
    const { get, routes } = await setup();
    expect((await routes.request("/api/me")).status).toBe(401);
    const me = (await (await get("/api/me", "awa")).json()) as Record<string, any>;
    expect(me).toMatchObject({ user: { login: "awa" }, payoutAccount: null, earnings: { totalXof: 0, paidCount: 0 }, activeClaims: [], payouts: [] });
  });

  it("profile and receipt come from real payouts; unknown users and receipts are 404", async () => {
    const { get, story, payouts, repo, fundings } = await setup();
    const paid = await story(2, "fatou", [fund, claim("awa"), pr, verify, merge, payStart, paySuccess]);
    await repo.saveSubmission({ id: "s1", bountyId: paid.id, prNumber: 34, authorLogin: "awa", headSha: "abc", verdict: "pass", report: null, spamScore: null, mergedAt: at(5) });
    await payouts.create({ id: "p1", bountyId: paid.id, userId: "github:awa", amountXof: 10_000, quoteId: "q", bitnobPayoutId: "PAYOUT_1", reference: `pay-${paid.id}`, status: "succeeded", attempts: 1, lastError: null, paidAt: at(11) });
    await fundings.create({
      id: "f1", bountyId: paid.id, rail: "ngn", sourceAmount: 1_350_000, sourceCurrency: "NGN", bitnobRef: "r", paymentHash: null,
      status: "paid", paidAt: at(1), funderId: "github:fatou", amountXof: 10_000, feeXof: 500, bufferXof: 300, paymentRequest: null, expiresAt: null, createdAt: at(0),
    } as FundingRecord);

    const profile = (await (await get("/api/users/awa")).json()) as Record<string, any>;
    expect(profile.stats).toMatchObject({ paidCount: 1, totalXof: 10_000, repos: 1, medianMinutesMergeToPay: 6 });
    expect(profile.work[0]).toMatchObject({ bountyId: paid.id, prNumber: 34, receiptId: "p1" });
    expect((await get("/api/users/nobody")).status).toBe(404);
    expect((await get("/api/users/..%2Fetc")).status).toBe(404);

    const receipt = (await (await get("/api/receipts/p1")).json()) as Record<string, any>;
    expect(receipt).toMatchObject({ recipientLogin: "awa", minutesMergeToPay: 6, bitnobReference: "PAYOUT_1", fundedWith: { rail: "ngn", sourceCurrency: "NGN", funderLogin: "fatou" } });
    expect(receipt.signature).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await get("/api/receipts/nope")).status).toBe(404);

    const me = (await (await get("/api/me", "awa")).json()) as Record<string, any>;
    expect(me.earnings).toEqual({ totalXof: 10_000, paidCount: 1 });
    expect(me.payouts[0]).toMatchObject({ receiptId: "p1", status: "succeeded" });
  });
});

describe("funding", () => {
  const post = (routes: Awaited<ReturnType<typeof setup>>["routes"], id: string, rail: unknown) =>
    routes.request(`/api/bounties/${id}/funding`, { method: "POST", body: JSON.stringify({ rail }) });

  it("creates a Lightning invoice for an unfunded bounty and watches it", async () => {
    const watched: string[] = [];
    const lightning = {
      invoice: async () => ({
        id: "f9", bountyId: uuid(1), rail: "lightning", sourceAmount: 2218, sourceCurrency: "BTC", bitnobRef: "r", paymentHash: "hash", status: "pending", paidAt: null,
        funderId: "github:fatou", amountXof: 10_000, feeXof: 500, bufferXof: 300, paymentRequest: "lntb22180n1", expiresAt: at(30), createdAt: at(0),
      }) as FundingRecord,
      watch: (id: string) => void watched.push(id),
    };
    const { routes, story, get } = await setup({ lightning });
    await story(1, "fatou");
    const res = await post(routes, uuid(1), "lightning");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rail: "lightning", amountXof: 10_000, feeXof: 500, bufferXof: 300, totalXof: 10_800, invoice: "lntb22180n1", paymentHash: "hash", amountSats: 2218, expiresAt: at(30) });
    expect(watched).toEqual(["f9"]);
    expect(await (await get(`/api/bounties/${uuid(1)}/funding`)).json()).toEqual({ status: "pending", bountyStatus: "unfunded" });
  });

  it("answers clear errors: bad rail, unknown bounty, already funded, rail not wired, Bitnob not configured, Bitnob refusal", async () => {
    const { routes, story } = await setup({ lightning: null });
    await story(1, "fatou");
    await story(2, "fatou", [fund]);
    expect((await post(routes, uuid(1), "paypal")).status).toBe(400);
    const nullBody = await routes.request(`/api/bounties/${uuid(1)}/funding`, { method: "POST", body: "null" });
    expect(nullBody.status).toBe(400);
    expect((await post(routes, uuid(9), "lightning")).status).toBe(404);
    expect((await post(routes, uuid(2), "lightning")).status).toBe(409);
    expect((await post(routes, uuid(1), "usdt")).status).toBe(501);
    expect((await post(routes, uuid(1), "lightning")).status).toBe(503);
    const failing = await setup({
      lightning: { invoice: async () => Promise.reject(new FundingError("NOT_FUNDABLE", "cancelled")), watch: () => undefined },
    });
    await failing.story(1, "fatou");
    const res = await post(failing.routes, uuid(1), "lightning");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_fundable" });
  });
});

describe("GET /api/live (SSE)", () => {
  it("sends a snapshot of the live columns, then each transition as it happens", async () => {
    const { routes, story, bus, repo } = await setup();
    const funded = await story(1, "fatou", [fund]);
    const res = await routes.request("/api/live");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const readUntil = async (re: RegExp) => {
      while (!re.test(text)) text += dec.decode((await reader.read()).value);
    };
    await readUntil(/event: snapshot\ndata: .*\n\n/);
    expect(text).toContain(`"bountyId":"${funded.id}"`);
    expect(text).toContain(`"columns":["funded","claimed","submitted","verified","paying","paid"]`);

    // G3 saves the claim, then publishes: the stream forwards it with the new status.
    const moved = transition(funded, claim("awa")(funded));
    if (!moved.ok) throw new Error(moved.message);
    await repo.update(moved.bounty, "funded");
    await bus.publish(moved.event);
    await readUntil(/event: transition\ndata: .*\n\n/);
    expect(text).toMatch(/"event":"claim.created","from":"funded","to":"claimed","text":"Claimed by @awa"/);
    expect(text).toContain('"route":null}'); // Lightning-funded: no Lagos route
    expect(text.split("event: transition")[1]).not.toContain('"route"');
    await reader.cancel();
  });

  /** A 10 000 FCFA bounty funded with ₦27 000 from Lagos (B4), its naira sold for 18 000 sats. */
  async function lagos(n: number) {
    const ngnAccounts = new InMemoryNgnAccountStore();
    const ctx = await setup({ ngnAccounts });
    const b = await ctx.story(n, "chidi", [(x) => ({ ...fund(x), rail: "ngn", fundingId: `f-${n}` })]);
    await ctx.fundings.create({
      id: `f-${n}`, bountyId: b.id, funderId: "lagos", rail: "ngn", sourceAmount: 2_700_000, sourceCurrency: "NGN", bitnobRef: "va-1",
      paymentHash: null, paymentRequest: null, status: "paid", paidAt: at(1), amountXof: 10_000, feeXof: 500, bufferXof: 300, expiresAt: null, createdAt: at(0),
    });
    await ngnAccounts.create({
      fundingId: `f-${n}`, bountyId: b.id, virtualAccountId: "va-1", accountNumber: "9000000001", accountName: "Ada", bankName: "Sandbox",
      requiredNaira: 27_000, receivedKobo: 2_700_000, depositRefs: ["d1"], state: "converted", claimedKobo: 2_700_000, orderAttempt: 1,
      orderReference: `ngn-f-${n}-1`, quoteId: "q1", orderId: "o1", btcReceived: "0.00018", lastError: null,
    });
    return { ...ctx, b };
  }
  const read = async (res: Response) => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    return {
      reader,
      until: async (re: RegExp) => {
        while (!re.test(text)) text += dec.decode((await reader.read()).value);
        return text;
      },
    };
  };

  it("I4: the snapshot carries the Lagos route of the newest naira-funded bounty (also as JSON for the first paint)", async () => {
    const { routes, story, b } = await lagos(1);
    await story(2, "fatou", [fund]); // newer, but funded over Lightning: no route
    const want = { bountyId: b.id, ngn: 27_000, satsBought: 18_000, xof: 10_000, feeXof: 500, bufferXof: 300, sats: null, xofPerBtc: null };

    const json = (await (await routes.request("/api/live?format=json")).json()) as { cards: { bountyId: string }[]; route: unknown };
    expect(json.cards.map((c) => c.bountyId)).toEqual([uuid(2), uuid(1)]);
    expect(json.route).toEqual(want);

    const sse = await read(await routes.request("/api/live"));
    const text = await sse.until(/event: snapshot\ndata: .*\n\n/);
    expect(JSON.parse(text.match(/data: (.*)\n/)![1]!).route).toEqual(want);
    await sse.reader.cancel();
  });

  it("I4: a naira-funded bounty's transitions carry its route, the payout leg once paid", async () => {
    const { routes, repo, bus, payouts, b } = await lagos(1);
    const sse = await read(await routes.request("/api/live"));
    await sse.until(/event: snapshot\n/);
    let current = b;
    const step = async (ev: (x: Bounty) => InternalEvent) => {
      const res = transition(current, ev(current));
      if (!res.ok) throw new Error(res.message);
      await repo.update(res.bounty, current.status);
      current = res.bounty;
      await bus.publish(res.event);
    };
    await step(claim("awa"));
    await sse.until(/"event":"claim.created".*\n\n/); // sent before any payout exists
    for (const ev of [pr, verify, merge, payStart]) await step(ev);
    await payouts.create({
      id: "p1", bountyId: b.id, userId: "github:awa", amountXof: 10_000, quoteId: null, bitnobPayoutId: null, reference: `pay-${b.id}`,
      status: "succeeded", attempts: 1, lastError: null, paidAt: at(11), rail: "lightning", amountSats: 16_666, xofPerBtc: 60_000_000,
    });
    await step(paySuccess);
    const text = await sse.until(/"event":"payout.succeeded".*\n\n/);
    const transitions = [...text.matchAll(/event: transition\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]!) as { event: string; route?: { sats: number | null } });
    expect(transitions.every((t) => t.route)).toBe(true);
    expect(transitions[0]!.route!.sats).toBeNull();
    expect(transitions.at(-1)).toMatchObject({
      event: "payout.succeeded",
      to: "paid",
      route: { bountyId: b.id, ngn: 27_000, satsBought: 18_000, xof: 10_000, sats: 16_666, xofPerBtc: 60_000_000 },
    });
    await sse.reader.cancel();
  });
});
