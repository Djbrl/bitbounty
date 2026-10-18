// W9: /dashboard, /me need a GitHub session; L1 adds /app, /welcome, /settings. Everything else is public.
// L1: signed in, `/app` goes to the user's default mode (or /welcome), and /welcome sends an
// onboarded user to their workspace.
// No-op when AUTH_SECRET is unset, so local dev on fixtures works without OAuth setup.
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "./auth";
import { authEnabled, isProtectedPath, signInRedirectUrl } from "./lib/auth/paths";
import { sessionToUser } from "./lib/auth/session-user";
import { onboardingRedirect, preferencesFrom } from "./lib/auth/workspace";

const guarded = auth((req) => {
  if (!sessionToUser(req.auth)) return NextResponse.redirect(signInRedirectUrl(req.nextUrl));
  const to = onboardingRedirect(req.nextUrl.pathname, preferencesFrom(req.auth?.user));
  return to ? NextResponse.redirect(new URL(to, req.nextUrl.origin)) : NextResponse.next();
});

export default function middleware(req: NextRequest) {
  if (!authEnabled() || !isProtectedPath(req.nextUrl.pathname)) return NextResponse.next();
  // The wrapper is typed for route handlers and wants a context; our callback ignores it.
  return guarded(req, { params: Promise.resolve({}) });
}

// Must be a literal for Next. Keep in sync with PROTECTED_PREFIXES in lib/auth/paths.ts (tested).
export const config = { matcher: ["/dashboard/:path*", "/me/:path*", "/app/:path*", "/welcome/:path*", "/settings/:path*"] };
