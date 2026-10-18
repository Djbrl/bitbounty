import { transition } from "@bitbounty/core";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryBountyRepo } from "../../bounties/repo.js";
import { InMemoryEventBus } from "../pr/fakes.js";
import { GithubDispatcher } from "../dispatcher.js";
import type { StoredEvent } from "../event-store.js";
import { isStatusComment, statusMarker } from "../status-comment/index.js";
import { Settlement } from "../../settlement/index.js";
import type { PayoutRequest } from "../../payouts/service.js";
import { FakeGithubWriter, handleIssueComment, registerCommentWiring, type WiringDeps } from "./index.js";

const REPO = "bitbounty-demo/sandbox";

let gh: FakeGithubWriter;
let repo: InMemoryBountyRepo;
let bus: InMemoryEventBus;
let deps: WiringDeps;
let ids: number;
let issueNumber = 100;

function commentEvent(body: string, opts: { login?: string; type?: string; association?: string; state?: string; pr?: boolean } = {}): StoredEvent {
  const login = opts.login ?? "maintainer-demo";
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
      issue: {
        number: issueNumber,
        title: "Translate the README into Wolof",
        state: opts.state ?? "open",
        ...(opts.pr ? { pull_request: { url: "x" } } : {}),
      },
      comment: { id: 1, body, user: { login, type: opts.type ?? "User" }, author_association: opts.association ?? "NONE" },
      repository: { full_name: REPO },
      installation: { id: 555 },
    },
  };
}

const run = (body: string, opts?: Parameters<typeof commentEvent>[1]) => handleIssueComment(commentEvent(body, opts), deps);
const botComments = () => gh.commentsOn(REPO, issueNumber).filter((c) => c.authorType === "Bot");
const statusComments = () => botComments().filter((c) => c.body.includes("<!-- bitbounty:status "));
const replies = () => botComments().filter((c) => !c.body.includes("<!-- bitbounty:status "));

async function fund() {
  const b = (await repo.findByIssue(REPO, issueNumber))!;
  const r = transition(b, { type: "funding.paid", bountyId: b.id, occurredAt: "2026-10-17T16:05:00Z", fundingId: "f1", rail: "lightning", amountXof: b.amountXof });
  if (!r.ok) throw new Error(r.message);
  await repo.update(r.bounty, "unfunded");
}

beforeEach(() => {
  issueNumber++;
  ids = 0;
  gh = new FakeGithubWriter();
  gh.permissions.set("maintainer-demo", "write");
  gh.permissions.set("awa", "read");
  gh.permissions.set("moussa", "read");
  repo = new InMemoryBountyRepo();
  bus = new InMemoryEventBus();
  deps = {
    repo,
    bus,
    writerFor: async () => gh,
    baseUrl: "https://bitbounty.test",
    now: () => new Date("2026-10-17T16:00:00Z"),
    newId: () => `id-${++ids}`,
    log: { info() {}, warn() {}, error() {} },
  };
});

describe("/bounty", () => {
  it("creates the bounty, posts the status comment and sets the labels", async () => {
    const out = await run("/bounty 10000");
    expect(out.kind).toBe("applied");

    const [bounty] = repo.all();
    expect(bounty).toMatchObject({ repoFullName: REPO, issueNumber, amountXof: 10000, status: "unfunded", funderId: "github:maintainer-demo" });
    expect(bus.published).toEqual([{ type: "bounty.created", bountyId: bounty!.id, occurredAt: "2026-10-17T16:00:00.000Z", amountXof: 10000 }]);

    const [status] = statusComments();
    expect(status!.body).toContain(statusMarker(bounty!.id));
    expect(bounty!.statusCommentId).toBe(status!.id);
    expect(replies()).toHaveLength(0);
    expect(gh.labelsOn(REPO, issueNumber).sort()).toEqual(["bounty: waiting for funding", "💰 10 000 FCFA"]);
    expect(gh.repoLabels.get("bounty: waiting for funding")?.color).toBe("bf8700");
  });

  it("looks up the repo permission: a MEMBER with write access can fund", async () => {
    gh.permissions.set("teammate", "write");
    const out = await run("/bounty 5000", { login: "teammate", association: "MEMBER" });
    expect(out.kind).toBe("applied");
    expect(gh.calls).toContain(`getPermission ${REPO} teammate`);
  });

  it("refuses a read-only collaborator, quoting the parser", async () => {
    const out = await run("/bounty 5000", { login: "awa", association: "COLLABORATOR" });
    expect(out).toEqual({ kind: "replied", message: "@awa Only maintainers (write access on this repo) can fund here." });
    expect(repo.all()).toHaveLength(0);
  });

  it("replies with the parser error on a bad amount", async () => {
    const out = await run("/bounty 10.5");
    expect(out.kind).toBe("replied");
    expect(replies()[0]!.body).toMatch(/^@maintainer-demo .*whole number/);
    expect(repo.all()).toHaveLength(0);
  });

  it("refuses a closed issue", async () => {
    const out = await run("/bounty 10000", { state: "closed" });
    expect(out.kind).toBe("replied");
    expect(replies()[0]!.body).toContain("This issue is closed");
    expect(repo.all()).toHaveLength(0);
  });

  it("refuses a second bounty on the same issue", async () => {
    await run("/bounty 10000");
    const out = await run("/bounty +5000");
    expect(out.kind).toBe("replied");
    expect(replies()[0]!.body).toContain("already has a bounty of 10");
    expect(repo.all()).toHaveLength(1);
  });

  it("two /bounty at the same time create only one bounty", async () => {
    const [a, b] = await Promise.all([run("/bounty 10000"), run("/bounty 20000")]);
    expect([a.kind, b.kind].sort()).toEqual(["applied", "replied"]);
    expect(repo.all()).toHaveLength(1);
    expect(statusComments()).toHaveLength(1);
  });

  it("refuses commands on a pull request", async () => {
    const out = await run("/bounty 10000", { pr: true });
    expect(out.kind).toBe("replied");
    expect(repo.all()).toHaveLength(0);
  });
});

