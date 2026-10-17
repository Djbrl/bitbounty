// W9: maps the GitHub profile / Auth.js session to the `User` fields of packages/core.
// Pure functions (no next-auth import) so they are unit-tested on their own.
import type { User } from "@bitbounty/core";

/** What the session knows about the signed-in GitHub user (the "web/user link"). */
export type SessionUser = Pick<User, "githubId" | "login" | "avatarUrl">;

/** GitHub `GET /user` response, only the fields we read. */
export interface GithubProfileLike {
  id?: unknown;
  login?: unknown;
  avatar_url?: unknown;
}

function toGithubId(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function toLogin(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function toAvatarUrl(v: unknown): string | null {
  return typeof v === "string" && /^https:\/\//.test(v) ? v : null;
}

function build(id: unknown, login: unknown, avatar: unknown): SessionUser | null {
  const githubId = toGithubId(id);
  const l = toLogin(login);
  if (githubId === null || l === null) return null;
  return { githubId, login: l, avatarUrl: toAvatarUrl(avatar) };
}

/** GitHub OAuth profile (at sign-in) → SessionUser. Null if the profile is unusable. */
export function githubProfileToSessionUser(profile: GithubProfileLike | null | undefined): SessionUser | null {
  if (!profile) return null;
  return build(profile.id, profile.login, profile.avatar_url);
}

/** JWT payload (what we stored at sign-in) → SessionUser. Null for a token without our fields. */
export function sessionUserFromToken(token: Record<string, unknown> | null | undefined): SessionUser | null {
  if (!token) return null;
  return build(token.githubId, token.login, token.avatarUrl);
}

/** Auth.js session (from `auth()` or `req.auth`) → SessionUser, or null when signed out. */
export function sessionToUser(session: { user?: Partial<Record<keyof SessionUser, unknown>> | null } | null | undefined): SessionUser | null {
  const u = session?.user;
  if (!u) return null;
  return build(u.githubId, u.login, u.avatarUrl);
}
