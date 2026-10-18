// L1: what the old landing's site.config.js held. The trailer id is read per request, so it can be
// set on Vercel (LANDING_TRAILER_YOUTUBE_ID) without a code change; empty = the "coming soon" slot.

export interface LandingConfig {
  /** YouTube id of the trailer (the part after v=); empty shows the Demo Day placeholder. */
  trailerYoutubeId: string;
  /** "Ouvrir la démo en direct" under the trailer: the board, on this site. */
  demoPath: string;
  /** "Installer sur GitHub": the GitHub App install page. */
  githubAppUrl: string;
  repoUrl: string;
}

export function landingConfig(env: Record<string, string | undefined> = process.env): LandingConfig {
  return {
    trailerYoutubeId: env.LANDING_TRAILER_YOUTUBE_ID?.trim() ?? "",
    demoPath: "/explore",
    githubAppUrl: "https://github.com/apps/bitbounty-dakar",
    repoUrl: "https://github.com/Djbrl/bitbounty",
  };
}

/** youtube-nocookie embed URL for a valid id (same check as the old main.js), else null. */
export function trailerEmbedUrl(id: string): string | null {
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
}
