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
/** GitHub sign-in entry point; back to /welcome afterwards, where the visitor picks an intent. */
export const SIGN_IN_HREF = "/signin?callbackUrl=%2Fwelcome";

export function welcomeHref(intent: Intent): string {
  return `/welcome?intent=${intent}`;
}

/** GitHub mark (Octicon), inherits the pill's text color. */
const GITHUB_MARK =
  `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

const appCta = (cls: string, href: string, label: string) =>
  `<a class="${cls}" href="${href}" data-app-cta>${label}</a>`;

export function landingMarkup(cfg = LANDING_CONFIG): string {
  const slots: Record<string, string> = {
    // The header's single CTA. It becomes a plain "Ouvrir l'app" pill once signed in (the swap's
    // textContent drops the logo). The GitHub App install link lives in the maintainers tile.
    NAV_CTA: appCta("pill green gh", SIGN_IN_HREF, `${GITHUB_MARK}Se connecter avec GitHub`),
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