describe("status comment edited in place", () => {
  it("edits the same comment and swaps the status label", async () => {
    await run("/bounty 10000");
    const first = statusComments()[0]!;
    await fund();
    await run("/claim", { login: "awa" });

    expect(statusComments()).toHaveLength(1);
    expect(statusComments()[0]!.id).toBe(first.id);
    expect(statusComments()[0]!.body).toContain("@awa");
    expect(gh.calls.filter((c) => c.startsWith("createComment"))).toHaveLength(1);
    expect(gh.labelsOn(REPO, issueNumber).sort()).toEqual(["bounty: claimed", "💰 10 000 FCFA"]);
  });

  it("finds its comment by the marker when the id is lost, and ignores a human copy of the marker", async () => {
    await run("/bounty 10000");
    const bounty = repo.all()[0]!;
    const original = statusComments()[0]!.id;
    gh.addComment(REPO, issueNumber, `${statusMarker(bounty.id)}\nfake`, "troll");
    await repo.setStatusCommentId(bounty.id, null);
    await fund();
    await run("/claim", { login: "awa" });
    expect(repo.all()[0]!.statusCommentId).toBe(original);
    expect(gh.comments.get(original)!.body).toContain("@awa");
    expect(gh.commentsOn(REPO, issueNumber).find((c) => c.authorLogin === "troll")!.body).toContain("fake");
  });

  it("posts a new status comment if someone deleted it", async () => {
    await run("/bounty 10000");
    const original = statusComments()[0]!.id;
    gh.comments.delete(original);
    await fund();
    await run("/claim", { login: "awa" });
    const now = statusComments();
    expect(now).toHaveLength(1);
    expect(now[0]!.id).not.toBe(original);
    expect(isStatusComment(now[0]!.body, repo.all()[0]!.id)).toBe(true);
    expect(repo.all()[0]!.statusCommentId).toBe(now[0]!.id);
  });
});

