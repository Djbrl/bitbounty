import type { Bounty } from "@bitbounty/core";
import { beforeEach, describe, expect, it } from "vitest";
import { GithubDispatcher } from "../../github/dispatcher.js";
import type { StoredEvent } from "../../github/event-store.js";
import { InMemoryBountyRepo, InMemoryEventBus } from "../../github/pr/fakes.js";
import type { RequestClient } from "../../github/pr/octokit.js";
import { FakeVerifierClient } from "../verifier/index.js";
import type { VerifierClient } from "../verifier/index.js";
import { FakeBountyLookup, FakeCheckRunGithub } from "./fakes.js";
import { CheckRunPublisher, registerCheckRun } from "./handler.js";
import { criteriaFromIssueBody, IssueDemoLookup, RepoBountyLookup } from "./lookup.js";
import { OctokitCheckRunGithub } from "./octokit.js";
import { conclusionFor, sanitize, summarizeCi } from "./summary.js";
import { CHECK_NAME, type LinkedBounty, type PrRef } from "./types.js";

const REPO = "acme/widgets";
const DIFF = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+export const retry = 3;\n";
const LINKED: LinkedBounty = {
  bountyId: "b1",
  issueNumber: 12,
  issue: { title: "Add retry", body: "Retries please" },
  criteria: [{ text: "Adds a retry constant" }, { text: "Has tests" }],
};

function payload(sha: string, action = "synchronize", extra: Record<string, unknown> = {}) {
  return {
    action,
    repository: { full_name: REPO },
    installation: { id: 42 },
    pull_request: { number: 7, title: "Retry", body: "Fixes #12", user: { login: "dev" }, head: { sha } },
    ...extra,
  };
}

function event(p: unknown): StoredEvent {
  const a = (p as { action: string }).action;
  return {
    id: 1,
    source: "github",
    externalId: Math.random().toString(),
    type: "pull_request",
    action: a,
    repo: REPO,
    installationId: 42,
    payload: p,
    receivedAt: new Date(),
    status: "received",
    processedAt: null,
    error: null,
  };
}

const answer = (verdict: "pass" | "fail" | "unsure", met = [true, true]) => ({
  criteria: met.map((m, i) => ({ text: LINKED.criteria[i]!.text, met: m, evidence: m ? "src/a.ts adds it" : "nothing" })),
  verdict,
  summary: `Model says ${verdict}`,
  risk_flags: [],
});

const silent = { info() {}, warn() {}, error() {} };

