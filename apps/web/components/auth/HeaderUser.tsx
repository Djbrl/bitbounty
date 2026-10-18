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
import { shellText, type Lang } from "../app-shell/mode";

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

export function HeaderUserView({ session, path = "/", lang = "fr" }: { session: HeaderSession | null; path?: string; lang?: Lang }) {
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
  const t = shellText(lang);
  return (
    <details data-tour="profile" className="group/menu relative">
      <summary
        aria-label={t.menu}
        className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-transparent py-0.5 pl-0.5 pr-3 transition-all duration-150 hover:-translate-y-px hover:border-rule hover:bg-chip hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent group-open/menu:border-rule group-open/menu:bg-chip [&::-webkit-details-marker]:hidden"
      >
        <Avatar initials={user.login.slice(0, 1).toUpperCase()} src={user.avatarUrl} size="sm" />
        <span className="max-w-[10rem] truncate font-mono text-[13px] font-semibold text-ink underline-offset-4 hover:underline">@{user.login}</span>
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 grid w-60 gap-1 rounded-[var(--radius-card)] border border-rule bg-sheet p-2 text-sm shadow-lg">
        <a href={`/u/${encodeURIComponent(user.login)}`} className="rounded-md px-2 py-1.5 hover:bg-chip">
          {t.profile}
        </a>
        <a href="/me" className="grid rounded-md px-2 py-1.5 hover:bg-chip">
          <span>{t.settings}</span>
          <span className="text-xs text-muted">{t.settingsHint}</span>
        </a>
        <button type="button" onClick={() => void signOut({ redirectTo: "/" })} className="rounded-md px-2 py-1.5 text-left hover:bg-chip">
          {t.signOut}
        </button>
      </div>
    </details>
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
