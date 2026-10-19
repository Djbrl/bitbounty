// W9: /dashboard, /me, /welcome (L1) and /app (U2) need a GitHub session; everything else is public.
// No-op when AUTH_SECRET is unset, so local dev on fixtures works without OAuth setup.
// Maintenance: with MAINTENANCE_MODE on, every page shows /maintenance instead (lib/maintenance.ts).
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "./auth";
import { authEnabled, isProtectedPath, signInRedirectUrl } from "./lib/auth/paths";
import { sessionToUser } from "./lib/auth/session-user";
import { MAINTENANCE_PATH, maintenanceOn, servedDuringMaintenance } from "./lib/maintenance";

const guarded = auth((req) => {
  if (!sessionToUser(req.auth)) return NextResponse.redirect(signInRedirectUrl(req.nextUrl));
  return NextResponse.next();
});

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (maintenanceOn()) {
    if (servedDuringMaintenance(pathname)) return NextResponse.next();
    // Rewrite, not redirect: the address bar keeps the page people asked for, so links still work once we're back.
    const res = NextResponse.rewrite(new URL(MAINTENANCE_PATH, req.url));
    res.headers.set("x-robots-tag", "noindex");
    return res;
  }
  if (!authEnabled() || !isProtectedPath(pathname)) return NextResponse.next();
  // The wrapper is typed for route handlers and wants a context; our callback ignores it.
  return guarded(req, { params: Promise.resolve({}) });
}

// Must be a literal for Next. Every page (maintenance needs them all); never /api, /_next or files with an
// extension. Which pages need sign-in is decided by isProtectedPath (PROTECTED_PREFIXES in lib/auth/paths.ts).
export const config = { matcher: ["/((?!api/|_next/|.*\\.[A-Za-z0-9]+$).*)"] };