describe("CheckRunPublisher", () => {
  let github: FakeCheckRunGithub;
  let bus: InMemoryEventBus;
  let lookup: FakeBountyLookup;
  let tasks: Array<() => Promise<void>>;
  let client: VerifierClient;
  let dispatcher: GithubDispatcher;

  const drain = async () => {
    while (tasks.length) await tasks.shift()!();
  };

  beforeEach(() => {
    github = new FakeCheckRunGithub();
    github.diffs.set(7, DIFF);
    github.heads.set(7, "sha1");
    bus = new InMemoryEventBus();
    lookup = new FakeBountyLookup(new Map([[7, LINKED]]));
    tasks = [];
    client = new FakeVerifierClient(answer("pass"));
    dispatcher = new GithubDispatcher();
    registerCheckRun(dispatcher, {
      github,
      lookup,
      bus,
      verifierClient: () => client,
      verifyOptions: { retries: 0, timeoutMs: 1_000, backoffMs: 1 },
      runInBackground: (t) => tasks.push(t),
      now: () => new Date("2026-10-17T10:00:00Z"),
      log: silent,
    });
  });

  it("creates the check in_progress before the slow part, then completes it", async () => {
    await dispatcher.dispatch(event(payload("sha1", "opened")));
    expect(github.runs).toHaveLength(1);
    expect(github.runs[0]).toMatchObject({ repo: REPO, headSha: "sha1", status: "in_progress" });
    await drain();
    expect(github.runs[0]).toMatchObject({ status: "completed", conclusion: "success" });
  });

  it.each([
    ["pass", [true, true], "success"],
    ["fail", [false, false], "failure"],
    ["unsure", [true, false], "neutral"],
  ] as const)("verdict %s → %s conclusion and verify.done", async (verdict, met, conclusion) => {
    client = new FakeVerifierClient(answer(verdict, [...met]));
    await dispatcher.dispatch(event(payload("sha1")));
    await drain();
    expect(github.runs[0]!.conclusion).toBe(conclusion);
    expect(bus.published).toEqual([
      { type: "verify.done", bountyId: "b1", occurredAt: "2026-10-17T10:00:00.000Z", prNumber: 7, headSha: "sha1", verdict },
    ]);
  });

  it("summary lists each criterion with its evidence and says a human decides", async () => {
    client = new FakeVerifierClient(answer("unsure", [true, false]));
    await dispatcher.dispatch(event(payload("sha1")));
    await drain();
    const { summary, title } = github.runs[0]!.output;
    expect(title).toMatch(/Unsure/);
    expect(summary).toContain("1. ✅ Met: Adds a retry constant");
    expect(summary).toContain("Evidence: src/a.ts adds it");
    expect(summary).toContain("2. ❌ Not met: Has tests");
    expect(summary).toContain("advice, not approval");
    expect(summary).toMatch(/human maintainer decides/);
    expect(summary).toContain("Bounty `b1` · issue #12 · commit `sha1`");
  });

  it("ignores PRs not linked to a funded bounty", async () => {
    lookup.byPr.clear();
    await dispatcher.dispatch(event(payload("sha1")));
    expect(github.runs).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  it("ignores other actions and payloads without an installation", async () => {
    await dispatcher.dispatch(event(payload("sha1", "closed")));
    await dispatcher.dispatch(event(payload("sha1", "edited")));
    await dispatcher.dispatch(event(payload("sha1", "opened", { installation: undefined })));
    expect(github.runs).toHaveLength(0);
  });

  it("break-it: 3 fast pushes → only the latest gets a verdict", async () => {
    github.heads.set(7, "sha3");
    for (const sha of ["sha1", "sha2", "sha3"]) await dispatcher.dispatch(event(payload(sha)));
    await drain();
    expect(github.runs.map((r) => [r.headSha, r.conclusion])).toEqual([
      ["sha1", "skipped"],
      ["sha2", "skipped"],
      ["sha3", "success"],
    ]);
    expect(github.runs[0]!.output.title).toMatch(/Superseded/);
    expect(bus.published.map((e) => (e as { headSha: string }).headSha)).toEqual(["sha3"]);
  });

  it("break-it: a push landing while Claude runs makes the older run stand down", async () => {
    github.onDiff = async () => {
      github.onDiff = null;
      github.heads.set(7, "sha2");
      await dispatcher.dispatch(event(payload("sha2")));
    };
    await dispatcher.dispatch(event(payload("sha1")));
    await drain();
    expect(github.runs.map((r) => [r.headSha, r.conclusion])).toEqual([
      ["sha1", "skipped"],
      ["sha2", "success"],
    ]);
    expect(bus.published).toHaveLength(1);
  });

  it("a newer head seen only on GitHub (missed webhook / other instance) also supersedes", async () => {
    github.heads.set(7, "shaX");
    await dispatcher.dispatch(event(payload("sha1")));
    await drain();
    expect(github.runs[0]!.conclusion).toBe("skipped");
    expect(bus.published).toHaveLength(0);
  });

  it("break-it: Claude unavailable → neutral, never a false failure", async () => {
    client = {
      name: "anthropic:test",
      isFake: false,
      complete: async () => {
        throw new Error("overloaded");
      },
    };
    await dispatcher.dispatch(event(payload("sha1")));
    await drain();
    expect(github.runs[0]!.conclusion).toBe("neutral");
    expect(github.runs[0]!.output.summary).toMatch(/Verifier unavailable/);
    expect(bus.published).toMatchObject([{ verdict: "unsure" }]);
  });

  it("diff unreadable (e.g. GitHub 406 on a huge PR) → neutral check, no verify.done", async () => {
    github.failDiff = new Error("HttpError: diff too large");
    await dispatcher.dispatch(event(payload("sha1")));
    await drain();
    expect(github.runs[0]!.conclusion).toBe("neutral");
    expect(github.runs[0]!.output.title).toMatch(/unavailable/);
    expect(bus.published).toHaveLength(0);
  });

  it("the default background runner never leaves an unhandled rejection", async () => {
    const pub = new CheckRunPublisher({ github, lookup, bus, verifierClient: () => client, log: silent });
    github.failDiff = new Error("boom");
    await pub.onPullRequest(payload("sha1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(github.runs[0]!.conclusion).toBe("neutral");
  });
});

describe("summary helpers", () => {
  it("maps verdicts to conclusions", () => {
    expect([conclusionFor("pass"), conclusionFor("fail"), conclusionFor("unsure")]).toEqual(["success", "failure", "neutral"]);
  });

  it("sanitizes untrusted evidence: no pings, no HTML, one line, capped", () => {
    const s = sanitize("ping @maintainer about #12\n<img src=x onerror=1> [link](http://evil) " + "x".repeat(1000));
    expect(s).not.toMatch(/@maintainer/);
    expect(s).not.toMatch(/#12/);
    expect(s).not.toContain("<img");
    expect(s).not.toContain("\n");
    expect(s).toContain("\\[link\\]");
    expect(s.length).toBeLessThan(700);
  });

  it("summarizes CI and ignores our own check", () => {
    const run = (name: string, status: string, conclusion: string | null) => ({ name, status, conclusion });
    expect(summarizeCi([], { state: "pending", total_count: 0 }, CHECK_NAME).status).toBe("unknown");
    expect(summarizeCi([run(CHECK_NAME, "completed", "failure")], null, CHECK_NAME).status).toBe("unknown");
    expect(summarizeCi([run("test", "completed", "success")], null, CHECK_NAME).status).toBe("success");
    expect(summarizeCi([run("test", "in_progress", null)], null, CHECK_NAME).status).toBe("pending");
    expect(summarizeCi([run("test", "completed", "failure")], null, CHECK_NAME).status).toBe("failure");
    expect(summarizeCi([run("t", "completed", "success")], { state: "failure", total_count: 1 }, CHECK_NAME).status).toBe(
      "failure",
    );
  });
});

describe("lookups", () => {
  const pr: PrRef = { repo: REPO, installationId: 42, number: 7, headSha: "s", title: "t", body: "Fixes #12", authorLogin: "dev" };
  const bounty = (status: Bounty["status"]): Bounty => ({
    id: "b1",
    repoFullName: REPO,
    issueNumber: 12,
    issueTitle: "Add retry",
    amountXof: 5000 as Bounty["amountXof"],
    status,
    criteria: [{ text: "Adds a retry constant" }],
    funderKind: "human",
    funderId: "u1",
    verdict: null,
    statusCommentId: null,
    createdAt: "2026-10-17T00:00:00Z",
    expiresAt: null,
  });

  it("RepoBountyLookup finds the funded bounty a PR closes, with its criteria", async () => {
    const repo = new InMemoryBountyRepo().add(bounty("claimed"));
    const found = await new RepoBountyLookup(repo, async () => "issue body").findForPr(pr);
    expect(found).toEqual({
      bountyId: "b1",
      issueNumber: 12,
      issue: { title: "Add retry", body: "issue body" },
      criteria: [{ text: "Adds a retry constant" }],
    });
  });

  it("RepoBountyLookup skips unfunded or finished bounties and unlinked PRs", async () => {
    for (const s of ["unfunded", "paid", "cancelled"] as const) {
      const repo = new InMemoryBountyRepo().add(bounty(s));
      expect(await new RepoBountyLookup(repo).findForPr(pr)).toBeUndefined();
    }
    const repo = new InMemoryBountyRepo().add(bounty("funded"));
    expect(await new RepoBountyLookup(repo).findForPr({ ...pr, body: "related to #12" })).toBeUndefined();
  });

  it("RepoBountyLookup takes the issue's Done when criteria when the bounty has none (/bounty)", async () => {
    const repo = new InMemoryBountyRepo().add({ ...bounty("claimed"), criteria: [] });
    const found = await new RepoBountyLookup(repo, async () => "## Done when\n- Retries 3 times\n- Has a test").findForPr(pr);
    expect(found?.criteria).toEqual([{ text: "Retries 3 times" }, { text: "Has a test" }]);
    // The bounty's own criteria still win when it has some.
    const own = new InMemoryBountyRepo().add(bounty("claimed"));
    expect((await new RepoBountyLookup(own, async () => "## Done when\n- other").findForPr(pr))?.criteria).toEqual([
      { text: "Adds a retry constant" },
    ]);
  });

  it("RepoBountyLookup still works when the issue body can't be read", async () => {
    const repo = new InMemoryBountyRepo().add(bounty("funded"));
    const found = await new RepoBountyLookup(repo, async () => {
      throw new Error("404");
    }).findForPr(pr);
    expect(found?.issue.body).toBe("");
  });

  it("criteriaFromIssueBody prefers the Done when section, else checklist items", () => {
    expect(criteriaFromIssueBody("## Done when\nA check appears.\n\n## Points\n- [ ] not this")).toEqual([
      { text: "A check appears." },
    ]);
    expect(criteriaFromIssueBody("Intro\n- [ ] **Adds** retry\n- [x] Has tests")).toEqual([
      { text: "Adds retry" },
      { text: "Has tests" },
    ]);
  });

  it("IssueDemoLookup reads the closed issue from GitHub", async () => {
    const gh = new FakeCheckRunGithub();
    gh.issues.set(12, { title: "Add retry", body: "## Done when\nRetry exists" });
    const found = await new IssueDemoLookup(gh).findForPr(pr);
    expect(found).toMatchObject({ issueNumber: 12, criteria: [{ text: "Retry exists" }] });
    expect(await new IssueDemoLookup(gh).findForPr({ ...pr, body: null })).toBeUndefined();
  });
});

describe("OctokitCheckRunGithub", () => {
  function recorder(data: (route: string) => unknown) {
    const calls: Array<{ route: string; params: Record<string, unknown> }> = [];
    const client: RequestClient = {
      async request(route, params) {
        calls.push({ route, params });
        return { data: data(route) };
      },
    };
    return { calls, gh: new OctokitCheckRunGithub(async () => client) };
  }
  const t = { repo: REPO, installationId: 42 };

  it("creates and completes the named check run", async () => {
    const { calls, gh } = recorder(() => ({ id: 99 }));
    expect(await gh.createCheckRun(t, "sha1", { title: "x", summary: "y" })).toBe(99);
    await gh.completeCheckRun(t, 99, "neutral", { title: "a", summary: "b" });
    expect(calls[0]).toMatchObject({
      route: "POST /repos/{owner}/{repo}/check-runs",
      params: { owner: "acme", repo: "widgets", name: CHECK_NAME, head_sha: "sha1", status: "in_progress" },
    });
    expect(calls[1]).toMatchObject({ params: { check_run_id: 99, status: "completed", conclusion: "neutral" } });
  });

  it("asks for the diff media type", async () => {
    const { calls, gh } = recorder(() => DIFF);
    expect(await gh.getPrDiff(t, 7)).toBe(DIFF);
    expect(calls[0]!.params).toMatchObject({ pull_number: 7, headers: { accept: "application/vnd.github.diff" } });
  });

  it("CI read errors become unknown", async () => {
    const gh = new OctokitCheckRunGithub(async () => {
      throw new Error("403");
    });
    expect(await gh.getCiStatus(t, "sha1")).toEqual({ status: "unknown" });
  });
});
