import type { InternalEvent } from "@bitbounty/core";
import { describe, expect, it } from "vitest";
import { InMemoryBountyRepo } from "../bounties/repo.js";
import { FakeAssigner } from "../github/claims/github.js";
import { FakeGithubWriter } from "../github/wiring/writer.js";
import { agentsFromEnv, generateAgentKey, hashAgentKey, StaticAgentRegistry, type Agent } from "./registry.js";
import { agentRoutes } from "./routes.js";
import { AgentService } from "./service.js";
import { ListAgentSpending, monthStart } from "./spending.js";

const KEY = generateAgentKey();
const OTHER_KEY = generateAgentKey();
const REVOKED_KEY = generateAgentKey();

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "demo-agent",
  ownerLogin: "Djbrl",
  keyHash: hashAgentKey(KEY),
  monthlyBudgetXof: 30_000,
  perTaskMaxXof: 20_000,
  allowedRepos: ["galsen-oss/wolof-i18n"],
  revoked: false,
  ...over,
});

function setup(opts: { github?: boolean; now?: () => Date } = {}) {
  const repo = new InMemoryBountyRepo();
  const events: InternalEvent[] = [];
  const writer = new FakeGithubWriter();
  const assigner = new FakeAssigner();
  let n = 0;
  const service = new AgentService({
    repo,
    bus: { publish: (e: InternalEvent) => void events.push(e) },
    spending: new ListAgentSpending(() => repo.all()),
    baseUrl: "https://bitbounty.test/",
    github: opts.github ? async () => ({ writer, assigner }) : undefined,
    now: opts.now ?? (() => new Date("2026-10-17T20:00:00Z")),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  const registry = new StaticAgentRegistry([
    agent(),
    agent({ id: "22222222-2222-4222-8222-222222222222", name: "other", keyHash: hashAgentKey(OTHER_KEY) }),
    agent({ id: "33333333-3333-4333-8333-333333333333", name: "old", keyHash: hashAgentKey(REVOKED_KEY), revoked: true }),
  ]);
  const routes = agentRoutes(registry, service);
  const call = (method: string, path: string, body?: unknown, key: string | null = KEY) =>
    routes.request(path, {
      method,
      headers: key ? { authorization: `Bearer ${key}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, events, writer, assigner, service, call };
}

const post = { repo: "galsen-oss/wolof-i18n", issue_number: 12, issue_title: "Translate the errors to Wolof", amount_xof: 10_000, criteria: ["Every error message has a Wolof version", "A native speaker checked them"] };

describe("auth", () => {
  it.each([
    ["no key", null],
    ["a wrong key", generateAgentKey()],
    ["a revoked key", REVOKED_KEY],
    ["garbage", "not-a-key"],
  ])("401 with %s", async (_label, key) => {
    const { call } = setup();
    const res = await call("GET", "/v1/budget", undefined, key);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("generates bb_ keys and only ever keeps their hash", () => {
    expect(KEY).toMatch(/^bb_[A-Za-z0-9_-]{43}$/);
    expect(hashAgentKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(KEY).not.toBe(OTHER_KEY);
  });
});

describe("POST /v1/bounties", () => {
  it("creates an unfunded agent bounty, emits bounty.created, posts the status comment, returns the pay link", async () => {
    const { call, repo, events, writer } = setup({ github: true });
    const res = await call("POST", "/v1/bounties", post);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { bounty: { id: string; fund_url: string }; warnings: string[] };
    expect(json.bounty).toMatchObject({
      repo: "galsen-oss/wolof-i18n",
      issue_number: 12,
      amount_xof: 10_000,
      status: "unfunded",
      criteria: post.criteria,
      fund_url: `https://bitbounty.test/pay/${json.bounty.id}`,
    });
    expect(json.warnings).toEqual([]);
    const stored = await repo.findById(json.bounty.id);
    expect(stored).toMatchObject({ funderKind: "agent", funderId: agent().id, issueTitle: "Translate the errors to Wolof" });
    expect(events.map((e) => e.type)).toEqual(["bounty.created"]);
    expect(writer.calls.some((c) => c.startsWith("createComment galsen-oss/wolof-i18n#12"))).toBe(true);
  });

  it("refuses to go over the monthly budget", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/bounties", { ...post, issue_number: 1, amount_xof: 20_000 })).status).toBe(201);
    const res = await call("POST", "/v1/bounties", { ...post, issue_number: 2, amount_xof: 15_000 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "over_budget" });
    expect((await call("POST", "/v1/bounties", { ...post, issue_number: 3, amount_xof: 10_000 })).status).toBe(201);
    const budget = (await (await call("GET", "/v1/budget")).json()) as { remaining_xof: number; committed_this_month_xof: number };
    expect(budget).toMatchObject({ committed_this_month_xof: 30_000, remaining_xof: 0 });
  });

  it("can't overspend with parallel requests", async () => {
    const { call } = setup();
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) => call("POST", "/v1/bounties", { ...post, issue_number: i, amount_xof: 10_000 })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 403]);
  });

  it("frees budget when a bounty is cancelled, and resets every month", async () => {
    let now = new Date("2026-10-17T20:00:00Z");
    const { call } = setup({ now: () => now });
    const created = (await (await call("POST", "/v1/bounties", { ...post, amount_xof: 20_000 })).json()) as { bounty: { id: string } };
    expect((await call("POST", "/v1/bounties", { ...post, issue_number: 2, amount_xof: 20_000 })).status).toBe(403);
    expect((await call("DELETE", `/v1/bounties/${created.bounty.id}`)).status).toBe(200);
    expect((await call("POST", "/v1/bounties", { ...post, issue_number: 2, amount_xof: 20_000 })).status).toBe(201);
    now = new Date("2026-11-01T00:00:00Z");
    expect((await call("POST", "/v1/bounties", { ...post, issue_number: 3, amount_xof: 20_000 })).status).toBe(201);
  });

  it("refuses a repo the agent isn't allowed to use (case-insensitive match otherwise)", async () => {
    const { call } = setup();
    const res = await call("POST", "/v1/bounties", { ...post, repo: "Djbrl/bitbounty" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "repo_not_allowed" });
    expect((await call("POST", "/v1/bounties", { ...post, repo: "Galsen-OSS/Wolof-i18n" })).status).toBe(201);
  });

  it("refuses an amount above the per-task max", async () => {
    const { call } = setup();
    const res = await call("POST", "/v1/bounties", { ...post, amount_xof: 25_000 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "over_task_max" });
  });

  it("409 when the issue already has a bounty", async () => {
    const { call } = setup();
    await call("POST", "/v1/bounties", post);
    const res = await call("POST", "/v1/bounties", post, OTHER_KEY);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "issue_has_bounty" });
  });

  it.each([
    ["a float amount", { amount_xof: 10.5 }],
    ["a negative amount", { amount_xof: -1 }],
    ["a string amount", { amount_xof: "10000" }],
    ["no criteria", { criteria: [] }],
    ["blank criteria", { criteria: ["  "] }],
    ["7 criteria", { criteria: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["non-string criteria", { criteria: [1, 2] }],
    ["a bad repo", { repo: "nope" }],
    ["issue 0", { issue_number: 0 }],
    ["an amount below 1000 FCFA", { amount_xof: 999 }],
  ])("400 on %s", async (_label, patch) => {
    const { call, repo } = setup();
    const res = await call("POST", "/v1/bounties", { ...post, ...patch });
    expect(res.status).toBe(400);
    expect(repo.all()).toHaveLength(0);
  });

  it("400 on a body that isn't JSON", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/bounties", undefined)).status).toBe(400);
  });

  it("still creates the bounty when GitHub is down, with a warning", async () => {
    const repo = new InMemoryBountyRepo();
    const service = new AgentService({
      repo,
      bus: { publish: () => undefined },
      spending: new ListAgentSpending(() => repo.all()),
      baseUrl: "https://b.test",
      github: async () => {
        throw new Error("Not Found");
      },
    });
    const res = await service.post(agent(), { repo: post.repo, issueNumber: 5, amountXof: 5_000, criteria: ["x works"] });
    expect(res.bounty.status).toBe("unfunded");
    expect(res.warnings[0]).toMatch(/status comment not updated on GitHub: Not Found/);
  });
});

