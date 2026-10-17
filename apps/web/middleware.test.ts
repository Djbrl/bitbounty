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
  it("matcher covers exactly the protected prefixes", () => {
    expect(config.matcher).toEqual(PROTECTED_PREFIXES.map((p) => `${p}/:path*`));
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
