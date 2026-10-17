import { describe, expect, it } from "vitest";
import { githubProfileToSessionUser, sessionToUser, sessionUserFromToken } from "./session-user";

const profile = { id: 81234567, login: "awa-ndiaye", avatar_url: "https://avatars.githubusercontent.com/u/81234567?v=4", name: "Awa" };
const awa = { githubId: 81234567, login: "awa-ndiaye", avatarUrl: "https://avatars.githubusercontent.com/u/81234567?v=4" };

describe("githubProfileToSessionUser", () => {
  it("maps id / login / avatar_url to the core User fields", () => {
    expect(githubProfileToSessionUser(profile)).toEqual(awa);
  });

  it("accepts a numeric string id", () => {
    expect(githubProfileToSessionUser({ ...profile, id: "81234567" })?.githubId).toBe(81234567);
  });

  it("keeps the user without an avatar (null), but drops non-https avatars", () => {
    expect(githubProfileToSessionUser({ id: 1, login: "x" })).toEqual({ githubId: 1, login: "x", avatarUrl: null });
    expect(githubProfileToSessionUser({ id: 1, login: "x", avatar_url: "javascript:alert(1)" })?.avatarUrl).toBeNull();
  });

  it("rejects profiles without a usable id or login", () => {
    expect(githubProfileToSessionUser(null)).toBeNull();
    expect(githubProfileToSessionUser({ login: "x" })).toBeNull();
    expect(githubProfileToSessionUser({ id: 0, login: "x" })).toBeNull();
    expect(githubProfileToSessionUser({ id: -3, login: "x" })).toBeNull();
    expect(githubProfileToSessionUser({ id: 1.5, login: "x" })).toBeNull();
    expect(githubProfileToSessionUser({ id: "12abc", login: "x" })).toBeNull();
    expect(githubProfileToSessionUser({ id: 1, login: "  " })).toBeNull();
    expect(githubProfileToSessionUser({ id: 1, login: 42 })).toBeNull();
  });
});

describe("sessionUserFromToken", () => {
  it("reads back what the jwt callback stored", () => {
    expect(sessionUserFromToken({ sub: "81234567", ...awa, iat: 1, exp: 2 })).toEqual(awa);
  });

  it("returns null for a token from before W9 (no GitHub fields)", () => {
    expect(sessionUserFromToken({ sub: "1", name: "x" })).toBeNull();
    expect(sessionUserFromToken(null)).toBeNull();
  });
});

describe("sessionToUser", () => {
  it("maps an Auth.js session to the core User fields", () => {
    const session = { user: { name: "Awa", email: null, image: awa.avatarUrl, ...awa }, expires: "2026-10-24T00:00:00Z" };
    expect(sessionToUser(session)).toEqual(awa);
  });

  it("is null when signed out or the session lacks the GitHub identity", () => {
    expect(sessionToUser(null)).toBeNull();
    expect(sessionToUser(undefined)).toBeNull();
    expect(sessionToUser({ user: null })).toBeNull();
    expect(sessionToUser({ user: { login: "awa-ndiaye" } })).toBeNull();
  });
});
