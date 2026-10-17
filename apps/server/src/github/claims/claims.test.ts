import { transition, type InternalEvent } from "@bitbounty/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryBountyRepo } from "../../bounties/repo.js";
import type { StoredEvent } from "../event-store.js";
import { InMemoryEventBus } from "../pr/fakes.js";
import { FakeGithubWriter, handleIssueComment, type WiringDeps } from "../wiring/index.js";
import {
  ClaimTimers,
  DEFAULT_CLAIM_TTL_MS,
  devFundRoutes,
  FakeAssigner,
  InMemoryClaimScheduler,
  readClaimTtlMs,
  sweepIntervalMs,
} from "./index.js";

const REPO = "bitbounty-demo/sandbox";
const ISSUE = 16;
const T0 = new Date("2026-10-17T16:00:00Z");
const HOUR = 60 * 60 * 1000;
const TTL = 72 * HOUR;
const silent = { info() {}, warn() {}, error() {} };

let gh: FakeGithubWriter;
let assigner: FakeAssigner;
let repo: InMemoryBountyRepo;
let bus: InMemoryEventBus;
let scheduler: InMemoryClaimScheduler;
let timers: ClaimTimers;
let deps: WiringDeps;
let ids = 0;

function comment(body: string, login: string): StoredEvent {
  return {
    id: 1,
    source: "github",
    externalId: `d-${Math.random()}`,
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
      issue: { number: ISSUE, title: "Claim timer", state: "open" },
      comment: { id: 1, body, user: { login, type: "User" }, author_association: "NONE" },
      repository: { full_name: REPO },
      installation: { id: 555 },
    },
  };
}
const say = (body: string, login = "awa") => handleIssueComment(comment(body, login), deps);

/** Boots the claim timers the way app.ts does: scheduler reading pending claims from the repo. */
async function boot(b = new InMemoryEventBus()) {
  bus = b;
  scheduler = new InMemoryClaimScheduler({ pending: () => timers.pending(), sweepMs: sweepIntervalMs(TTL), log: silent });
  timers = new ClaimTimers({
    repo,
    bus,
    scheduler,
    github: async () => ({ writer: gh, assigner }),
    ttlMs: TTL,
    baseUrl: "https://bitbounty.test",
    log: silent,
  });
  deps = {
    repo,
    bus,
    writerFor: async () => gh,
    baseUrl: "https://bitbounty.test",
    claimTtlMs: TTL,
    claims: timers,
    newId: () => `id-${++ids}`,
    log: silent,
  };
  await timers.start();
}

async function fund() {
  const b = (await repo.findByIssue(REPO, ISSUE))!;
  const r = transition(b, { type: "funding.paid", bountyId: b.id, occurredAt: new Date().toISOString(), fundingId: "f1", rail: "lightning", amountXof: b.amountXof });
  if (!r.ok) throw new Error(r.message);
  await repo.update(r.bounty, "unfunded");
}

/** A funded bounty on #16 claimed by awa at T0. */
async function claimed() {
  await say("/bounty 5000", "maintainer-demo");
  await fund();
  const out = await say("/claim");
  expect(out.kind).toBe("applied");
  return (await repo.findByIssue(REPO, ISSUE))!;
}

const bounty = async () => (await repo.findByIssue(REPO, ISSUE))!;
const events = (type: InternalEvent["type"]) => bus.published.filter((e) => e.type === type);
const statusBody = () => gh.commentsOn(REPO, ISSUE).find((c) => c.body.includes("<!-- bitbounty:status "))!.body;
const notes = () => gh.commentsOn(REPO, ISSUE).filter((c) => c.body.includes("claim expired"));
const lastReply = () => gh.commentsOn(REPO, ISSUE).filter((c) => c.authorType === "Bot" && !c.body.includes("<!-- bitbounty:status ")).at(-1)?.body;

