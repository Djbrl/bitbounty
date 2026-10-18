// First-visit guided tour: steps per app mode, bilingual (fr primary, en). Targets are `[data-tour="<id>"]`.
import type { Lang, UserMode } from "../app-shell/mode";

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

type Copy = Record<Lang, { title: string; body: string }>;

export type TourTarget = "mode-switch" | "price-backlog" | "funded-prs" | "nav" | "profile" | "search" | "claims";

const COPY: Record<TourTarget, Copy> = {
  "mode-switch": {
    fr: { title: "Changer de mode", body: "Passez de Hunter à Maintainer (et inversement) en un clic." },
    en: { title: "Switch mode", body: "Flip between Hunter and Maintainer in one click." },
  },
  "price-backlog": {
    fr: { title: "Commencez ici", body: "Pricez votre backlog en un clic, ou tapez /bounty sur une issue." },
    en: { title: "Start here", body: "Price your backlog in one click, or comment /bounty on an issue." },
  },
  "funded-prs": {
    fr: { title: "PR financées", body: "Suivez les PR liées à une bounty et décidez : payer ou bloquer." },
    en: { title: "Funded PRs", body: "Track PRs tied to a bounty and decide: pay or hold." },
  },
  nav: {
    fr: { title: "Navigation", body: "Toutes les sections de votre espace sont ici." },
    en: { title: "Navigation", body: "Every section of your workspace lives here." },
  },
  profile: {
    fr: { title: "Votre profil", body: "Lightning Address, paramètres et déconnexion : tout est dans ce menu." },
    en: { title: "Your profile", body: "Lightning Address, settings and sign-out live in this menu." },
  },
  search: {
    fr: { title: "Chercher des issues", body: "Trouvez une issue avec une bounty par mot-clé, langage ou repo." },
    en: { title: "Search issues", body: "Find a bountied issue by keyword, language or repo." },
  },
  claims: {
    fr: { title: "Mes claims", body: "Ce que vous avez réservé avec /claim, et où en est chaque PR." },
    en: { title: "My claims", body: "What you reserved with /claim, and where each PR stands." },
  },
};

export const TOUR_TARGETS: Record<UserMode, TourTarget[]> = {
  maintain: ["mode-switch", "price-backlog", "funded-prs", "nav", "profile"],
  hunt: ["mode-switch", "search", "claims", "nav", "profile"],
};

export function tourSteps(mode: UserMode, lang: Lang): TourStep[] {
  return TOUR_TARGETS[mode].map((target) => ({ target, ...COPY[target][lang] }));
}

/** Keep only steps whose target exists (and is visible), as decided by `has`. */
export function presentSteps(steps: TourStep[], has: (target: string) => boolean): TourStep[] {
  return steps.filter((s) => has(s.target));
}

export const tourStorageKey = (mode: UserMode) => `bitbounty.tour.${mode}.done`;

export const TOUR_UI: Record<Lang, { next: string; done: string; skip: string; launch: string; step: (i: number, n: number) => string }> = {
  fr: { next: "Suivant", done: "Terminer", skip: "Passer", launch: "Visite guidée", step: (i, n) => `Étape ${i} sur ${n}` },
  en: { next: "Next", done: "Done", skip: "Skip", launch: "Guided tour", step: (i, n) => `Step ${i} of ${n}` },
};
