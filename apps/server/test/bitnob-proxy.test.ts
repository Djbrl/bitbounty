import { BitnobClient, signature } from "@bitbounty/bitnob";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bitnobProxyRoutes, checkPath, tokenMatches } from "../src/dev/bitnob-proxy.js";

const TOKEN = "proxy-test-token-0123456789abcdef";
const ID = "client-id-test";
const SECRET = "sk_test_secret";
const BASE = "https://api.bitnob.com";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
type Reply = Response | Error | "hang";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const WHOAMI = (environment: string) => json(200, { success: true, data: { client_name: "t", environment } });

/** A fake Bitnob: answers in order, records every call. "hang" never answers (respects the abort signal). */
function fakeBitnob(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const next = replies.shift();
    if (!next) throw new Error("fake Bitnob: no more replies");
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function proxy(replies: Reply[], extra: Partial<Parameters<typeof bitnobProxyRoutes>[0]> = {}) {
  const upstream = fakeBitnob(...replies);
  const lines: string[] = [];
  let n = 0;
  const client = new BitnobClient({
    clientId: ID,
    clientSecret: SECRET,
    baseUrl: BASE,
    fetch: upstream.fetch,
    nonce: () => `nonce${++n}`,
  });
  const app = bitnobProxyRoutes({ token: TOKEN, client, log: (l) => lines.push(l), ...extra });
  return { app, upstream, lines };
}

const auth = { authorization: `Bearer ${TOKEN}` };
/** Sends `rawUrl` as the raw request line, the way @hono/node-server exposes it (`c.env.incoming.url`). */
const raw = (app: ReturnType<typeof bitnobProxyRoutes>, rawUrl: string, init: RequestInit = {}) =>
  app.request(rawUrl.replace(/^\/+/, "/"), init, { incoming: { url: rawUrl } });

describe("F7 dev proxy: mounting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is 404 when DEV_PROXY_TOKEN is not set", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("DEV_PROXY_TOKEN", "");
    const { app } = await import("../src/app.js");
    expect((await app.request("/dev/bitnob/api/whoami", { headers: auth })).status).toBe(404);
  });

  it("is mounted when DEV_PROXY_TOKEN is set (503 without Bitnob keys, 401 without token)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("BITNOB_CLIENT_ID", "");
    vi.stubEnv("BITNOB_CLIENT_SECRET", "");
    vi.stubEnv("DEV_PROXY_TOKEN", TOKEN);
    const { app } = await import("../src/app.js");
    expect((await app.request("/dev/bitnob/api/whoami")).status).toBe(401);
    expect((await app.request("/dev/bitnob/api/whoami", { headers: auth })).status).toBe(503);
    expect((await app.request("/health")).status).toBe(200);
  });
});

