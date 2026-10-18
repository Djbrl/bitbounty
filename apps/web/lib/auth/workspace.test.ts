import { describe, expect, it } from "vitest";
import {
  appHomePath,
  isOnboarded,
  NOT_ONBOARDED,
  onboardingRedirect,
  parseMode,
  preferencesFrom,
  startTarget,
  welcomePath,
  workspacePath,
} from "./workspace";

const onboarded = (mode: "hunt" | "maintain") => ({ defaultMode: mode, onboardedAt: "2026-10-18T09:00:00.000Z" });

describe("parseMode / preferencesFrom", () => {
  it("accepts only hunt and maintain", () => {
    expect(parseMode("hunt")).toBe("hunt");
    expect(parseMode("maintain")).toBe("maintain");
    for (const bad of ["admin", "HUNT", "", null, undefined, 1, ["hunt"]]) expect(parseMode(bad)).toBeNull();
  });

  it("reads both fields from a token or session.user; half-set or junk counts as not onboarded", () => {
    expect(preferencesFrom(onboarded("maintain"))).toEqual(onboarded("maintain"));
    expect(preferencesFrom({ defaultMode: "hunt", onboardedAt: null })).toEqual(NOT_ONBOARDED);
    expect(preferencesFrom({ defaultMode: "boss", onboardedAt: "2026-10-18T09:00:00Z" })).toEqual(NOT_ONBOARDED);
    expect(preferencesFrom({ defaultMode: "hunt", onboardedAt: "yesterday" })).toEqual(NOT_ONBOARDED);
    expect(preferencesFrom(null)).toEqual(NOT_ONBOARDED);
    expect(isOnboarded(onboarded("hunt"))).toBe(true);
    expect(isOnboarded(NOT_ONBOARDED)).toBe(false);
  });
});

describe("paths", () => {
  it("builds the workspace and welcome paths", () => {
    expect(workspacePath("hunt")).toBe("/app/hunt");
    expect(welcomePath("maintain")).toBe("/welcome?intent=maintain");
    expect(welcomePath(null)).toBe("/welcome");
  });

  it("/app opens the default mode once onboarded, onboarding before", () => {
    expect(appHomePath(onboarded("maintain"))).toBe("/app/maintain");
    expect(appHomePath(onboarded("hunt"))).toBe("/app/hunt");
    expect(appHomePath(NOT_ONBOARDED)).toBe("/welcome");
  });

  it("a CTA lands on /welcome with its intent; no intent → /app", () => {
    expect(startTarget("maintain")).toBe("/welcome?intent=maintain");
    expect(startTarget("hunt")).toBe("/welcome?intent=hunt");
    expect(startTarget(null)).toBe("/app");
  });
});

describe("onboardingRedirect (middleware, signed in)", () => {
  it("sends /app to the user's home", () => {
    expect(onboardingRedirect("/app", onboarded("maintain"))).toBe("/app/maintain");
    expect(onboardingRedirect("/app/", NOT_ONBOARDED)).toBe("/welcome");
  });

  it("skips /welcome for an onboarded user, keeps it for a new one", () => {
    expect(onboardingRedirect("/welcome", onboarded("hunt"))).toBe("/app/hunt");
    expect(onboardingRedirect("/welcome", NOT_ONBOARDED)).toBeNull();
  });

  it("leaves deep links alone, onboarded or not (the mode is only a default view)", () => {
    for (const p of ["/app/maintain", "/app/hunt/b-101", "/settings", "/dashboard", "/me"]) {
      expect(onboardingRedirect(p, NOT_ONBOARDED)).toBeNull();
      expect(onboardingRedirect(p, onboarded("hunt"))).toBeNull();
    }
  });
});
