// L1: fills the CTA slots of the ported landing (landing-template.ts).
// Signed-out visitors get the intent CTAs: /welcome is protected, so middleware sends them through
// GitHub sign-in first and brings them back with the intent. Links marked data-app-cta are swapped to
// "Ouvrir l'app" in the browser once the session says the visitor is signed in (landing-scroll.tsx),
// which keeps `/` static.
import { LANDING_TEMPLATE } from "./landing-template";

export const LANDING_CONFIG = {
  /** YouTube id of the trailer; empty keeps the "coming soon" slot. */
  trailerYoutubeId: "",
  githubAppUrl: "https://github.com/apps/bitbounty-dakar",
  repoUrl: "https://github.com/Djbrl/bitbounty",
};

export type Intent = "maintain" | "hunt";

export const OPEN_APP_HREF = "/welcome";
export const OPEN_APP_LABEL = "Ouvrir l'app";

export function welcomeHref(intent: Intent): string {
  return `/welcome?intent=${intent}`;
}

const appCta = (cls: string, href: string, label: string) =>
  `<a class="${cls}" href="${href}" data-app-cta>${label}</a>`;

export function landingMarkup(cfg = LANDING_CONFIG): string {
  const slots: Record<string, string> = {
    NAV_CTA: `<a class="pill dark" href="${cfg.githubAppUrl}" target="_blank" rel="noopener" data-app-cta>Installer</a>`,
    HERO_CTAS:
      appCta("pill green", welcomeHref("hunt"), "Trouver une issue payée") +
      `\n      <a class="link" href="${welcomeHref("maintain")}">Publier une bounty ›</a>`,
    CLOSING_CTAS:
      appCta("pill green", welcomeHref("maintain"), "Publier une bounty") +
      `\n      <a class="link" href="${welcomeHref("hunt")}">Trouver une issue payée ›</a>`,
    GITHUB_APP_URL: cfg.githubAppUrl,
    REPO_URL: cfg.repoUrl,
  };
  return LANDING_TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => slots[k] ?? m);
}
