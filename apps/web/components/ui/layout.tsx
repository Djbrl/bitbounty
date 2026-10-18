import Link from "next/link";
import type { ReactNode } from "react";
import { INSTALL_URL } from "../app-shell/mode";
import { HeaderUser } from "../auth/HeaderUser";
import { buttonClass } from "./button";
import { cx } from "./tone";

/** The BitBounty mark from the landing nav: ink "b" stroke with a green dot + wordmark. */
export function Mark({ label = "BitBounty", className }: { label?: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-base font-bold text-ink", className)}>
      <svg width="22" height="22" viewBox="0 0 30 30" aria-hidden className="shrink-0">
        <path d="M8 4v22" stroke="currentColor" strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <path d="M8 9c0 6 4 9 10.5 9.5" stroke="currentColor" strokeWidth="2.8" fill="none" strokeLinecap="round" />
        <circle cx="21.5" cy="18.5" r="5.2" fill="var(--bb-money)" />
      </svg>
      {label}
    </span>
  );
}

export interface NavItem {
  href: string;
  label: string;
}

export interface AppNavProps {
  items?: NavItem[];
  /** href of the current page, rendered bold. */
  active?: string;
  /** @deprecated U6: no longer rendered; the account menu in `right` shows the signed-in user. */
  initials?: string;
  /** Second CTA, after "Installer sur GitHub": "Se connecter", or the account menu once signed in (Page passes HeaderUser). */
  right?: ReactNode;
}

/**
 * Top bar: mark on the left, links + the two CTAs on the right ("Installer sur GitHub" primary, then the
 * `right` slot). Wraps under the mark at phone width.
 */
export function AppNav({ items = [], active, right }: AppNavProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <Link href="/" aria-label="BitBounty home">
        <Mark />
      </Link>
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13.5px] text-ink-soft">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === active ? "page" : undefined}
            className={cx("hover:text-ink", item.href === active && "font-semibold text-ink")}
          >
            {item.label}
          </Link>
        ))}
        <span className="flex items-center gap-2">
          <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer" className={buttonClass({ size: "sm", className: "whitespace-nowrap" })}>
            Installer sur GitHub
          </a>
          {right}
        </span>
      </nav>
    </header>
  );
}

export interface PageProps {
  children: ReactNode;
  /** Renders an AppNav above the content; its `right` slot defaults to the GitHub sign-in / user menu. */
  nav?: AppNavProps;
  /** Max content width: narrow 576px (forms), default 1180px, wide 1440px (projector). */
  width?: "narrow" | "default" | "wide";
  className?: string;
}

const WIDTH = { narrow: "max-w-xl", default: "max-w-[1180px]", wide: "max-w-[1440px]" } as const;

/** Page container: centred column, 16px gutter on phones, optional AppNav on top. */
export function Page({ children, nav, width = "default", className }: PageProps) {
  return (
    <div className={cx("mx-auto grid w-full gap-8 px-4 pb-16 pt-6 sm:px-6", WIDTH[width], className)}>
      {nav && <AppNav right={<HeaderUser />} {...nav} />}
      <main className="grid min-w-0 gap-12">{children}</main>
    </div>
  );
}

export interface SectionProps {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot next to the heading (buttons). */
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
}

/** Heading block (eyebrow, h2, muted description, actions) + content. */
export function Section({ eyebrow, title, description, actions, children, id }: SectionProps) {
  return (
    <section id={id} className="grid min-w-0 gap-4">
      {(eyebrow || title || description || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1.5">
            {eyebrow && (
              <span className="font-mono text-[0.74rem] font-medium uppercase tracking-[0.08em] text-muted">{eyebrow}</span>
            )}
            {title && <h2 className="text-[clamp(1.4rem,3vw,2rem)] font-extrabold tracking-tight">{title}</h2>}
            {description && <p className="max-w-[68ch] text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
