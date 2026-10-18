import Link from "next/link";
import type { ReactNode } from "react";
import { HeaderUser } from "../auth/HeaderUser";
import { Avatar } from "./avatar";
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
  /** Initials for the avatar; omit when signed out. */
  initials?: string;
  /** Slot on the right (e.g. the sign-in button from W9). */
  right?: ReactNode;
}

/** Top bar: mark on the left, links + avatar on the right. Wraps under the mark at phone width. */
export function AppNav({ items = [], active, initials, right }: AppNavProps) {
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
        {right}
        {initials && <Avatar initials={initials} size="sm" />}
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
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot next to the heading (buttons). */
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
}

/** Heading block (h2, muted description, actions) + content. */
export function Section({ title, description, actions, children, id }: SectionProps) {
  return (
    <section id={id} className="grid min-w-0 gap-4">
      {(title || description || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1.5">
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
