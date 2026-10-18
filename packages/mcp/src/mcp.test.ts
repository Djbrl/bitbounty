import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { BitbountyApi, assertSafeBaseUrl } from "./api.js";
import { createBitbountyServer } from "./server.js";

interface Seen {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
}

function fakeFetch(answer: (s: Seen) => { status: number; body: unknown }) {
  const seen: Seen[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const s: Seen = {
      method: init.method ?? "GET",
      url,
      auth: new Headers(init.headers).get("authorization"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(s);
    const a = answer(s);
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(fetchImpl: typeof fetch) {
  const api = new BitbountyApi({ baseUrl: "https://api.test/", agentKey: "bb_test", fetchImpl });
  const server = createBitbountyServer(api);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

describe("bitbounty MCP server", () => {
  it("lists the four tools", async () => {
    const c = await connect(fakeFetch(() => ({ status: 200, body: {} })).impl);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["cancel_bounty", "get_bounty", "get_budget", "post_bounty"]);
    const post = tools.find((t) => t.name === "post_bounty")!;
    expect(post.inputSchema.required).toEqual(expect.arrayContaining(["repo", "issue_number", "amount_xof", "criteria"]));
  });

  it("post_bounty forwards to POST /v1/bounties with the agent key and returns the bounty", async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 201, body: { bounty: { id: "b1", status: "unfunded", fund_url: "https://w/pay/b1" }, warnings: [] } }));
    const c = await connect(impl);
    const res = await c.callTool({
      name: "post_bounty",
      arguments: { repo: "galsen-oss/wolof-i18n", issue_number: 12, amount_xof: 10_000, criteria: ["Wolof strings added"] },
    });
    expect(res.isError).toBe(false);
    expect(text(res)).toContain("https://w/pay/b1");
    expect(seen[0]).toEqual({
      method: "POST",
      url: "https://api.test/v1/bounties",
      auth: "Bearer bb_test",
      body: { repo: "galsen-oss/wolof-i18n", issue_number: 12, amount_xof: 10_000, criteria: ["Wolof strings added"] },
    });
  });

  it("explains a refusal (over budget) as a tool error with a hint", async () => {
    const c = await connect(fakeFetch(() => ({ status: 403, body: { error: "over_budget", message: "only 5000 FCFA left" } })).impl);
    const res = await c.callTool({
      name: "post_bounty",
      arguments: { repo: "a/b", issue_number: 1, amount_xof: 10_000, criteria: ["x"] },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/HTTP 403.*over_budget[\s\S]*budget is used up/);
  });

  it("rejects bad arguments before calling the API", async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 201, body: {} }));
    const c = await connect(impl);
    const res = await c.callTool({ name: "post_bounty", arguments: { repo: "a/b", issue_number: 1, amount_xof: 10.5, criteria: [] } });
    expect(res.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("rejects an issue number Postgres can't store (2^31) before calling the API", async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 201, body: {} }));
    const c = await connect(impl);
    const res = await c.callTool({ name: "post_bounty", arguments: { repo: "a/b", issue_number: 2 ** 31, amount_xof: 10_000, criteria: ["x"] } });
    expect(res.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("get_bounty, cancel_bounty and get_budget hit the right endpoints (ids are URL-encoded)", async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    const c = await connect(impl);
    await c.callTool({ name: "get_bounty", arguments: { id: "b/../1" } });
    await c.callTool({ name: "cancel_bounty", arguments: { id: "b1", reason: "done in-house" } });
    await c.callTool({ name: "get_budget", arguments: {} });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET https://api.test/v1/bounties/b%2F..%2F1",
      "DELETE https://api.test/v1/bounties/b1",
      "GET https://api.test/v1/budget",
    ]);
    expect(seen[1]!.body).toEqual({ reason: "done in-house" });
  });

  it("reports an unreachable server instead of crashing", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const c = await connect(failing);
    const res = await c.callTool({ name: "get_budget", arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/network_error[\s\S]*BITBOUNTY_API_URL/);
  });
});

describe("BITBOUNTY_API_URL safety (the agent key is a bearer token)", () => {
  it.each([
    "https://api.example.com",
    "https://xxxx.trycloudflare.com/",
    "http://localhost:8787",
    "http://127.0.0.1:8787/",
    "http://[::1]:8787",
    "HTTP://LOCALHOST:8787",
  ])("accepts %s", (baseUrl) => {
    expect(() => assertSafeBaseUrl(baseUrl)).not.toThrow();
  });

  it.each([
    "http://api.example.com",
    "http://192.168.1.10:8787",
    "http://localhost.evil.com",
    "http://localhost@evil.com",
    "http://127.0.0.1.evil.com",
    "ftp://localhost",
    "ws://localhost:8787",
    "localhost:8787",
    "not a url",
    "",
  ])("rejects %s", (baseUrl) => {
    expect(() => assertSafeBaseUrl(baseUrl)).toThrow(/BITBOUNTY_API_URL/);
  });

  it("refuses to build a client for plain http on a public host, so the key is never sent", () => {
    const { impl, seen } = fakeFetch(() => ({ status: 200, body: {} }));
    expect(() => new BitbountyApi({ baseUrl: "http://api.example.com", agentKey: "bb_secret", fetchImpl: impl })).toThrow(/https/);
    expect(seen).toHaveLength(0);
  });

  it("does not echo the key or credentials in the error", () => {
    expect(() => assertSafeBaseUrl("http://user:pass@api.example.com")).toThrow(/http:\/\/api\.example\.com$/);
  });

  it("still talks to a local http server with the key", async () => {
    const { impl, seen } = fakeFetch(() => ({ status: 200, body: { remaining_xof: 1 } }));
    const res = await new BitbountyApi({ baseUrl: "http://localhost:8787/", agentKey: "bb_test", fetchImpl: impl }).getBudget();
    expect(res.ok).toBe(true);
    expect(seen[0]).toMatchObject({ url: "http://localhost:8787/v1/budget", auth: "Bearer bb_test" });
  });
});