/** G4's pr.linked, as `handlePullRequest` writes it. */
async function linkPr(from = undefined as Awaited<ReturnType<typeof bounty>> | undefined) {
  const b = from ?? (await bounty());
  const event: InternalEvent = { type: "pr.linked", bountyId: b.id, occurredAt: new Date().toISOString(), prNumber: 42, authorLogin: "awa", headSha: "abc" };
  const r = transition(b, event);
  if (!r.ok) throw new Error(r.message);
  await repo.saveBounty(r.bounty);
  await bus.publish(event);
}

beforeEach(async () => {
  vi.useFakeTimers({ now: T0 });
  ids = 0;
  gh = new FakeGithubWriter();
  gh.permissions.set("maintainer-demo", "write");
  gh.permissions.set("awa", "read");
  gh.permissions.set("moussa", "read");
  assigner = new FakeAssigner();
  repo = new InMemoryBountyRepo();
  await boot();
});

afterEach(() => {
  timers.stop();
  vi.useRealTimers();
});

describe("claim expiry", () => {
  it("/claim assigns the claimant and shows the deadline", async () => {
    await claimed();
    expect(assigner.of(REPO, ISSUE)).toEqual(["awa"]);
    expect(statusBody()).toContain("claim held until **Tue 20 Oct, 16:00 UTC**");
    expect(scheduler.armed("id-2")).toBe(true);
  });

  it("does nothing before the deadline", async () => {
    await claimed();
    await vi.advanceTimersByTimeAsync(TTL - 1000);
    expect((await bounty()).status).toBe("claimed");
    expect(events("claim.expired")).toHaveLength(0);
  });

  it("after 72 h without a PR: claim.expired, unassigned, comment updated, note posted", async () => {
    const b = await claimed();
    await vi.advanceTimersByTimeAsync(TTL);
    expect((await bounty()).status).toBe("funded");
    expect(events("claim.expired")).toEqual([
      { type: "claim.expired", bountyId: b.id, claimId: "id-2", occurredAt: "2026-10-20T16:00:00.000Z" },
    ]);
    expect((await repo.findClaim("id-2"))?.status).toBe("expired");
    expect(await repo.activeClaimant(b.id)).toBeUndefined();
    expect(assigner.of(REPO, ISSUE)).toEqual([]);
    expect(statusBody()).not.toContain("claim held until");
    expect(gh.labelsOn(REPO, ISSUE)).toContain("bounty: open");
    expect(gh.labelsOn(REPO, ISSUE)).not.toContain("bounty: claimed");
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.body).toContain("@awa");
    // Someone else can claim now.
    expect((await say("/claim", "moussa")).kind).toBe("applied");
    expect(assigner.of(REPO, ISSUE)).toEqual(["moussa"]);
  });

  it("double expiry is idempotent (timer + sweep, or a redelivered job)", async () => {
    await claimed();
    vi.setSystemTime(new Date(T0.getTime() + TTL)); // past the deadline, timer not run yet
    const [a, b] = await Promise.all([timers.expire({ claimId: "id-2", expiresAt: "" }), timers.expire({ claimId: "id-2", expiresAt: "" })]);
    expect([a.kind, b.kind].sort()).toEqual(["expired", "skipped"]);
    await vi.advanceTimersByTimeAsync(10 * 60_000); // the real timer and the sweep fire too
    expect(await timers.expire({ claimId: "id-2", expiresAt: "" })).toEqual({ kind: "skipped", reason: "not_active" });
    expect(events("claim.expired")).toHaveLength(1);
    expect(notes()).toHaveLength(1);
    expect(assigner.calls.filter((c) => c.startsWith("unassign"))).toHaveLength(1);
  });

  it("/unclaim before the deadline cancels the timer and unassigns", async () => {
    await claimed();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect((await say("/unclaim")).kind).toBe("applied");
    expect(scheduler.armed("id-2")).toBe(false);
    expect(assigner.of(REPO, ISSUE)).toEqual([]);
    await vi.advanceTimersByTimeAsync(TTL);
    expect(events("claim.expired")).toHaveLength(0);
    expect(notes()).toHaveLength(0);
  });
});

