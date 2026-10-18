import { readFileSync } from "node:fs";
import { createBounty, transition, type Bounty, type InternalEvent, type Payout } from "@bitbounty/core";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryBountyRepo } from "../bounties/repo.js";
import { InMemoryEventBus } from "../github/pr/fakes.js";
import type { StoredEvent } from "../github/event-store.js";
import { FakeGithubWriter, handleIssueComment, type WiringDeps } from "../github/wiring/index.js";
import { InMemoryPayoutStore } from "../payouts/store.js";
import type { PayoutRequest } from "../payouts/service.js";
import { Settlement } from "../settlement/index.js";
import { maintainRoutes, type MaintainDeps, type MaintainHome } from "./maintain.js";

const TOKEN = "internal-secret-token";
const REPO = "teranga-labs/bitnob-js";
const at = (m: number) => new Date(Date.UTC(2026, 9, 17, 20, m)).toISOString();

let repo: InMemoryBountyRepo;
let bus: InMemoryEventBus;
let gh: FakeGithubWriter;
let payouts: InMemoryPayoutStore;
let started: PayoutRequest[];
let wiring: WiringDeps;
let routes: ReturnType<typeof maintainRoutes>;

function build(over: Partial<MaintainDeps> = {}) {
  routes = maintainRoutes({
    repo,
    payouts,
    internalToken: TOKEN,
    decide: { wiring, writerForRepo: async () => gh },
    now: () => new Date("2026-10-18T10:00:00Z"),
    ...over,
  });
}

beforeEach(() => {
  repo = new InMemoryBountyRepo();
  bus = new InMemoryEventBus();
  gh = new FakeGithubWriter();
  gh.permissions.set("djbrl", "admin");
  gh.permissions.set("awa", "read");
  payouts = new InMemoryPayoutStore();
  started = [];
  // The real settlement: the only thing that starts payouts, from the bus events.
  new Settlement({ repo, bus, startPayout: async (req) => void started.push(req), objectionMs: 0, schedule: (fn) => fn(), log: { info() {}, warn() {}, error() {} } }).register();
  wiring = { repo, bus, writerFor: async () => gh, baseUrl: "https://bitbounty.test", now: () => new Date(at(30)), log: { info() {}, warn() {}, error() {} } };
  build();
});

