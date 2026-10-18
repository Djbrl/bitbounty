"use client";
// Header sign-in slot for AppNav. A client component on purpose: calling auth() in the page would
// make every page dynamic, so the session is read in the browser from /api/auth/session instead.
// U6: it is the header's second CTA, "Se connecter" (secondary pill to /signin), replaced by the account
// (avatar, @login, sign out) once signed in. Auth off (no AUTH_SECRET, the route answers 404): still
// "Se connecter"; /signin explains that sign-in is off. Before the session is known it holds the place.
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { SIGN_IN_PATH, safeCallbackUrl } from "../../lib/auth/paths";
import { sessionToUser, type SessionUser } from "../../lib/auth/session-user";
import { Avatar } from "../ui/avatar";
import { buttonClass } from "../ui/button";
import { cx } from "../ui/tone";

export type HeaderSession = { kind: "off" } | { kind: "out" } | { kind: "in"; user: SessionUser };

/** Browser: GET /api/auth/session → off (auth disabled / unreachable), signed out, or the user. */
export async function loadHeaderSession(fetcher: typeof fetch = fetch): Promise<HeaderSession> {
  try {
    const res = await fetcher("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return { kind: "off" };
    const user = sessionToUser((await res.json().catch(() => null)) as Parameters<typeof sessionToUser>[0]);
    return user ? { kind: "in", user } : { kind: "out" };
  } catch {
    return { kind: "off" };
  }
}

/** `/signin?callbackUrl=<path>` so people come back to the page they were on. */
export function signInHref(path: string): string {
  return `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(safeCallbackUrl(path))}`;
}

export function HeaderUserView({ session, path = "/" }: { session: HeaderSession | null; path?: string }) {
  const pill = buttonClass({ variant: "secondary", size: "sm", className: "whitespace-nowrap" });
  if (!session) {
    // Same size as the button, so nothing shifts when the session arrives; static on the server.
    return (
      <span aria-hidden className={cx(pill, "invisible")}>
        Se connecter
      </span>
    );
  }
  if (session.kind !== "in") {
    return (
      <a href={signInHref(path)} className={pill}>
        Se connecter
      </a>
    );
  }
  const { user } = session;
  return (
    <span className="inline-flex items-center gap-2">
      {user.avatarUrl ? <Avatar initials={user.login.slice(0, 1)} src={user.avatarUrl} size="sm" /> : null}
      <a href={`https://github.com/${user.login}`} className="font-medium text-ink">
        @{user.login}
      </a>
      <button type="button" onClick={() => void signOut({ redirectTo: "/" })} className="underline hover:text-ink">
        Sign out
      </button>
    </span>
  );
}

/** Drop-in for AppNav's `right` slot. Renders nothing on the server and until the session is known. */
export function HeaderUser() {
  const [session, setSession] = useState<HeaderSession | null>(null);
  const [path, setPath] = useState("/");
  useEffect(() => {
    setPath(`${window.location.pathname}${window.location.search}`);
    let live = true;
    void loadHeaderSession().then((s) => live && setSession(s));
    return () => {
      live = false;
    };
  }, []);
  return <HeaderUserView session={session} path={path} />;
}