describe("GET and DELETE /v1/bounties/:id", () => {
  it("shows the agent its own bounty, 404 for anyone else's or unknown ids", async () => {
    const { call } = setup();
    const { bounty } = (await (await call("POST", "/v1/bounties", post)).json()) as { bounty: { id: string } };
    expect((await call("GET", `/v1/bounties/${bounty.id}`)).status).toBe(200);
    expect((await call("GET", `/v1/bounties/${bounty.id}`, undefined, OTHER_KEY)).status).toBe(404);
    expect((await call("DELETE", `/v1/bounties/${bounty.id}`, undefined, OTHER_KEY)).status).toBe(404);
    expect((await call("GET", "/v1/bounties/not-a-uuid")).status).toBe(404);
  });

  it("cancels through transition(): bounty.cancelled with the agent as actor", async () => {
    const { call, events } = setup();
    const { bounty } = (await (await call("POST", "/v1/bounties", post)).json()) as { bounty: { id: string } };
    const res = await call("DELETE", `/v1/bounties/${bounty.id}`, { reason: "task done in-house" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { bounty: { status: string } }).bounty.status).toBe("cancelled");
    expect(events.at(-1)).toMatchObject({ type: "bounty.cancelled", actorId: `agent:${agent().id}`, reason: "task done in-house" });
    const again = await call("DELETE", `/v1/bounties/${bounty.id}`);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "cannot_cancel" });
  });

  it("can't cancel once a PR is submitted (protects the developer), can before", async () => {
    const { call, repo } = setup();
    const { bounty } = (await (await call("POST", "/v1/bounties", post)).json()) as { bounty: { id: string } };
    const stored = (await repo.findById(bounty.id))!;
    await repo.update({ ...stored, status: "submitted" }, "unfunded");
    expect((await call("DELETE", `/v1/bounties/${bounty.id}`)).status).toBe(409);
    await repo.update({ ...stored, status: "claimed" }, "submitted");
    const res = await call("DELETE", `/v1/bounties/${bounty.id}`);
    expect(((await res.json()) as { bounty: { status: string } }).bounty.status).toBe("refunded");
  });
});