describe("/claim and friends", () => {
  it("quotes the transition error on an unfunded bounty", async () => {
    await run("/bounty 10000");
    const out = await run("/claim", { login: "awa" });
    expect(out.kind).toBe("replied");
    expect(replies()[0]!.body).toContain("> claim.created is not allowed when the bounty is unfunded");
  });

  it("two /claim in the same second: one wins, the other is told", async () => {
    await run("/bounty 10000");
    await fund();
    const [a, b] = await Promise.all([run("/claim", { login: "awa" }), run("/claim", { login: "moussa" })]);
    expect(a.kind).toBe("applied");
    expect(b.kind).toBe("replied");
    expect(replies()[0]!.body).toContain("@moussa Someone already claimed this bounty.");
    expect((await repo.activeClaim(repo.all()[0]!.id))!.login).toBe("awa");
    expect(bus.published.filter((e) => e.type === "claim.created")).toHaveLength(1);
  });

  it("a stale write loses the compare-and-set even without the lock (second process)", async () => {
    await run("/bounty 10000");
    await fund();
    const b = repo.all()[0]!;
    const r1 = transition(b, { type: "claim.created", bountyId: b.id, occurredAt: "x", claimId: "c1", userId: "u1" });
    const r2 = transition(b, { type: "claim.created", bountyId: b.id, occurredAt: "x", claimId: "c2", userId: "u2" });
    expect(r1.ok && (await repo.update(r1.bounty, r1.from))).toBeTruthy();
    expect(r2.ok && (await repo.update(r2.bounty, r2.from))).toBeUndefined();
  });

  it("refuses /claim on a closed issue", async () => {
    await run("/bounty 10000");
    await fund();
    const out = await run("/claim", { login: "awa", state: "closed" });
    expect(out.kind).toBe("replied");
    expect(repo.all()[0]!.status).toBe("funded");
  });

  it("/unclaim: only the claimant or a maintainer", async () => {
    await run("/bounty 10000");
    await fund();
    await run("/claim", { login: "awa" });
    expect((await run("/unclaim", { login: "moussa" })).kind).toBe("replied");
    expect(repo.all()[0]!.status).toBe("claimed");
    expect((await run("/unclaim", { login: "awa" })).kind).toBe("applied");
    expect(repo.all()[0]!.status).toBe("funded");
    expect(await repo.activeClaim(repo.all()[0]!.id)).toBeUndefined();
    expect(gh.labelsOn(REPO, issueNumber)).toContain("bounty: open");
  });

  it("/cancel on an unfunded bounty cancels it and emits bounty.cancelled", async () => {
    await run("/bounty 10000");
    await run("/cancel");
    expect(repo.all()[0]!.status).toBe("cancelled");
    expect(bus.published.at(-1)!.type).toBe("bounty.cancelled");
    expect(gh.labelsOn(REPO, issueNumber)).toContain("bounty: cancelled");
    expect(gh.labelsOn(REPO, issueNumber)).not.toContain("bounty: waiting for funding");
  });

  it("a command with no bounty gets a hint", async () => {
    const out = await run("/claim", { login: "awa" });
    expect(out.kind).toBe("replied");
    expect(replies()[0]!.body).toContain("no bounty on this issue");
  });
});

describe("/pay (CR2: /pay now skips the objection window)", () => {
  const WINDOW_MS = 24 * 60 * 60_000;
  /** /bounty → funded → /claim by awa, plus Settlement on the same bus with timers the test inspects. */
  async function claimedWithSettlement() {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const started: PayoutRequest[] = [];
    new Settlement({
      repo,
      bus,
      startPayout: async (req) => void started.push(req),
      objectionMs: WINDOW_MS,
      schedule: (fn, ms) => void timers.push({ fn, ms }),
      log: { info() {}, warn() {}, error() {} },
    }).register();
    await run("/bounty 10000");
    await fund();
    await run("/claim", { login: "awa" });
    const fire = async () => {
      for (const t of timers.splice(0)) t.fn();
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    };
    return { timers, started, fire };
  }

  it("/pay now publishes maintainer.pay with now: true and starts the payout without waiting", async () => {
    const s = await claimedWithSettlement();
    expect((await run("/pay now")).kind).toBe("applied");
    expect(bus.published.at(-1)).toMatchObject({ type: "maintainer.pay", actorLogin: "maintainer-demo", now: true });
    expect(s.timers.map((t) => t.ms)).toEqual([0]);
    await s.fire();
    expect(s.started).toEqual([{ bountyId: repo.all()[0]!.id, userId: "github:awa", amountXof: 10000 }]);
  });

  it("plain /pay still waits OBJECTION_WINDOW_MINUTES", async () => {
    const s = await claimedWithSettlement();
    expect((await run("/pay")).kind).toBe("applied");
    const ev = bus.published.at(-1)!;
    expect(ev.type).toBe("maintainer.pay");
    expect("now" in ev).toBe(false);
    expect(s.timers.map((t) => t.ms)).toEqual([WINDOW_MS]);
    expect(s.started).toHaveLength(0);
  });

  it("/pay now then /hold before the timer runs: nothing is paid", async () => {
    const s = await claimedWithSettlement();
    await run("/pay now");
    await run("/hold");
    await s.fire();
    expect(s.started).toHaveLength(0);
    expect(repo.all()[0]!.status).toBe("on_hold");
  });
});

describe("silence", () => {
  it("ignores bots (including itself) without any API call", async () => {
    const out = await run("/bounty 10000", { login: "bitbounty-dakar[bot]", type: "Bot" });
    expect(out.kind).toBe("ignored");
    expect(gh.calls).toEqual([]);
  });

  it("ignores ordinary comments without any API call", async () => {
    const out = await run("Thanks! I'll look at /bounty later.");
    expect(out.kind).toBe("ignored");
    expect(gh.calls).toEqual([]);
  });
});

describe("registerCommentWiring", () => {
  it("runs on issue_comment.created from the dispatcher", async () => {
    const dispatcher = registerCommentWiring(new GithubDispatcher(), deps);
    await dispatcher.dispatch(commentEvent("/bounty 10000"));
    expect(repo.all()).toHaveLength(1);
    await dispatcher.dispatch({ ...commentEvent("/bounty 10000"), action: "edited" });
    expect(replies()).toHaveLength(0);
  });
});
