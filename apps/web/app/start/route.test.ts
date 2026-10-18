import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  signIn: vi.fn(async (_provider: string, opts: { redirectTo: string }) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to: `https://github.com/login/oauth/authorize?then=${opts.redirectTo}` });
  }),
}));
vi.mock("../../lib/session-login", () => ({ sessionUser: mocks.sessionUser }));
vi.mock("../../auth", () => ({ signIn: mocks.signIn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

import { GET } from "./route";

/** Where GET /start?… sends the browser (redirect() and signIn() both throw a redirect). */
async function start(query: string): Promise<string> {
  try {
    await GET(new Request(`http://localhost:3102/start${query}`));
  } catch (e) {
    return (e as { to: string }).to;
  }
  throw new Error("no redirect");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/start (landing CTAs)", () => {
  it("signed out: GitHub sign-in that comes back to /welcome with the CTA's intent", async () => {
    vi.stubEnv("AUTH_SECRET", "s3cret");
    mocks.sessionUser.mockResolvedValue(null);
    expect(await start("?intent=maintain")).toContain("github.com/login/oauth/authorize");
    expect(mocks.signIn).toHaveBeenLastCalledWith("github", { redirectTo: "/welcome?intent=maintain" });
    await start("?intent=hunt");
    expect(mocks.signIn).toHaveBeenLastCalledWith("github", { redirectTo: "/welcome?intent=hunt" });
    await start("");
    expect(mocks.signIn).toHaveBeenLastCalledWith("github", { redirectTo: "/app" });
  });

  it("ignores an unknown intent (no open redirect, no odd onboarding)", async () => {
    vi.stubEnv("AUTH_SECRET", "s3cret");
    mocks.sessionUser.mockResolvedValue(null);
    await start("?intent=https://evil.example");
    expect(mocks.signIn).toHaveBeenLastCalledWith("github", { redirectTo: "/app" });
  });

  it("signed in: no second sign-in, straight to the same place (middleware forwards onboarded users)", async () => {
    vi.stubEnv("AUTH_SECRET", "s3cret");
    mocks.sessionUser.mockResolvedValue({ user: { login: "awa" }, preferences: { defaultMode: null, onboardedAt: null } });
    expect(await start("?intent=hunt")).toBe("/welcome?intent=hunt");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("auth off (local fixtures): skips sign-in", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(await start("?intent=maintain")).toBe("/welcome?intent=maintain");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
