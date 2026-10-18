import { describe, expect, it } from "vitest";
import { authEnabled, isCancelledSignIn, isProtectedPath, safeCallbackUrl, signInErrorMessage, signInRedirectUrl } from "./paths";

describe("isProtectedPath", () => {
  it.each([
    "/dashboard",
    "/dashboard/",
    "/dashboard/acme/repo",
    "/me",
    "/me/",
    "/me/payout",
    "/app",
    "/app/maintain",
    "/app/hunt/b-101",
    "/welcome",
    "/settings",
  ])("protects %s", (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });

  it.each(["/", "/signin", "/b/42", "/pay/42", "/board", "/live", "/meetup", "/dashboards", "/api/me", "/explore", "/application", "/welcomes", "/start", "/api/auth/session", "/api/health"])(
    "leaves %s public",
    (p) => {
      expect(isProtectedPath(p)).toBe(false);
    },
  );
});

describe("authEnabled", () => {
  it("is off without AUTH_SECRET (local dev on fixtures)", () => {
    expect(authEnabled({})).toBe(false);
    expect(authEnabled({ AUTH_SECRET: "" })).toBe(false);
    expect(authEnabled({ AUTH_SECRET: "   " })).toBe(false);
  });
  it("is on with AUTH_SECRET", () => {
    expect(authEnabled({ AUTH_SECRET: "s3cret" })).toBe(true);
  });
});

describe("signInRedirectUrl", () => {
  it("keeps the original path and query as callbackUrl", () => {
    const u = signInRedirectUrl(new URL("https://bitbounty-app.vercel.app/dashboard/acme?tab=paid"));
    expect(u.origin).toBe("https://bitbounty-app.vercel.app");
    expect(u.pathname).toBe("/signin");
    expect(u.searchParams.get("callbackUrl")).toBe("/dashboard/acme?tab=paid");
  });
});

describe("safeCallbackUrl", () => {
  it("allows same-site paths", () => {
    expect(safeCallbackUrl("/me")).toBe("/me");
    expect(safeCallbackUrl("/dashboard?x=1")).toBe("/dashboard?x=1");
  });
  it("blocks open redirects", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined, null]) {
      expect(safeCallbackUrl(bad)).toBe("/");
    }
  });
});

describe("signInErrorMessage", () => {
  it("treats a GitHub cancel or refusal as a cancel (back to the landing), not an error", () => {
    expect(isCancelledSignIn("OAuthCallbackError")).toBe(true);
    expect(isCancelledSignIn("AccessDenied")).toBe(true);
    expect(isCancelledSignIn("Configuration")).toBe(false);
    expect(isCancelledSignIn(undefined)).toBe(false);
  });
  it("explains the real errors", () => {
    expect(signInErrorMessage("Configuration")).toMatch(/misconfigured/);
    expect(signInErrorMessage("MissingCSRF")).toMatch(/expired/);
  });
  it("has a generic fallback and nothing without an error", () => {
    expect(signInErrorMessage("Whatever")).toMatch(/failed/);
    expect(signInErrorMessage(undefined)).toBeNull();
  });
});
