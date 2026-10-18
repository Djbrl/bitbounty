import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  savePreferences: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../lib/session-login", () => ({ sessionUser: mocks.sessionUser }));
vi.mock("../../lib/auth/preferences", () => ({ savePreferences: mocks.savePreferences }));
vi.mock("../../auth", () => ({ unstable_update: mocks.update }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

import { completeOnboarding } from "./actions";
import WelcomePage from "./page";

async function submit(mode: string): Promise<string> {
  const form = new FormData();
  form.set("mode", mode);
  try {
    await completeOnboarding(form);
  } catch (e) {
    return (e as { to: string }).to;
  }
  throw new Error("no redirect");
}

const awa = { user: { githubId: 1, login: "awa", avatarUrl: null }, preferences: { defaultMode: null, onboardedAt: null } };

afterEach(() => vi.clearAllMocks());

describe("completeOnboarding", () => {
  it("stores the mode on the server, copies it into the session and opens the workspace", async () => {
    const stored = { defaultMode: "maintain", onboardedAt: "2026-10-18T09:00:00.000Z" };
    mocks.sessionUser.mockResolvedValue(awa);
    mocks.savePreferences.mockResolvedValue(stored);
    expect(await submit("maintain")).toBe("/app/maintain");
    expect(mocks.savePreferences).toHaveBeenCalledWith("awa", "maintain");
    expect(mocks.update).toHaveBeenCalledWith({ user: stored });
  });

  it("without a server copy, the session still remembers it (onboardedAt stamped now)", async () => {
    mocks.sessionUser.mockResolvedValue(awa);
    mocks.savePreferences.mockResolvedValue(null);
    expect(await submit("hunt")).toBe("/app/hunt");
    const { user } = mocks.update.mock.calls[0]![0] as { user: { defaultMode: string; onboardedAt: string } };
    expect(user.defaultMode).toBe("hunt");
    expect(Date.parse(user.onboardedAt)).not.toBeNaN();
  });

  it("refuses an unknown mode, and needs no session when auth is off", async () => {
    expect(await submit("admin")).toBe("/welcome");
    expect(mocks.savePreferences).not.toHaveBeenCalled();
    mocks.sessionUser.mockResolvedValue(null);
    expect(await submit("hunt")).toBe("/app/hunt");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("/welcome placeholder", () => {
  it("puts the landing CTA's intent first", async () => {
    mocks.sessionUser.mockResolvedValue(awa);
    const hunt = renderToStaticMarkup(await WelcomePage({ searchParams: Promise.resolve({ intent: "hunt" }) }));
    expect(hunt).toContain("Bienvenue, @awa");
    expect(hunt.indexOf('value="hunt"')).toBeLessThan(hunt.indexOf('value="maintain"'));
    const maintain = renderToStaticMarkup(await WelcomePage({ searchParams: Promise.resolve({ intent: "maintain" }) }));
    expect(maintain.indexOf('value="maintain"')).toBeLessThan(maintain.indexOf('value="hunt"'));
  });
});
