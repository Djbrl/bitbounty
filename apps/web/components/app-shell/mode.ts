// U2: pure helpers for the /app shell (workspace, navigation, greeting). No React, no Next imports.
import { USER_MODES, type UserMode } from "@bitbounty/core";

export type { UserMode };
export type Lang = "fr" | "en";

/** Remembers the last workspace on this device (the server's users.default_mode wins when set). */
export const MODE_COOKIE = "bb_mode";
/** The user's language, when something stored it. French otherwise. */
export const LANG_COOKIE = "bb_lang";
export const INSTALL_URL = "https://github.com/apps/bitbounty-dakar";

export function parseMode(raw: unknown): UserMode | null {
  return typeof raw === "string" && (USER_MODES as readonly string[]).includes(raw) ? (raw as UserMode) : null;
}

export function parseLang(raw: unknown): Lang {
  return raw === "en" ? "en" : "fr";
}

/** Where `/app` lands: the saved mode (server, then this device), hunt by default; never a workspace you can't open. */
export function resolveMode(server: UserMode | null | undefined, cookie: UserMode | null | undefined, canMaintain: boolean): UserMode {
  const mode = server ?? cookie ?? "hunt";
  return mode === "maintain" && !canMaintain ? "hunt" : mode;
}

/** The workspace a path belongs to (the sidebar follows the URL). */
export function modeOfPath(pathname: string | null | undefined): UserMode {
  return pathname === "/app/maintain" || pathname?.startsWith("/app/maintain/") ? "maintain" : "hunt";
}

export type IconName = "home" | "compass" | "flag" | "coins" | "user" | "folder" | "inbox" | "send" | "tag";

export interface ShellNavItem {
  key: string;
  href: string;
  label: string;
  icon: IconName;
}

const T = {
  fr: {
    hi: "Salut",
    hunt: "Hunter",
    maintain: "Maintainer",
    home: "Accueil",
    explore: "Explorer",
    claims: "Mes claims",
    earnings: "Gains",
    profile: "Profil",
    repos: "Dépôts",
    review: "À relire",
    payouts: "Paiements",
    backlog: "Chiffrer mon backlog",
    search: "Rechercher une issue…",
    settings: "Adresse de paiement",
    settingsHint: "Lightning Address pour recevoir vos sats",
    signOut: "Se déconnecter",
    install: "Installer sur GitHub",
    installHint: "Installez l'app sur un dépôt pour financer des issues.",
    workspace: "Espace",
    menu: "Menu du compte",
    nav: "Navigation",
    skip: "Aller au contenu",
    switching: "Changement d'espace…",
  },
  en: {
    hi: "Hi",
    hunt: "Hunter",
    maintain: "Maintainer",
    home: "Home",
    explore: "Explore",
    claims: "My claims",
    earnings: "Earnings",
    profile: "Profile",
    repos: "Repos",
    review: "Review queue",
    payouts: "Payouts",
    backlog: "Price my backlog",
    search: "Search issues…",
    settings: "Payout address",
    settingsHint: "Lightning Address where your sats land",
    signOut: "Sign out",
    install: "Install on GitHub",
    installHint: "Install the app on a repo to fund issues.",
    workspace: "Workspace",
    menu: "Account menu",
    nav: "Navigation",
    skip: "Skip to content",
    switching: "Switching workspace…",
  },
} as const;

export type ShellText = (typeof T)[Lang];

export function shellText(lang: Lang): ShellText {
  return T[lang];
}

/** "Salut Awa 👋" / "Hi Awa 👋" (first name only); just the greeting when the name is unknown. */
export function greeting(lang: Lang, name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${T[lang].hi} ${first} 👋` : `${T[lang].hi} 👋`;
}

/** Sidebar / bottom bar entries per workspace. U3 and U4 turn the anchors into their own pages. */
export function navFor(mode: UserMode, login: string | null | undefined, lang: Lang): ShellNavItem[] {
  const t = T[lang];
  if (mode === "maintain") {
    return [
      { key: "home", href: "/app/maintain", label: t.home, icon: "home" },
      { key: "explore", href: "/app/explore", label: t.explore, icon: "compass" },
      { key: "backlog", href: "/app/maintain#backlog", label: t.backlog, icon: "tag" },
      { key: "review", href: "/app/maintain#review", label: t.review, icon: "inbox" },
      { key: "repos", href: "/app/maintain/repos", label: t.repos, icon: "folder" },
      { key: "payouts", href: "/app/maintain/payouts", label: t.payouts, icon: "send" },
      { key: "stats", href: "/app/maintain/stats", label: lang === "fr" ? "Statistiques" : "Stats", icon: "coins" },
    ];
  }
  return [
    { key: "home", href: "/app/hunt", label: t.home, icon: "home" },
    { key: "explore", href: "/app/explore", label: t.explore, icon: "compass" },
    { key: "claims", href: "/app/hunt#claims", label: t.claims, icon: "flag" },
    { key: "earnings", href: "/app/hunt#earnings", label: t.earnings, icon: "coins" },
    { key: "profile", href: login ? `/u/${encodeURIComponent(login)}` : "/app/hunt", label: t.profile, icon: "user" },
  ];
}
