import { readFileSync } from "node:fs";
import { createBounty, type Bounty, type BountyStatus, type EventOf } from "@bitbounty/core";
import { beforeEach, describe, expect, it } from "vitest";
import { GithubDispatcher } from "../dispatcher.js";
import { InMemoryEventStore, type StoredEvent } from "../event-store.js";
import { signPayload } from "../signature.js";
import { githubWebhookRoutes } from "../webhook.js";
import {
  FixedCiReader,
  InMemoryBountyRepo,
  InMemoryEventBus,
  RecordingNotifier,
  handlePullRequest,
  parsePullRequestPayload,
  registerPrHandlers,
  type PrDeps,
} from "./index.js";

const REPO = "bitbounty-demo/sandbox";
type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function fixture(name: string): Payload {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/pull_request.${name}.json`, import.meta.url), "utf8"));
}
const OPENED = fixture("opened");
const SYNC = fixture("synchronize");
const MERGED = fixture("closed.merged");
const UNMERGED = fixture("closed.unmerged");
const NOT_CLAIMANT = fixture("opened.not-claimant");
const UNFUNDED = fixture("opened.unfunded");

function bounty(id: string, issueNumber: number, status: BountyStatus, extra: Partial<Bounty> = {}): Bounty {
  const { bounty: b } = createBounty({
    id,
    repoFullName: REPO,
    issueNumber,
    issueTitle: `Issue ${issueNumber}`,
    amountXof: 10_000,
    criteria: [{ text: "README in Wolof" }],
    funderKind: "human",
    funderId: "funder-1",
    createdAt: "2026-10-17T15:00:00Z",
  });
  return { ...b, status, ...extra };
}
const AWA = { claimId: "c-1", userId: "u-awa", login: "Awa-Dev" }; // case differs from the PR author on purpose

let repo: InMemoryBountyRepo;
let bus: InMemoryEventBus;
let notifier: RecordingNotifier;
let ci: FixedCiReader;
let deps: PrDeps;
let dispatcher: GithubDispatcher;
let nextId = 1;

function stored(payload: Payload): StoredEvent {
  return {
    id: nextId++,
    source: "github",
    externalId: `d-${nextId}`,
    type: "pull_request",
    action: payload.action,
    repo: REPO,
    installationId: payload.installation?.id ?? null,
    payload,
    receivedAt: new Date(),
    status: "received",
    processedAt: null,
    error: null,
  };
}
const send = (payload: Payload) => dispatcher.dispatch(stored(payload));
const handle = (payload: Payload) => handlePullRequest(parsePullRequestPayload(payload)!, deps);
const clone = (p: Payload): Payload => structuredClone(p);

beforeEach(() => {
  repo = new InMemoryBountyRepo()
    .add(bounty("b-42", 42, "claimed"), AWA)
    .add(bounty("b-44", 44, "unfunded"));
  bus = new InMemoryEventBus();
  notifier = new RecordingNotifier();
  ci = new FixedCiReader(true);
  deps = { bounties: repo, bus, notifier, ci, now: () => new Date("2026-10-17T17:00:01Z") };
  dispatcher = registerPrHandlers(new GithubDispatcher(), deps);
});

describe("parsePullRequestPayload", () => {
  it("reads the fields from a real payload", () => {
    expect(parsePullRequestPayload(MERGED)).toMatchObject({
      action: "closed",
      repo: REPO,
      installationId: 55500001,
      number: 43,
      merged: true,
      mergeCommitSha: "c3d4e5f60718293a4b5c6d7e8f9012345678a1b2",
      mergedBy: "maintainer-demo",
      authorLogin: "awa-dev",
      headRepo: "awa-dev/sandbox",
    });
  });

  it.each([null, {}, { action: "opened" }, { ...OPENED, pull_request: { ...OPENED.pull_request, head: null } }])(
    "rejects a malformed payload %#",
    (p) => {
      expect(parsePullRequestPayload(p)).toBeNull();
    },
  );

  it("ignores a malformed payload in the dispatcher", async () => {
    await dispatcher.dispatch({ ...stored(OPENED), payload: { action: "opened" } });
    expect(bus.published).toEqual([]);
  });
});

describe("opened → pr.linked", () => {
  it("links the claimant's PR (from a fork) and emits pr.linked", async () => {
    await send(OPENED);
    expect(bus.published).toEqual([
      {
        type: "pr.linked",
        bountyId: "b-42",
        occurredAt: "2026-10-17T17:00:01.000Z",
        prNumber: 43,
        authorLogin: "awa-dev",
        headSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      },
    ]);
    expect(repo.bounties.get("b-42")!.status).toBe("submitted");
    expect(await repo.currentSubmission("b-42")).toMatchObject({ prNumber: 43, headSha: OPENED.pull_request.head.sha });
    expect(notifier.comments).toEqual([]);
  });

  it("is idempotent: the same opened twice, or a body edit, emits once", async () => {
    await send(OPENED);
    await send(OPENED);
    await send({ ...clone(OPENED), action: "edited" });
    expect(bus.published).toHaveLength(1);
  });

  it("links on edited when 'Fixes #42' is added after opening", async () => {
    const noLink = clone(OPENED);
    noLink.pull_request.body = "Wolof translation, WIP";
    await send(noLink);
    expect(bus.published).toEqual([]);
    await send({ ...clone(OPENED), action: "edited" });
    expect(bus.published.map((e) => e.type)).toEqual(["pr.linked"]);
  });

  it("links every bounty a PR fixes", async () => {
    repo.add(bounty("b-50", 50, "claimed"), AWA);
    const p = clone(OPENED);
    p.pull_request.body = "Fixes #42\nFixes #50\nfixes other/repo#42";
    const r = await handle(p);
    expect(r.outcomes.map((o) => [o.kind, o.issue])).toEqual([
      ["linked", 42],
      ["linked", 50],
    ]);
    expect(r.crossRepo).toEqual([{ repo: "other/repo", number: 42 }]);
    expect(bus.published.map((e) => e.bountyId)).toEqual(["b-42", "b-50"]);
  });

  it("does nothing for an issue without a bounty", async () => {
    const p = clone(OPENED);
    p.pull_request.body = "Fixes #999";
    expect((await handle(p)).outcomes).toEqual([{ kind: "skipped", issue: 999, reason: "no_bounty" }]);
    expect(bus.published).toEqual([]);
  });

  it("ignores edits on a closed PR", async () => {
    const p = { ...clone(UNMERGED), action: "edited" };
    expect((await handle(p)).outcomes).toEqual([]);
  });
});

describe("synchronize", () => {
  it("re-emits pr.linked with the new head sha and resets the verdict", async () => {
    await send(OPENED);
    repo.bounties.set("b-42", { ...repo.bounties.get("b-42")!, verdict: "pass" });
    await send(SYNC);
    expect(bus.published.map((e) => (e as EventOf<"pr.linked">).headSha)).toEqual([
      OPENED.pull_request.head.sha,
      SYNC.pull_request.head.sha,
    ]);
    expect(repo.bounties.get("b-42")).toMatchObject({ status: "submitted", verdict: null });
    expect(await repo.currentSubmission("b-42")).toMatchObject({ headSha: SYNC.pull_request.head.sha });
  });

  it("links on the first push after claiming, if the PR was opened before the claim", async () => {
    repo.bounties.set("b-42", { ...repo.bounties.get("b-42")!, status: "funded" });
    repo.claimants.delete("b-42");
    await send(OPENED);
    expect(bus.published).toEqual([]);
    expect(notifier.comments[0]!.body).toContain("/claim");

    repo.bounties.set("b-42", { ...repo.bounties.get("b-42")!, status: "claimed" });
    repo.claimants.set("b-42", AWA);
    await send(SYNC);
    expect(bus.published.map((e) => e.type)).toEqual(["pr.linked"]);
  });
});

describe("PR by someone who didn't claim", () => {
  it("doesn't link, and tells them politely on the PR", async () => {
    await send(NOT_CLAIMANT);
    expect(bus.published).toEqual([]);
    expect(repo.bounties.get("b-42")!.status).toBe("claimed");
    expect(notifier.comments).toEqual([
      expect.objectContaining({ repo: REPO, issueNumber: 46, installationId: 55500001 }),
    ]);
    expect(notifier.comments[0]!.body).toContain("claimed by @Awa-Dev");
    expect(notifier.comments[0]!.body).toContain("/pay @Moussa-Dev");
  });

  it("doesn't steal an already-submitted bounty, and doesn't re-comment on each push", async () => {
    await send(OPENED);
    await send(NOT_CLAIMANT);
    await send({ ...clone(NOT_CLAIMANT), action: "synchronize" });
    expect(bus.published).toHaveLength(1);
    expect(await repo.currentSubmission("b-42")).toMatchObject({ prNumber: 43 });
    expect(notifier.comments).toHaveLength(1);
  });

  it("merging it asks the maintainer instead of emitting pr.merged", async () => {
    const merged = clone(NOT_CLAIMANT);
    Object.assign(merged, { action: "closed" });
    Object.assign(merged.pull_request, { state: "closed", merged: true, merge_commit_sha: "f".repeat(40) });
    const r = await handle(merged);
    expect(r.outcomes).toEqual([{ kind: "asked_maintainer", issue: 42, bountyId: "b-42" }]);
    expect(bus.published).toEqual([]);
    expect(notifier.comments.at(-1)).toMatchObject({ issueNumber: 42 });
    expect(notifier.comments.at(-1)!.body).toContain("/pay @Awa-Dev");
    expect(notifier.comments.at(-1)!.body).toContain("/pay @Moussa-Dev");
  });
});

describe("PR referencing an unfunded issue", () => {
  it("links nothing, emits nothing, says nothing", async () => {
    const r = await handle(UNFUNDED);
    expect(r.outcomes).toEqual([{ kind: "skipped", issue: 44, bountyId: "b-44", reason: "unfunded" }]);
    await send(UNFUNDED);
    expect(bus.published).toEqual([]);
    expect(notifier.comments).toEqual([]);
    expect(repo.bounties.get("b-44")!.status).toBe("unfunded");
  });
});

describe("closed + merged → pr.merged", () => {
  it("emits pr.merged with the merge sha and author; CI green + pass → verified", async () => {
    await send(OPENED);
    repo.bounties.set("b-42", { ...repo.bounties.get("b-42")!, verdict: "pass" });
    await send(MERGED);
    expect(bus.published.at(-1)).toEqual({
      type: "pr.merged",
      bountyId: "b-42",
      occurredAt: "2026-10-17T18:00:00Z",
      prNumber: 43,
      ciGreen: true,
      mergeSha: "c3d4e5f60718293a4b5c6d7e8f9012345678a1b2",
      authorLogin: "awa-dev",
      mergedByLogin: "maintainer-demo",
    });
    expect(repo.bounties.get("b-42")!.status).toBe("verified");
    expect(await repo.currentSubmission("b-42")).toMatchObject({ mergedAt: "2026-10-17T18:00:00Z" });
  });

  it("CI red → on_hold (the maintainer decides)", async () => {
    ci.green = false;
    await send(OPENED);
    const r = await handle(MERGED);
    expect(r.outcomes).toEqual([{ kind: "merged", issue: 42, bountyId: "b-42", to: "on_hold", ciGreen: false }]);
  });

  it("still counts when 'Fixes #42' was removed from the body before merging", async () => {
    await send(OPENED);
    const p = clone(MERGED);
    p.pull_request.body = "Wolof translation";
    await send(p);
    expect(bus.published.map((e) => e.type)).toEqual(["pr.linked", "pr.merged"]);
  });

  it("a redelivered merge doesn't emit twice", async () => {
    await send(OPENED);
    await send(MERGED);
    await send(MERGED);
    expect(bus.published.filter((e) => e.type === "pr.merged")).toHaveLength(1);
  });
});

describe("closed without merge", () => {
  it("emits nothing and keeps the submission", async () => {
    await send(OPENED);
    await send(UNMERGED);
    expect(bus.published.map((e) => e.type)).toEqual(["pr.linked"]);
    expect(repo.bounties.get("b-42")!.status).toBe("submitted");
  });

  it("closed, reopened, then merged still pays once", async () => {
    await send(OPENED);
    await send(UNMERGED);
    await send({ ...clone(SYNC), action: "reopened" });
    await send(MERGED);
    expect(bus.published.map((e) => e.type)).toEqual(["pr.linked", "pr.linked", "pr.merged"]);
  });
});

describe("merge without the link → asks the maintainer", () => {
  it("claimant's PR merged without 'Fixes #n': comments on the issue, no pr.merged", async () => {
    const p = clone(MERGED);
    p.pull_request.body = "Wolof translation of the README.";
    p.pull_request.title = "Wolof README";
    const r = await handle(p);
    expect(r.outcomes).toEqual([{ kind: "asked_maintainer", issue: 42, bountyId: "b-42" }]);
    expect(bus.published).toEqual([]);
    expect(notifier.comments).toEqual([
      expect.objectContaining({ repo: REPO, issueNumber: 42, installationId: 55500001 }),
    ]);
    expect(notifier.comments[0]!.body).toContain("Is PR #43 the fix for #42?");
    expect(notifier.comments[0]!.body).toContain("`/pay @Awa-Dev`");
    expect(repo.bounties.get("b-42")!.status).toBe("claimed");
  });

  it("a merged PR unrelated to any bounty does nothing", async () => {
    const p = clone(MERGED);
    p.pull_request.body = "Typo";
    p.pull_request.user.login = "someone-else";
    expect((await handle(p)).outcomes).toEqual([]);
    expect(notifier.comments).toEqual([]);
  });

  it("merge referencing a funded-but-unclaimed bounty is skipped", async () => {
    repo.bounties.set("b-42", { ...repo.bounties.get("b-42")!, status: "funded" });
    repo.claimants.delete("b-42");
    const r = await handle(MERGED);
    expect(r.outcomes).toEqual([{ kind: "skipped", issue: 42, bountyId: "b-42", reason: "unclaimed" }]);
    expect(bus.published).toEqual([]);
  });
});

describe("through the signed webhook route", () => {
  it("opened then merged → pr.linked, pr.merged", async () => {
    const SECRET = "s3cret";
    const app = githubWebhookRoutes({ secret: SECRET, store: new InMemoryEventStore(), dispatcher });
    const post = async (payload: Payload, delivery: string) => {
      const body = JSON.stringify(payload);
      const res = await app.request("/webhooks/github", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": delivery,
          "x-hub-signature-256": signPayload(SECRET, body),
        },
      });
      expect(res.status).toBeLessThan(300);
    };
    await post(OPENED, "del-1");
    await post(MERGED, "del-2");
    expect(bus.published.map((e) => e.type)).toEqual(["pr.linked", "pr.merged"]);
  });
});

describe("InMemoryEventBus", () => {
  it("delivers to subscribers of that type only", async () => {
    const seen: string[] = [];
    bus.subscribe("pr.merged", (e) => void seen.push(`merged:${e.prNumber}`));
    bus.subscribe("pr.linked", (e) => void seen.push(`linked:${e.headSha.slice(0, 4)}`));
    await send(OPENED);
    await send(MERGED);
    expect(seen).toEqual(["linked:a1b2", "merged:43"]);
  });
});
