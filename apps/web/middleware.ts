// W9: /dashboard, /me, /welcome (L1) and /app (U2) need a GitHub session; everything else is public.
// No-op when AUTH_SECRET is unset, so local dev on fixtures works without OAuth setup.
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "./auth";
import { authEnabled, isProtectedPath, signInRedirectUrl } from "./lib/auth/paths";
import { sessionToUser } from "./lib/auth/session-user";

const guarded = auth((req) => {
  if (!sessionToUser(req.auth)) return NextResponse.redirect(signInRedirectUrl(req.nextUrl));
  return NextResponse.next();
});

export default function middleware(req: NextRequest) {
  if (!authEnabled() || !isProtectedPath(req.nextUrl.pathname)) return NextResponse.next();
  // The wrapper is typed for route handlers and wants a context; our callback ignores it.
  return guarded(req, { params: Promise.resolve({}) });
}

// Must be a literal for Next. Keep in sync with PROTECTED_PREFIXES in lib/auth/paths.ts (tested).
export const config = { matcher: ["/dashboard/:path*", "/me/:path*", "/welcome/:path*", "/app/:path*"] };
