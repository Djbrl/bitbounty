import { describe, expect, it, vi } from "vitest";

vi.mock("./session-login", () => ({ sessionLogin: async () => "fatou" }));

import { ApiError, apiBaseUrl, apiGet, errorText, identityHeaders, load } from "./api";
import { proxy } from "./api-proxy";

const env = { BITBOUNTY_API_URL: "http://api.test/", INTERNAL_API_TOKEN: "tok" };

const fetchReturning = (status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}) =>
  (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return Response.json(body, { status });
  }) as unknown as typeof fetch;

describe("apiBaseUrl", () => {
  it("prefers BITBOUNTY_API_URL, falls back to NEXT_PUBLIC_API_URL, trims the slash, null when unset", () => {
    expect(apiBaseUrl({ BITBOUNTY_API_URL: "http://a/", NEXT_PUBLIC_API_URL: "http://b" })).toBe("http://a");
    expect(apiBaseUrl({ NEXT_PUBLIC_API_URL: " http://b// " })).toBe("http://b");
    expect(apiBaseUrl({})).toBeNull();
  });
});

describe("apiGet", () => {
  it("returns the JSON, sends the user only with the internal token", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    expect(await apiGet("/api/board", { env, user: "fatou", fetchImpl: fetchReturning(200, { ok: 1 }, seen) })).toEqual({ ok: 1 });
    expect(seen.url).toBe("http://api.test/api/board");
    expect(seen.init?.headers).toMatchObject({ authorization: "Bearer tok", "x-bitbounty-user": "fatou" });
    expect(identityHeaders("fatou", { BITBOUNTY_API_URL: "x" })).toEqual({});
    expect(identityHeaders(null, env)).toEqual({});
  });

  it("404 → null; 5xx → ApiError with the server's code", async () => {
    expect(await apiGet("/api/bounties/x", { env, fetchImpl: fetchReturning(404, { error: "bounty_not_found" }) })).toBeNull();
    await expect(apiGet("/api/board", { env, fetchImpl: fetchReturning(500, { error: "boom" }) })).rejects.toMatchObject({ status: 500, code: "boom" });
  });

  it("server down or too slow → ApiError the error page can explain", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = (await apiGet("/api/board", { env, fetchImpl: down }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("server_unreachable");
    expect(errorText(err)).toMatch(/ne répond pas/);

    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const timeout = (await apiGet("/api/board", { env, fetchImpl: slow, timeoutMs: 30 }).catch((e: unknown) => e)) as ApiError;
    expect(timeout.code).toBe("server_timeout");
    expect(errorText(timeout)).toMatch(/trop de temps/);
  });

  it("load() uses the fixtures when no server is configured", async () => {
    expect(await load("/api/board", () => ({ mock: true }), { env: {} })).toEqual({ mock: true });
  });
});

describe("proxy", () => {
  it("forwards method, body and query, re-encodes path segments, adds the session user", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    vi.stubEnv("INTERNAL_API_TOKEN", "tok");
    const req = new Request("http://web/api/bounties/b1/funding?x=1", {
      method: "POST",
      body: JSON.stringify({ rail: "lightning" }),
      headers: { "content-type": "application/json" },
    });
    const res = await proxy(req, "http://api.test", ["bounties", "b1/../..", "funding"], new URL(req.url), undefined, fetchReturning(200, { rail: "lightning" }, seen));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rail: "lightning" });
    expect(seen.url).toBe("http://api.test/api/bounties/b1%2F..%2F../funding?x=1");
    expect(seen.init?.method).toBe("POST");
    expect(seen.init?.body).toBe('{"rail":"lightning"}');
    expect(seen.init?.headers).toMatchObject({ "content-type": "application/json", authorization: "Bearer tok", "x-bitbounty-user": "fatou" });
    vi.unstubAllEnvs();
  });

  it("passes the server's status through, and answers 503 when the server is down", async () => {
    const req = new Request("http://web/api/me");
    const notFound = await proxy(req, "http://api.test", ["me"], new URL(req.url), null, fetchReturning(401, { error: "unauthorized" }));
    expect(notFound.status).toBe(401);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const res = await proxy(req, "http://api.test", ["me"], new URL(req.url), null, down);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "server_unreachable" });
  });

  it("streams /api/live as text/event-stream", async () => {
    const sse = (async () =>
      new Response("event: snapshot\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    const req = new Request("http://web/api/live");
    const res = await proxy(req, "http://api.test", ["live"], new URL(req.url), null, sse);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain("event: snapshot");
  });
});
