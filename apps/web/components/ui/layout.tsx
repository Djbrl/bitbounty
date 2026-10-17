import Link from "next/link";
import type { ReactNode } from "react";
import { HeaderUser } from "../auth/HeaderUser";
import { cx } from "./tone";

/** The BitBounty mark: green "B" tile + wordmark. */
export function Mark({ label = "BitBounty", className }: { label?: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 font-display text-[1.05rem] font-extrabold", className)}>
      <i className="grid size-[26px] place-items-center rounded-[7px] bg-money text-[0.95rem] not-italic text-on-solid">B</i>
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
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-muted">
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

const AVATAR_COLORS = ["#2a62d6", "#c2662d", "#0d7a52", "#8250df", "#b7790b", "#c2412d"];

export interface AvatarProps {
  initials: string;
  size?: "sm" | "md" | "lg";
  /** Override the colour; default is derived from the initials (stable across renders). */
  color?: string;
}

const AV_SIZE = {
  sm: "size-7 text-xs",
  md: "size-10 text-[15px]",
  lg: "size-[76px] font-display text-[1.6rem] font-extrabold",
} as const;

export function Avatar({ initials, size = "md", color }: AvatarProps) {
  const bg = color ?? AVATAR_COLORS[[...initials].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span
      className={cx("grid shrink-0 place-items-center rounded-full font-bold text-white", AV_SIZE[size])}
      style={{ background: bg }}
      aria-hidden
    >
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}
