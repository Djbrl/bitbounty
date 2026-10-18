"use client";
// U2: the frame around every signed-in /app page. Sidebar (desktop) or bottom bar (phone), a header
// with the greeting, search and the avatar menu holding the Maintainer ⇄ Hunter switch.
// The sidebar follows the URL (/app/hunt vs /app/maintain); switching saves the mode (server action).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Avatar, Mark, buttonClass, cx } from "../ui";
import { greeting, INSTALL_URL, modeOfPath, navFor, shellText, type IconName, type Lang, type ShellNavItem, type UserMode } from "./mode";

export interface ShellUser {
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface AppShellProps {
  user: ShellUser;
  lang: Lang;
  /** At least one repo with the GitHub App installed: the Maintainer workspace is available. */
  canMaintain: boolean;
  /** Auth.js is on (AUTH_SECRET set): show "Sign out". */
  authOn: boolean;
  /** Server action: saves `mode` from the form and redirects to that workspace's home. */
  switchMode: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
}

const ICONS: Record<IconName, ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  flag: <path d="M6 21V4m0 0h10l-2 4 2 4H6" />,
  coins: (
    <>
      <ellipse cx="12" cy="7" rx="6" ry="2.5" />
      <path d="M6 7v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7M6 12v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </>
  ),
  folder: <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  inbox: <path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm0 0h4.5l1 2h5l1-2H20" />,
  send: <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />,
  tag: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cx("size-5 shrink-0", className)}>
      {ICONS[name]}
    </svg>
  );
}

const isCurrent = (item: ShellNavItem, pathname: string) => !item.href.includes("#") && item.href === pathname;

/** Hunter / Maintainer toggle: two submit buttons of one form, or "Install on GitHub" without a repo. */
export function ModeSwitch({
  current,
  canMaintain,
  lang,
  switchMode,
  className,
}: {
  current: UserMode;
  canMaintain: boolean;
  lang: Lang;
  switchMode: AppShellProps["switchMode"];
  className?: string;
}) {
  const t = shellText(lang);
  const btn = (mode: UserMode) => (
    <button
      type="submit"
      name="mode"
      value={mode}
      aria-pressed={current === mode}
      className={cx(
        "flex-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent",
        current === mode ? "bg-ink text-paper" : "text-ink-soft hover:text-ink",
      )}
    >
      {t[mode]}
    </button>
  );
  return (
    <div className={cx("grid gap-2", className)}>
      <form action={switchMode} className="flex rounded-full bg-chip p-1" aria-label={t.workspace}>
        {btn("hunt")}
        {canMaintain ? btn("maintain") : null}
      </form>
      {canMaintain ? null : (
        <a href={INSTALL_URL} className="text-[13px] font-semibold text-money underline-offset-2 hover:underline" title={t.installHint}>
          {t.install} →
        </a>
      )}
    </div>
  );
}

function AvatarMenu({ user, lang, canMaintain, authOn, switchMode, mode }: Omit<AppShellProps, "children"> & { mode: UserMode }) {
  const t = shellText(lang);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const signOut = async () => {
    const { signOut } = await import("next-auth/react");
    await signOut({ redirectTo: "/" });
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t.menu}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"
      >
        <Avatar initials={(user.name ?? user.login ?? "?").slice(0, 1).toUpperCase()} src={user.avatarUrl} size="sm" />
      </button>
      {open ? (
        <div id={menuId} className="absolute right-0 top-full z-40 mt-2 grid w-64 gap-3 rounded-[var(--radius-card)] border border-rule bg-sheet p-3 shadow-lg">
          {user.login ? (
            <div className="grid">
              <span className="font-semibold">{user.name ?? user.login}</span>
              <span className="font-mono text-xs text-muted">@{user.login}</span>
            </div>
          ) : null}
          <ModeSwitch current={mode} canMaintain={canMaintain} lang={lang} switchMode={switchMode} />
          <div className="grid gap-1 border-t border-rule pt-2 text-sm">
            <Link href="/me" className="rounded-md px-2 py-1.5 hover:bg-chip">
              {t.settings}
            </Link>
            {authOn ? (
              <button type="button" onClick={() => void signOut()} className="rounded-md px-2 py-1.5 text-left hover:bg-chip">
                {t.signOut}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  const { user, lang, canMaintain, switchMode, children } = props;
  const pathname = usePathname() ?? "/app";
  const mode = modeOfPath(pathname);
  const t = shellText(lang);
  const items = navFor(mode, user.login, lang);

  return (
    <div lang={lang} className="min-h-dvh bg-paper text-ink md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#app-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
        {t.skip}
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-rule bg-sheet px-4 py-5 md:flex">
        <Link href="/" aria-label="BitBounty">
          <Mark />
        </Link>
        <ModeSwitch current={mode} canMaintain={canMaintain} lang={lang} switchMode={switchMode} />
        <nav aria-label={t.nav}>
          <ul className="grid gap-1">
            {items.map((item) => {
              const current = isCurrent(item, pathname);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-ink-soft hover:bg-chip hover:text-ink focus-visible:outline-2 focus-visible:outline-agent",
                      current && "bg-chip font-semibold text-ink",
                    )}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto grid gap-1 border-t border-rule pt-4 text-[14px]">
          <Link href="/me" className="rounded-xl px-3 py-2 text-ink-soft hover:bg-chip hover:text-ink">
            {t.settings}
          </Link>
          {user.login ? <span className="px-3 font-mono text-xs text-muted">@{user.login}</span> : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-rule bg-paper/90 px-4 py-3 backdrop-blur md:px-8">
          <Link href="/" aria-label="BitBounty" className="md:hidden">
            <Mark label="" />
          </Link>
          <p className="truncate text-[15px] font-semibold md:text-lg">{greeting(lang, user.name ?? user.login)}</p>
          <form role="search" action="/explore" className="ml-auto hidden sm:block">
            <label className="sr-only" htmlFor="app-search">
              {t.search}
            </label>
            <input
              id="app-search"
              type="search"
              name="q"
              placeholder={t.search}
              className="w-56 rounded-full border border-rule bg-sheet px-4 py-1.5 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-agent lg:w-72"
            />
          </form>
          {/* U6: the header's two CTAs. Pages under /app are signed in, so the account menu stands in for "Se connecter". */}
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ size: "sm", className: "whitespace-nowrap" })}>
              {t.install}
            </a>
            <AvatarMenu {...props} mode={mode} />
          </div>
        </header>
        <main id="app-content" tabIndex={-1} className="grid flex-1 content-start gap-10 px-4 pb-28 pt-6 md:px-8 md:pb-12 [&_[id]]:scroll-mt-20">
          {children}
        </main>
      </div>

      <nav aria-label={t.nav} className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-sheet pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-5">
          {items.map((item) => {
            const current = isCurrent(item, pathname);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    "flex flex-col items-center gap-0.5 px-1 py-2 text-[10.5px] leading-tight text-muted focus-visible:outline-2 focus-visible:outline-agent",
                    current && "font-semibold text-ink",
                  )}
                >
                  <Icon name={item.icon} />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
