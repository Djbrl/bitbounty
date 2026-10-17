// W9: which pages need a GitHub session, and where to send people who don't have one.
// Pure functions (no next-auth import) so they are unit-tested on their own.

/** Path prefixes that require sign-in. Everything else stays public. Keep in sync with `config.matcher` in middleware.ts. */
export const PROTECTED_PREFIXES = ["/dashboard", "/me"] as const;

export const SIGN_IN_PATH = "/signin";

/** True for `/dashboard`, `/dashboard/...`, `/me`, `/me/...`; false for `/meetup`, `/b/1`, `/api/me`, etc. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Auth is switched on only when AUTH_SECRET is set. Without it (local dev on fixtures)
 * middleware lets every page through and the sign-in UI explains how to enable it.
 */
export function authEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.AUTH_SECRET && env.AUTH_SECRET.trim());
}

/** Only same-site relative paths are allowed as a post-sign-in destination (no open redirect). */
export function safeCallbackUrl(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

/** `/signin?callbackUrl=<original path + query>` on the same origin as `url`. */
export function signInRedirectUrl(url: URL): URL {
  const target = new URL(SIGN_IN_PATH, url.origin);
  target.searchParams.set("callbackUrl", `${url.pathname}${url.search}`);
  return target;
}

/** Relative `/signin?callbackUrl=<pathname>` (client side, no origin needed): signing in again brings the user back. */
export function signInHref(pathname: string | null | undefined): string {
  return `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(safeCallbackUrl(pathname))}`;
}

/** Human message for the `?error=` code Auth.js appends when sending people back to /signin. */
export function signInErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "OAuthCallbackError":
    case "AccessDenied":
      return "GitHub sign-in was cancelled or refused. You can try again.";
    case "Configuration":
      return "Sign-in is misconfigured on the server (check AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET).";
    case "MissingCSRF":
      return "Your sign-in form expired. Please try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