describe("F7 dev proxy: token", () => {
  it.each([
    ["missing", undefined],
    ["wrong", "Bearer nope"],
    ["prefix of the real one", `Bearer ${TOKEN.slice(0, -1)}`],
    ["longer than the real one", `Bearer ${TOKEN}x`],
    ["without the Bearer scheme", TOKEN],
    ["empty", "Bearer "],
  ])("answers 401 when the token is %s, without calling Bitnob", async (_, header) => {
    const { app, upstream } = proxy([]);
    const res = await app.request("/dev/bitnob/api/whoami", { headers: header ? { authorization: header } : {} });
    expect(res.status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });

  it("compares in constant time: tokens of any length go through the same hash + timingSafeEqual", () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${"x".repeat(5000)}`, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });

  it("checks the token before reading a huge body", async () => {
    const { app, upstream } = proxy([]);
    const res = await app.request("/dev/bitnob/api/customers", { method: "POST", body: "x".repeat(5_000_000) });
    expect(res.status).toBe(401);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe("F7 dev proxy: forwarding", () => {
  it("re-signs with the server's keys, forwards method/path/query/body, returns status and body unchanged", async () => {
    const invoice = { success: true, data: { invoice: { id: "inv1", request: "lntb1..." } } };
    const { app, upstream } = proxy([WHOAMI("sandbox"), json(201, invoice)]);
    const res = await app.request("/dev/bitnob/api/lightning/invoices?x=1", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", "x-auth-signature": "caller-forged" },
      body: '{ "customer_id": "c1",  "amount": 1000 }',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(invoice);
    const call = upstream.calls[1]!;
    expect(call.url).toBe(`${BASE}/api/lightning/invoices?x=1`);
    expect(call.method).toBe("POST");
    expect(call.body).toBe('{"customer_id":"c1","amount":1000}');
    const h = call.headers;
    expect(h["x-auth-client"]).toBe(ID);
    expect(h["x-auth-signature"]).toBe(signature(ID, SECRET, h["x-auth-timestamp"]!, h["x-auth-nonce"]!, call.body!));
    expect(h.authorization).toBeUndefined(); // the team token never reaches Bitnob
  });

  it("checks whoami once and caches it", async () => {
    const { app, upstream } = proxy([WHOAMI("sandbox"), json(200, { a: 1 }), json(200, { a: 2 })]);
    await app.request("/dev/bitnob/api/balances", { headers: auth });
    await app.request("/dev/bitnob/api/balances", { headers: auth });
    expect(upstream.calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/whoami", "/api/balances", "/api/balances"]);
  });

  it("refuses every call with 403 when the keys are production keys", async () => {
    const { app, upstream } = proxy([WHOAMI("production")]);
    for (const path of ["/dev/bitnob/api/whoami", "/dev/bitnob/api/balances", "/dev/bitnob/api/lightning/invoices"]) {
      expect((await app.request(path, { method: "GET", headers: auth })).status).toBe(403);
    }
    expect(upstream.calls).toHaveLength(1); // whoami only, cached
  });

  it("passes a Bitnob 5xx through unchanged and never retries (POST or GET)", async () => {
    const { app, upstream } = proxy([WHOAMI("sandbox"), json(503, { title: "down" }), json(500, { title: "boom" })]);
    const post = await app.request("/dev/bitnob/api/customers", { method: "POST", headers: auth, body: "{}" });
    expect(post.status).toBe(503);
    expect(await post.json()).toEqual({ title: "down" });
    const get = await app.request("/dev/bitnob/api/balances", { headers: auth });
    expect(get.status).toBe(500);
    expect(upstream.calls).toHaveLength(3);
  });

  it("answers 504 when Bitnob is slow, after one attempt", async () => {
    const { app, upstream } = proxy([WHOAMI("sandbox"), "hang"], { timeoutMs: 50 });
    const res = await app.request("/dev/bitnob/api/customers", { method: "POST", headers: auth, body: "{}" });
    expect(res.status).toBe(504);
    expect(upstream.calls).toHaveLength(2);
  });

  it("answers 502 when Bitnob is unreachable, and retries whoami on the next call", async () => {
    const { app, upstream } = proxy([new TypeError("ECONNREFUSED"), WHOAMI("sandbox"), json(200, {})]);
    expect((await app.request("/dev/bitnob/api/balances", { headers: auth })).status).toBe(502);
    expect((await app.request("/dev/bitnob/api/balances", { headers: auth })).status).toBe(200);
    expect(upstream.calls).toHaveLength(3);
  });

  it("refuses a body over the limit with 413", async () => {
    const { app, upstream } = proxy([], { maxBodyBytes: 1024 });
    const res = await app.request("/dev/bitnob/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ pad: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
    expect(upstream.calls).toHaveLength(0);
  });

  it("refuses a non-JSON body with 400", async () => {
    const { app, upstream } = proxy([]);
    const res = await app.request("/dev/bitnob/api/customers", { method: "POST", headers: auth, body: "a=b" });
    expect(res.status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });

  it("logs one line per call with user, method, path, status and ms, never the token, query or body", async () => {
    const { app, lines } = proxy([WHOAMI("sandbox"), json(200, {})]);
    await app.request("/dev/bitnob/api/customers?email=secret%40x.sn", {
      method: "POST",
      headers: { ...auth, "x-dev-user": "awa" },
      body: '{"email":"body-secret@x.sn"}',
    });
    await app.request("/dev/bitnob/api/whoami");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[dev-proxy\] user=awa POST \/dev\/bitnob\/api\/customers -> 200 \d+ms$/);
    expect(lines[1]).toMatch(/user=- GET \/dev\/bitnob\/api\/whoami -> 401/);
    const all = lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("secret");
  });
});

describe("F7 dev proxy: paths", () => {
  it.each([
    "/dev/bitnob/../../api/whoami",
    "/dev/bitnob/../health",
    "/dev/bitnob/api/../../api/whoami",
    "/dev/bitnob/%2e%2e/%2e%2e/api/whoami",
    "/dev/bitnob/api/%2E%2E/api-keys",
    "/dev/bitnob/api/whoami/..%2f..%2fapi-keys",
    "/dev/bitnob/api/whoami%2f..",
    "/dev/bitnob/api/x%5c..%5cy",
    "/dev/bitnob/https://evil.example/api/whoami",
    "/dev/bitnob//evil.example/api/whoami",
    "/dev/bitnob/api//evil.example",
    "/dev/bitnob/whoami",
    "/dev/bitnob/",
    "http://evil.example/dev/bitnob/api/whoami",
  ])("refuses %s with 400 and calls nobody", async (url) => {
    const { app, upstream } = proxy([WHOAMI("sandbox"), json(200, {})]);
    const res = await raw(app, url, { headers: auth });
    expect(res.status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });

  it.each([
    "/dev/bitnob/api/api-keys",
    "/dev/bitnob/api/apiKeys/1",
    "/dev/bitnob/api/api_keys",
    "/dev/bitnob/api/webhooks",
    "/dev/bitnob/api/webhook-settings",
    "/dev/bitnob/api/settings",
    "/dev/bitnob/api/settings/webhook",
    "/dev/bitnob/api/account/settings",
    "/dev/bitnob/api/company/whitelist",
    "/dev/bitnob/api/team/members",
  ])("blocks %s with 403", async (url) => {
    const { app, upstream } = proxy([WHOAMI("sandbox"), json(200, {})]);
    for (const method of ["GET", "POST", "DELETE"]) {
      const res = await app.request(url, { method, headers: auth, body: method === "GET" ? undefined : "{}" });
      expect(res.status).toBe(403);
    }
    expect(upstream.calls).toHaveLength(0);
  });

  it("only ever calls the configured Bitnob host, under /api/", async () => {
    const { app, upstream } = proxy([WHOAMI("sandbox"), json(200, {}), json(200, {})]);
    await app.request("/dev/bitnob/api/payouts/banks/SN", { headers: auth });
    await app.request("/dev/bitnob/api/exchange-rates?from=BTC&to=XOF", { headers: auth });
    for (const c of upstream.calls) expect(c.url.startsWith(`${BASE}/api/`)).toBe(true);
  });

  it("allows the normal BitnobClient paths", () => {
    for (const p of [
      "/api/whoami",
      "/api/customers",
      "/api/lightning/invoices/01a14b97-b6a9-7fa0-b3fc-3836b983fa04",
      "/api/payouts/QT2_21052948/finalize",
      "/api/payouts/account-lookup",
      "/api/virtual-accounts/abc/simulate-deposit",
      "/api/trading/prices",
    ]) {
      expect(checkPath(p)).toBeNull();
    }
  });
});

describe("F7 teammate side: BitnobClient in proxy mode, end to end", () => {
  it("works unchanged against the proxy: bearer token, no local signing, data unwrapped", async () => {
    const { app, upstream, lines } = proxy([WHOAMI("sandbox"), json(200, { success: true, data: { invoice: { id: "inv9" } } })]);
    // The teammate's fetch lands on the proxy app instead of the network.
    const teammateFetch = (async (url: string | URL | Request, init?: RequestInit) =>
      app.request(String(url).replace("https://tunnel.example", ""), init)) as typeof fetch;
    const teammate = new BitnobClient({
      clientId: "",
      clientSecret: "",
      baseUrl: "https://tunnel.example/dev/bitnob",
      proxyToken: TOKEN,
      proxyUser: "moussa",
      fetch: teammateFetch,
    });
    const inv = await teammate.createLightningInvoice({
      customer_id: "c1",
      amount: 1000,
      description: "t",
      expiry: 600,
      reference: "r1",
    });
    expect(inv.id).toBe("inv9");
    expect(upstream.calls[1]!.headers["x-auth-client"]).toBe(ID);
    expect(lines[0]).toMatch(/user=moussa POST \/dev\/bitnob\/api\/lightning\/invoices -> 200/);
  });
});
