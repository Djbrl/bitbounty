import { createHmac } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { BitnobClient, BitnobError, authHeaders, parseRetryAfter, readBitnobConfig, signature } from "../src/index.js";

const ID = "86f1b05e-2e35-40bf-a85d-fd3de44d216b";
const SECRET = "sk_test_secret";
const NOW = new Date("2026-10-17T15:00:00.123Z");

type Call = { url: string; init: RequestInit };

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json(200, { success: true, message: "ok", data, timestamp: NOW.toISOString() });

function client(fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof BitnobClient>[0]> = {}) {
  let n = 0;
  return new BitnobClient({
    clientId: ID,
    clientSecret: SECRET,
    fetch: fetchFn,
    now: () => NOW,
    nonce: () => `nonce${++n}`,
    retryDelayMs: 0,
    ...extra,
  });
}

const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe("signature", () => {
  it("is hex HMAC-SHA256 of CLIENT_ID:TIMESTAMP:NONCE:BODY keyed with the secret", () => {
    const expected = createHmac("sha256", SECRET).update(`${ID}:1792249200:abc:{"a":1}`).digest("hex");
    expect(signature(ID, SECRET, "1792249200", "abc", '{"a":1}')).toBe(expected);
  });

  it("uses Unix seconds, not milliseconds", () => {
    expect(authHeaders(ID, SECRET, "", NOW, "n")["x-auth-timestamp"]).toBe("1792249200");
  });

  it("generates a 32-char hex nonce by default, different each time", () => {
    const a = authHeaders(ID, SECRET, "")["x-auth-nonce"];
    const b = authHeaders(ID, SECRET, "")["x-auth-nonce"];
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("request", () => {
  it("signs a GET with an empty body and returns data", async () => {
    const { fetch, calls } = fakeFetch(ok({ client_name: "bitbounty", environment: "sandbox" }));
    const me = await client(fetch).whoami();
    expect(me.environment).toBe("sandbox");
    const c = calls[0]!;
    expect(c.url).toBe("https://api.bitnob.com/api/whoami");
    expect(c.init.method).toBe("GET");
    expect(c.init.body).toBeUndefined();
    expect(header(c, "x-auth-client")).toBe(ID);
    expect(header(c, "x-auth-signature")).toBe(signature(ID, SECRET, "1792249200", "nonce1", ""));
  });

  it("signs exactly the compact JSON string it sends", async () => {
    const { fetch, calls } = fakeFetch(ok({ quote: { id: "q1" } }));
    await client(fetch).createTradingQuote({ base_currency: "NGN", quote_currency: "BTC", side: "SELL", quantity: "5000" });
    const c = calls[0]!;
    const body = c.init.body as string;
    expect(body).toBe('{"base_currency":"NGN","quote_currency":"BTC","side":"SELL","quantity":"5000"}');
    expect(header(c, "content-type")).toBe("application/json");
    expect(header(c, "x-auth-signature")).toBe(signature(ID, SECRET, "1792249200", "nonce1", body));
  });

  it("POST without a body (simulate-deposit) signs an empty body", async () => {
    const { fetch, calls } = fakeFetch(ok({ transaction: { amount: "100000" }, new_balance: "100000" }));
    await client(fetch).simulateDeposit("va/1");
    const c = calls[0]!;
    expect(c.url).toBe("https://api.bitnob.com/api/virtual-accounts/va%2F1/simulate-deposit");
    expect(c.init.body).toBeUndefined();
    expect(header(c, "x-auth-signature")).toBe(signature(ID, SECRET, "1792249200", "nonce1", ""));
  });

  it("strips trailing slashes from the base URL", async () => {
    const { fetch, calls } = fakeFetch(ok({}));
    await client(fetch, { baseUrl: "https://example.test///" }).whoami();
    expect(calls[0]!.url).toBe("https://example.test/api/whoami");
  });

  it("unwraps nested resources", async () => {
    const { fetch } = fakeFetch(
      ok({ payout: { quote_id: "QT2_1" } }),
      ok({ virtual_account: { id: "va1" } }),
      ok({ banks: [{ bank_name: "Wave", bank_code: "WAVE" }] }),
      ok({ id: "inv1", request: "lnbc…" }),
      ok({ invoice: { id: "inv2" } }),
    );
    const c = client(fetch);
    expect((await c.createPayoutQuote({ from_asset: "USDT", to_currency: "XOF", country: "SN", source: "offchain", settlement_amount: "137", payment_reason: "bounty", reference: "r" })).quote_id).toBe("QT2_1");
    expect((await c.createVirtualAccount({ customer_id: "c", currency: "NGN", reference: "r" })).id).toBe("va1");
    expect(await c.getBanks("SN")).toEqual([{ bank_name: "Wave", bank_code: "WAVE" }]);
    expect((await c.createLightningInvoice({ customer_id: "c", amount: 1000, description: "d", expiry: 900, reference: "r" })).id).toBe("inv1");
    expect((await c.getLightningInvoice("inv2")).id).toBe("inv2");
  });
});

describe("errors (reviewer checklist)", () => {
  it("wrong secret: a clear BitnobError, not a crash, and never the secret", async () => {
    const { fetch } = fakeFetch(
      json(401, {
        type: "https://api.bitnob.com/errors/UNAUTHORIZED",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid HMAC signature",
        code: "UNAUTHORIZED",
        correlation_id: "req_1",
      }),
    );
    const err = await client(fetch).whoami().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BitnobError);
    expect(err).toMatchObject({ status: 401, code: "UNAUTHORIZED", detail: "Invalid HMAC signature", correlationId: "req_1" });
    expect((err as Error).message).toContain("check BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET");
    expect((err as Error).message).not.toContain(SECRET);
  });

  it("does not retry a 4xx", async () => {
    const { fetch, calls } = fakeFetch(json(400, { success: false, error: { code: "VALIDATION", message: "quantity is required" } }));
    const err = await client(fetch).whoami().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: "VALIDATION", detail: "quantity is required" });
    expect(calls).toHaveLength(1);
  });

  it("retries 5xx and network errors with a fresh nonce and signature each time", async () => {
    const { fetch, calls } = fakeFetch(json(503, { code: "UNAVAILABLE" }), new TypeError("fetch failed"), ok({ environment: "sandbox" }));
    await expect(client(fetch).whoami()).resolves.toMatchObject({ environment: "sandbox" });
    expect(calls).toHaveLength(3);
    const nonces = calls.map((c) => header(c, "x-auth-nonce"));
    const sigs = calls.map((c) => header(c, "x-auth-signature"));
    expect(new Set(nonces).size).toBe(3);
    expect(new Set(sigs).size).toBe(3);
  });

  it("gives up after the configured retries with the last error", async () => {
    const { fetch, calls } = fakeFetch(json(500, {}), json(500, {}));
    const err = await client(fetch, { retries: 1 }).whoami().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, code: "HTTP_500" });
    expect(calls).toHaveLength(2);
  });

  it("network failure becomes code NETWORK", async () => {
    const { fetch } = fakeFetch(new TypeError("getaddrinfo ENOTFOUND"));
    await expect(client(fetch, { retries: 0 }).whoami()).rejects.toMatchObject({ status: 0, code: "NETWORK" });
  });

  it("a timeout becomes code TIMEOUT", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const { fetch } = fakeFetch(timeout);
    await expect(client(fetch, { retries: 0 }).whoami()).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("an HTML error page doesn't crash JSON parsing", async () => {
    const { fetch } = fakeFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(client(fetch, { retries: 0 }).whoami()).rejects.toMatchObject({ status: 502, code: "HTTP_502", detail: "<html>Bad gateway</html>" });
  });

  it("a 200 that isn't JSON is BAD_RESPONSE", async () => {
    const { fetch } = fakeFetch(new Response("OK", { status: 200 }));
    await expect(client(fetch).whoami()).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("config", () => {
  it("reads and trims env vars", () => {
    expect(readBitnobConfig({ BITNOB_CLIENT_ID: ` ${ID} `, BITNOB_CLIENT_SECRET: `${SECRET}\n` })).toEqual({
      clientId: ID,
      clientSecret: SECRET,
      baseUrl: "https://api.bitnob.com",
    });
  });

  it("names the missing variables", () => {
    expect(() => readBitnobConfig({ BITNOB_CLIENT_ID: ID })).toThrow("Missing BITNOB_CLIENT_SECRET");
    expect(() => readBitnobConfig({})).toThrow("Missing BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET");
  });

  it("refuses an empty secret in the constructor", () => {
    expect(() => new BitnobClient({ clientId: ID, clientSecret: "" })).toThrow(BitnobError);
  });
});

describe("review fixes (F5 post-merge)", () => {
  it("never exposes the secret through inspect, JSON.stringify or keys", () => {
    const c = client(fakeFetch().fetch);
    expect(inspect(c, { depth: 10, showHidden: true })).not.toContain(SECRET);
    expect(JSON.stringify(c)).not.toContain(SECRET);
    expect(JSON.stringify(Object.entries(c))).not.toContain(SECRET);
    expect(String(c)).not.toContain(SECRET);
  });

  it("still signs with the secret held in the private field", async () => {
    const { fetch, calls } = fakeFetch(ok({ environment: "sandbox" }));
    await client(fetch).whoami();
    const c = calls[0]!;
    const expected = createHmac("sha256", SECRET)
      .update(`${ID}:${header(c, "x-auth-timestamp")}:${header(c, "x-auth-nonce")}:`)
      .digest("hex");
    expect(header(c, "x-auth-signature")).toBe(expected);
  });

  it("getBanks returns [] when the sandbox answers banks: null", async () => {
    const { fetch } = fakeFetch(ok({ banks: null }));
    expect(await client(fetch).getBanks("SN")).toEqual([]);
  });

  it("honours Retry-After (seconds) on 429", async () => {
    const waits: number[] = [];
    const { fetch, calls } = fakeFetch(
      new Response("{}", { status: 429, headers: { "retry-after": "7" } }),
      ok({ environment: "sandbox" }),
    );
    const c = client(fetch, { sleep: async (ms) => void waits.push(ms) });
    await expect(c.whoami()).resolves.toMatchObject({ environment: "sandbox" });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([7000]);
  });

  it("honours Retry-After as an HTTP date, capped by maxRetryAfterMs", async () => {
    const waits: number[] = [];
    const later = new Date(NOW.getTime() + 120_000).toUTCString();
    const { fetch } = fakeFetch(
      new Response("{}", { status: 429, headers: { "retry-after": later } }),
      ok({}),
    );
    await client(fetch, { sleep: async (ms) => void waits.push(ms), maxRetryAfterMs: 5_000 }).whoami();
    expect(waits).toEqual([5_000]);
  });

  it("falls back to the backoff without (or with a bad) Retry-After", async () => {
    const waits: number[] = [];
    const { fetch } = fakeFetch(
      new Response("{}", { status: 429, headers: { "retry-after": "soon" } }),
      json(429, {}),
      ok({}),
    );
    await client(fetch, { sleep: async (ms) => void waits.push(ms), retryDelayMs: 100 }).whoami();
    expect(waits).toEqual([100, 200]);
  });

  it("parseRetryAfter", () => {
    expect(parseRetryAfter(null, NOW, 30_000)).toBeUndefined();
    expect(parseRetryAfter("2", NOW, 30_000)).toBe(2000);
    expect(parseRetryAfter("0", NOW, 30_000)).toBe(0);
    expect(parseRetryAfter("3600", NOW, 30_000)).toBe(30_000);
    expect(parseRetryAfter(new Date(NOW.getTime() - 5000).toUTCString(), NOW, 30_000)).toBe(0);
    expect(parseRetryAfter("-1", NOW, 30_000)).toBeUndefined();
  });
});