describe("cancel with an active claim", () => {
  it("releases the claim and unassigns the developer, like /cancel", async () => {
    const { call, repo, assigner } = setup({ github: true });
    const { bounty } = (await (await call("POST", "/v1/bounties", post)).json()) as { bounty: { id: string } };
    const stored = (await repo.findById(bounty.id))!;
    await repo.update({ ...stored, status: "claimed" }, "unfunded");
    await repo.createClaim({ id: "c1", bountyId: bounty.id, userId: "github:awa", login: "awa", status: "active", expiresAt: "2026-10-20T20:00:00Z" });
    await assigner.addAssignees(post.repo, post.issue_number, ["awa"]);
    const res = await call("DELETE", `/v1/bounties/${bounty.id}`);
    expect(((await res.json()) as { bounty: { status: string } }).bounty.status).toBe("refunded");
    expect(await repo.activeClaim(bounty.id)).toBeUndefined();
    expect((await repo.findClaim("c1"))?.status).toBe("released");
    expect(await repo.listActiveClaims()).toEqual([]);
    expect(assigner.of(post.repo, post.issue_number)).toEqual([]);
  });
});

describe("errors", () => {
  it("GET /v1/budget answers JSON 500 when storage fails", async () => {
    const repo = new InMemoryBountyRepo();
    const service = new AgentService({
      repo,
      bus: { publish: () => undefined },
      spending: { committedThisMonth: async () => Promise.reject(new Error("db down")) },
      baseUrl: "https://b.test",
    });
    const routes = agentRoutes(new StaticAgentRegistry([agent()]), service);
    const res = await routes.request("/v1/budget", { headers: { authorization: `Bearer ${KEY}` } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});

describe("agentsFromEnv", () => {
  it("parses entries and rejects invalid ones loudly", () => {
    expect(agentsFromEnv(undefined)).toEqual([]);
    expect(agentsFromEnv(JSON.stringify([agent()]))).toEqual([agent()]);
    expect(() => agentsFromEnv("{oops")).toThrow(/not valid JSON/);
    expect(() => agentsFromEnv(JSON.stringify([{ ...agent(), keyHash: "short" }]))).toThrow(/keyHash/);
    expect(() => agentsFromEnv(JSON.stringify([{ ...agent(), allowedRepos: ["*"] }]))).toThrow(/invalid/);
    expect(() => agentsFromEnv(JSON.stringify([agent(), agent()]))).toThrow(/duplicate/);
    expect(() => agentsFromEnv(JSON.stringify([agent(), agent({ id: "44444444-4444-4444-8444-444444444444" })]))).toThrow(/same key/);
    const { allowedRepos: _drop, ...typo } = agent();
    expect(() => agentsFromEnv(JSON.stringify([{ ...typo, allowedRepo: ["a/b"] }]))).toThrow(/entry 0/);
  });

  it("monthStart is the first instant of the UTC month", () => {
    expect(monthStart(new Date("2026-10-17T20:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