describe("expiry vs a linked PR", () => {
  it("a PR linked just before the deadline wins: no expiry once submitted", async () => {
    await claimed();
    await vi.advanceTimersByTimeAsync(TTL - 1);
    await linkPr();
    expect(scheduler.armed("id-2")).toBe(false);
    await vi.advanceTimersByTimeAsync(TTL);
    expect((await bounty()).status).toBe("submitted");
    expect(events("claim.expired")).toHaveLength(0);
    expect(assigner.of(REPO, ISSUE)).toEqual(["awa"]);
    // Even a stray call (old job, sweep) can't expire it.
    expect(await timers.expire({ claimId: "id-2", expiresAt: "" })).toEqual({ kind: "skipped", reason: "not_claimed" });
  });

  it("photo finish: G4 read `claimed`, the timer expired, then G4 saved the PR → the claim is restored", async () => {
    await claimed();
    const staleRead = await bounty(); // G4 has read the bounty, its write is in flight
    await vi.advanceTimersByTimeAsync(TTL);
    expect((await bounty()).status).toBe("funded");
    await linkPr(staleRead);
    expect((await bounty()).status).toBe("submitted");
    expect((await repo.activeClaim(staleRead.id))?.login).toBe("awa");
    expect(assigner.of(REPO, ISSUE)).toEqual(["awa"]);
  });

  it("a PR by someone else after expiry doesn't resurrect the claim", async () => {
    await claimed();
    const staleRead = await bounty();
    await vi.advanceTimersByTimeAsync(TTL);
    const event: InternalEvent = { type: "pr.linked", bountyId: staleRead.id, occurredAt: new Date().toISOString(), prNumber: 43, authorLogin: "moussa", headSha: "def" };
    await bus.publish(event);
    expect(await repo.activeClaim(staleRead.id)).toBeUndefined();
  });
});

describe("restart", () => {
  it("the sweep re-arms timers from the repo after a restart", async () => {
    await claimed();
    timers.stop(); // process dies: every in-memory timer is gone
    await vi.advanceTimersByTimeAsync(HOUR);
    await boot(); // same repo (the DB), fresh scheduler and bus
    expect(scheduler.armed("id-2")).toBe(true);
    await vi.advanceTimersByTimeAsync(TTL - HOUR);
    expect((await bounty()).status).toBe("funded");
    expect(events("claim.expired")).toHaveLength(1);
    expect(assigner.of(REPO, ISSUE)).toEqual([]);
  });

  it("a claim that ran out while the server was down expires on boot", async () => {
    await claimed();
    timers.stop();
    await vi.advanceTimersByTimeAsync(TTL + HOUR);
    expect((await bounty()).status).toBe("claimed");
    await boot();
    expect((await bounty()).status).toBe("funded");
  });

  it("the sweep catches a timer that never fired", async () => {
    await claimed();
    scheduler.cancel("id-2"); // lost timer (crash in a handler, clock jump…)
    await vi.advanceTimersByTimeAsync(TTL + sweepIntervalMs(TTL));
    expect((await bounty()).status).toBe("funded");
  });
});

