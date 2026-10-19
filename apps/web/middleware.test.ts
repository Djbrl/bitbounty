import { afterEach, describe, expect, it, vi } from "vitest";

// Auth.js reads AUTH_SECRET when auth.ts is imported, so set it before the imports below.
// `authEnabled()` reads it on each request, which is what the no-op test toggles.
const SECRET = vi.hoisted(() => {
  const s = "test-secret-for-vitest-only-0123456789";
  process.env.AUTH_SECRET = s;
  return s;
});

import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import middleware, { config } from "./middleware";
import { PROTECTED_PREFIXES } from "./lib/auth/paths";

// Next sets host / x-forwarded-proto on real requests; Auth.js uses them to pick the cookie name.
const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3100"), {
    headers: { host: "localhost:3100", "x-forwarded-proto": "http", ...(cookie ? { cookie } : {}) },
  });

afterEach(() => vi.unstubAllEnvs());

describe("middleware", () => {
  it("matcher covers every page, including the protected prefixes, but never /api, /_next or files", () => {
    // Next compiles the matcher with path-to-regexp; for this pattern a plain anchored RegExp behaves the same.
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const p of PROTECTED_PREFIXES) expect(re.test(`${p}/x`)).toBe(true);
    for (const path of ["/", "/explore", "/b/42", "/signin", "/maintenance"]) expect(re.test(path)).toBe(true);
    for (const path of ["/api/waitlist", "/api/bounties/1", "/_next/static/x.js", "/landing/bitnob-logo-white.svg", "/favicon.ico"])
      expect(re.test(path)).toBe(false);
  });

  it("shows /maintenance for every page while MAINTENANCE_MODE is on, before any sign-in check", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("MAINTENANCE_MODE", "1");
    for (const path of ["/", "/app/hunt", "/dashboard", "/b/42?x=1"]) {
      const res = await middleware(req(path));
      expect(res?.headers.get("location")).toBeNull();
      expect(new URL(res!.headers.get("x-middleware-rewrite")!).pathname).toBe("/maintenance");
      expect(res?.headers.get("x-robots-tag")).toBe("noindex");
    }
    const page = await middleware(req("/maintenance"));
    expect(page?.headers.get("x-middleware-next")).toBe("1");
    expect(page?.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("ignores MAINTENANCE_MODE when it isn't 1/true/on", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("MAINTENANCE_MODE", "0");
    const res = await middleware(req("/"));
    expect(res?.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("is a no-op when AUTH_SECRET is unset", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const res = await middleware(req("/dashboard"));
    expect(res?.headers.get("location")).toBeNull();
    expect(res?.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a signed-out visitor of /dashboard and /me to /signin", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    for (const path of ["/dashboard", "/me/payout?step=2"]) {
      const res = await middleware(req(path));
      expect(res?.status).toBe(307);
      const loc = new URL(res!.headers.get("location")!);
      expect(loc.pathname).toBe("/signin");
      expect(loc.searchParams.get("callbackUrl")).toBe(path);
    }
  });

  it("lets a signed-in user through, and treats an expired session as signed out", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const user = { githubId: 81234567, login: "awa-ndiaye", avatarUrl: null };
    const cookie = async (maxAge: number) =>
      `authjs.session-token=${await encode({ token: { sub: "81234567", ...user }, secret: SECRET, salt: "authjs.session-token", maxAge })}`;

    const ok = await middleware(req("/dashboard", await cookie(3600)));
    expect(ok?.headers.get("location")).toBeNull();

    const expired = await middleware(req("/dashboard", await cookie(-60)));
    expect(expired?.status).toBe(307);
    expect(new URL(expired!.headers.get("location")!).pathname).toBe("/signin");
  });

  it("lets public pages through even with auth on", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const res = await middleware(req("/b/42"));
    expect(res?.headers.get("location")).toBeNull();
  });
});