const auth = (user: string) => ({ authorization: `Bearer ${TOKEN}`, "x-bitbounty-user": user });
const get = (user?: string) => routes.request("/api/maintain", { headers: user ? auth(user) : {} });
const post = (id: string, action: "pay" | "hold", user?: string, body: unknown = {}) =>
  routes.request(`/api/maintain/bounties/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? auth(user) : {}) },
    body: JSON.stringify(body),
  });

/** A bounty funded by @djbrl, claimed by @awa, PR #34 in with Claude's report: `submitted`. */
async function submitted(n: number): Promise<Bounty> {
  const { bounty } = createBounty({
    id: `b-${n}`,
    repoFullName: REPO,
    issueNumber: n,
    issueTitle: `Issue ${n}`,
    amountXof: 10_000,
    criteria: [{ text: "it works" }, { text: "has a test" }],
    funderKind: "human",
    funderId: "github:djbrl",
    createdAt: at(0),
  });
  await repo.create(bounty);
  const steps: InternalEvent[] = [
    { type: "funding.paid", bountyId: bounty.id, occurredAt: at(1), fundingId: `f-${n}`, rail: "lightning", amountXof: 10_000 },
    { type: "claim.created", bountyId: bounty.id, occurredAt: at(2), claimId: `c-${n}`, userId: "github:awa" },
    { type: "pr.linked", bountyId: bounty.id, occurredAt: at(3), prNumber: 34, authorLogin: "awa", headSha: "abc" },
  ];
  let current = bounty;
  for (const e of steps) {
    const r = transition(current, e);
    if (!r.ok) throw new Error(r.message);
    current = (await repo.update(r.bounty, current.status))!;
  }
  await repo.createClaim({ id: `c-${n}`, bountyId: bounty.id, userId: "github:awa", login: "awa", status: "active", expiresAt: at(600) });
  await repo.saveSubmission({
    id: `s-${n}`,
    bountyId: bounty.id,
    prNumber: 34,
    authorLogin: "awa",
    headSha: "abc",
    verdict: "pass",
    report: { verdict: "pass", summary: "Both criteria met.", riskFlags: [], criteria: [{ text: "it works", met: true, evidence: "test passes" }, { text: "has a test", met: false, evidence: "" }] },
    spamScore: 0,
    mergedAt: null,
  });
  return current;
}

function commentEvent(issueNumber: number, body: string, login: string): StoredEvent {
  return {
    id: 1,
    source: "github",
    externalId: `d-${issueNumber}`,
    type: "issue_comment",
    action: "created",
    repo: REPO,
    installationId: 555,
    status: "received",
    processedAt: null,
    error: null,
    receivedAt: new Date(),
    payload: {
      action: "created",
      issue: { number: issueNumber, title: "x", state: "open" },
      comment: { id: 1, body, user: { login, type: "User" }, author_association: "NONE" },
      repository: { full_name: REPO },
      installation: { id: 555 },
    },
  };
}

describe("GET /api/maintain", () => {
  it("needs a session when a token is configured", async () => {
    expect((await get()).status).toBe(401);
  });

  it("returns the review queue with Claude's per-criterion verdict, and payouts without raw errors", async () => {
    await submitted(1);
    const failed = await submitted(2);
    // Walk #2 to payout_failed with a raw error on the row.
    let cur = failed;
    for (const e of [
      { type: "maintainer.pay", bountyId: cur.id, occurredAt: at(5), actorLogin: "djbrl" },
      { type: "payout.started", bountyId: cur.id, occurredAt: at(6), payoutId: "p2", attempt: 1 },
      { type: "payout.failed", bountyId: cur.id, occurredAt: at(7), payoutId: "p2", error: "x", willRetry: false },
    ] as InternalEvent[]) {
      const r = transition(cur, e);
      if (!r.ok) throw new Error(r.message);
      cur = (await repo.update(r.bounty, cur.status))!;
    }
    const row: Payout = {
      id: "p2", bountyId: cur.id, userId: "github:awa", amountXof: 10_000, quoteId: null, bitnobPayoutId: null, reference: "pay-b-2",
      status: "failed", attempts: 3, lastError: "lnurl unreachable: getaddrinfo ENOTFOUND blink.internal SECRET_HOST", paidAt: null,
    };
    await payouts.create(row);

    const res = await get("djbrl");
    expect(res.status).toBe(200);
    const body = (await res.json()) as MaintainHome;
    expect(body.queue).toHaveLength(1);
    expect(body.queue[0]).toMatchObject({
      bountyId: "b-1",
      developer: "awa",
      prNumber: 34,
      ci: "pending",
      canPay: true,
      canHold: true,
      criteria: [{ text: "it works", met: true }, { text: "has a test", met: false }],
    });
    expect(body.payouts).toEqual([expect.objectContaining({ bountyId: "b-2", status: "failed", reason: "wallet_unreachable", receiptId: null })]);
    expect(JSON.stringify(body)).not.toContain("SECRET_HOST");
    expect(body.summary.atStakeXof).toBe(20_000);
    expect(body.repos).toEqual([{ fullName: REPO, openBounties: 2, paidCount: 0 }]);
  });

  it("shows another maintainer nothing of @djbrl's", async () => {
    await submitted(1);
    const body = (await (await get("someone")).json()) as MaintainHome;
    expect(body.queue).toEqual([]);
    expect(body.repos).toEqual([]);
  });
});

describe("POST /api/maintain/bounties/:id/pay|hold", () => {
  it("Pay runs the /pay path: maintainer.pay on the bus, settlement starts exactly one payout", async () => {
    await submitted(1);
    const res = await post("b-1", "pay", "djbrl");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bountyId: "b-1", status: "verified" });
    expect(bus.published.map((e) => e.type)).toEqual(["maintainer.pay"]);
    expect(bus.published[0]).toMatchObject({ actorLogin: "djbrl" });
    expect(started).toEqual([{ bountyId: "b-1", userId: "github:awa", amountXof: 10_000 }]);
    expect(gh.calls).toContain(`getPermission ${REPO} djbrl`);

    // A second click (or `/pay` on GitHub afterwards) can't start a second payout.
    const again = await post("b-1", "pay", "djbrl");
    expect(again.status).toBe(409);
    expect(started).toHaveLength(1);
  });

  it("does exactly what `/pay` in a comment does (same events, same status, same payout request)", async () => {
    await submitted(1);
    await submitted(2);
    await post("b-1", "pay", "djbrl");
    const viaWeb = bus.published.splice(0);
    const startedWeb = started.splice(0);
    await handleIssueComment(commentEvent(2, "/pay", "djbrl"), wiring);
    const viaComment = bus.published.splice(0);
    const strip = (e: InternalEvent) => ({ ...e, bountyId: "-" });
    expect(viaWeb.map(strip)).toEqual(viaComment.map(strip));
    expect((await repo.findById("b-1"))!.status).toBe((await repo.findById("b-2"))!.status);
    expect(startedWeb.map((r) => r.amountXof)).toEqual(started.map((r) => r.amountXof));
  });

  it("only a maintainer of the repo (write access, checked on GitHub) can Pay", async () => {
    await submitted(1);
    const res = await post("b-1", "pay", "awa");
    expect(res.status).toBe(403);
    expect((await repo.findById("b-1"))!.status).toBe("submitted");
    expect(bus.published).toEqual([]);
    expect(started).toEqual([]);
    // Unknown on GitHub (no permission at all) is refused too.
    expect((await post("b-1", "pay", "stranger")).status).toBe(403);
  });

  it("needs a verified session, even with the read side open", async () => {
    await submitted(1);
    build({ internalToken: undefined });
    expect((await post("b-1", "pay", "djbrl")).status).toBe(401);
    build();
    expect((await post("b-1", "pay")).status).toBe(401);
    expect(started).toEqual([]);
  });

  it("answers 503 without the GitHub App and 404 for an unknown bounty", async () => {
    await submitted(1);
    build({ decide: undefined });
    expect((await post("b-1", "pay", "djbrl")).status).toBe(503);
    build();
    expect((await post("nope", "pay", "djbrl")).status).toBe(404);
  });

  it("Hold freezes the bounty with the note, and nothing is paid", async () => {
    await submitted(1);
    const res = await post("b-1", "hold", "djbrl", { note: "PR was reverted" });
    expect(await res.json()).toEqual({ bountyId: "b-1", status: "on_hold" });
    expect(bus.published[0]).toMatchObject({ type: "maintainer.hold", actorLogin: "djbrl", reason: "PR was reverted" });
    expect(started).toEqual([]);
    // Web decisions don't add reply comments on the issue.
    expect(gh.commentsOn(REPO, 1).filter((c) => !c.body.includes("<!-- bitbounty:status "))).toEqual([]);
  });

  it("the route has no payout path of its own: no transition, persist, publish or payout call", () => {
    const src = readFileSync(new URL("./maintain.ts", import.meta.url), "utf8");
    for (const forbidden of ["transition(", ".publish(", ".update(", "startPayout", "PayoutService", "Settlement"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
    expect(src).toContain("runMaintainerDecision(");
  });
});