describe("/extend", () => {
  it("adds one TTL once; the second is refused with the reason", async () => {
    await claimed();
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect((await say("/extend")).kind).toBe("replied");
    expect(lastReply()).toContain("Claim extended until Fri 23 Oct, 16:00 UTC (1/1)");
    expect((await repo.findClaim("id-2"))?.expiresAt).toBe("2026-10-23T16:00:00.000Z");
    expect(statusBody()).toContain("claim held until **Fri 23 Oct, 16:00 UTC**");

    await say("/extend");
    expect(lastReply()).toContain("already extended once, the limit");
    expect((await repo.findClaim("id-2"))?.expiresAt).toBe("2026-10-23T16:00:00.000Z");

    // The old deadline passes: still claimed. The new one: expired.
    await vi.advanceTimersByTimeAsync(TTL - 10 * HOUR);
    expect((await bounty()).status).toBe("claimed");
    await vi.advanceTimersByTimeAsync(TTL);
    expect((await bounty()).status).toBe("funded");
    expect(events("claim.expired")).toHaveLength(1);
  });

  it("only the claimant or a maintainer", async () => {
    await claimed();
    await say("/extend", "moussa");
    expect(lastReply()).toContain("Only @awa (who claimed it) or a maintainer can extend");
    await say("/extend", "maintainer-demo");
    expect(lastReply()).toContain("(1/1)");
  });

  it("refused without a claim, or once a PR is in", async () => {
    await say("/bounty 5000", "maintainer-demo");
    await fund();
    await say("/extend");
    expect(lastReply()).toContain("Nobody has claimed this bounty");
    await say("/claim");
    await linkPr();
    await say("/extend");
    expect(lastReply()).toContain("A PR is already linked");
  });

  it("an extension survives a restart", async () => {
    await claimed();
    await say("/extend");
    timers.stop();
    await boot();
    await vi.advanceTimersByTimeAsync(TTL + HOUR);
    expect((await bounty()).status).toBe("claimed");
    await vi.advanceTimersByTimeAsync(TTL);
    expect((await bounty()).status).toBe("funded");
  });
});

describe("config", () => {
  it("CLAIM_TTL_MINUTES, 72 h by default", () => {
    expect(readClaimTtlMs({})).toBe(DEFAULT_CLAIM_TTL_MS);
    expect(DEFAULT_CLAIM_TTL_MS).toBe(TTL);
    expect(readClaimTtlMs({ CLAIM_TTL_MINUTES: "5" })).toBe(5 * 60_000);
    expect(readClaimTtlMs({ CLAIM_TTL_MINUTES: "0" })).toBe(TTL);
    expect(readClaimTtlMs({ CLAIM_TTL_MINUTES: "-3" })).toBe(TTL);
    expect(readClaimTtlMs({ CLAIM_TTL_MINUTES: "soon" })).toBe(TTL);
    expect(sweepIntervalMs(5 * 60_000)).toBe(50_000);
    expect(sweepIntervalMs(TTL)).toBe(60_000);
  });

  it("a 1-minute demo claim expires after 1 minute", async () => {
    timers.stop();
    scheduler = new InMemoryClaimScheduler({ pending: () => timers.pending(), sweepMs: sweepIntervalMs(60_000), log: silent });
    timers = new ClaimTimers({ repo, bus, scheduler, github: async () => ({ writer: gh, assigner }), ttlMs: 60_000, baseUrl: "https://bitbounty.test", log: silent });
    deps = { ...deps, claimTtlMs: 60_000, claims: timers };
    await timers.start();
    await claimed();
    await vi.advanceTimersByTimeAsync(59_000);
    expect((await bounty()).status).toBe("claimed");
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await bounty()).status).toBe("funded");
  });
});

describe("dev fund hook", () => {
  it("needs the token, then drives funding.paid", async () => {
    await say("/bounty 5000", "maintainer-demo");
    const routes = devFundRoutes({ token: "t0k", repo, bus, github: async () => ({ writer: gh, assigner }), baseUrl: "https://bitbounty.test" });
    const post = (auth: string) =>
      routes.request("/dev/fund", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ repo: REPO, issue: ISSUE }) });
    expect((await post("Bearer nope")).status).toBe(401);
    expect((await post("Bearer t0k")).status).toBe(200);
    expect((await bounty()).status).toBe("funded");
    expect(events("funding.paid")).toHaveLength(1);
    expect((await post("Bearer t0k")).status).toBe(409);
  });
});
