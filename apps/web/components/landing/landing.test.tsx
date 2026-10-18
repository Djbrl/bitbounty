import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { landingConfig, trailerEmbedUrl } from "./config";
import { Landing } from "./landing";

const render = (signedIn: boolean, env: Record<string, string> = {}) =>
  renderToStaticMarkup(<Landing signedIn={signedIn} config={landingConfig(env)} />);
const hrefs = (html: string, text: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].filter((m) => m[2]!.includes(text)).map((m) => m[1]);

describe("landing CTAs", () => {
  it("signed out: each CTA starts GitHub sign-in on this site with its intent", () => {
    const html = render(false);
    expect(hrefs(html, "Financer une issue")).toEqual(["/start?intent=maintain", "/start?intent=maintain"]);
    expect(hrefs(html, "Être payé pour corriger")).toEqual(["/start?intent=hunt", "/start?intent=hunt"]);
    expect(hrefs(html, "Se connecter")).toEqual(["/start"]);
    expect(html).not.toContain("Ouvrir l&#x27;app");
    // No CTA leaves for another site any more (the GitHub App install link is the one external exception).
    expect(html).not.toContain("bitbounty-app.vercel.app");
  });

  it("signed in: 'Ouvrir l'app' instead of the sign-in CTAs", () => {
    const html = render(true);
    expect(hrefs(html, "Ouvrir l&#x27;app")).toEqual(["/app", "/app", "/app"]);
    expect(html).not.toContain("/start");
    expect(html).not.toContain("Financer une issue");
  });

  it("keeps the story, the tiles and the in-app board links", () => {
    const html = render(false);
    for (const text of ["Faites-vous payer", "Publier une bounty.", "Réclamée à Dakar.", "Payée sur Wave.", "Des issues qui paient.", "Votre prochain contributeur"]) {
      expect(html).toContain(text);
    }
    expect(html.match(/class="g-stop"/g)).toHaveLength(6);
    expect(hrefs(html, "Parcourir les issues payées")).toEqual(["/explore"]);
    expect(hrefs(html, "Installer sur GitHub")).toEqual(["https://github.com/apps/bitbounty-dakar"]);
    expect(html).toContain('src="/landing/bitnob-logo-white.svg"');
    expect(html.match(/<circle /g)!.length).toBeGreaterThan(900); // the Africa map's developer dots
  });
});

describe("trailer and demo slots", () => {
  it("shows the Demo Day placeholder without a trailer id, and the live demo button", () => {
    const html = render(false);
    expect(html).toContain("Première au Demo Day");
    expect(html).not.toContain("<iframe");
    expect(hrefs(html, "Ouvrir la démo en direct")).toEqual(["/explore"]);
  });

  it("embeds the trailer when LANDING_TRAILER_YOUTUBE_ID is set", () => {
    const html = render(false, { LANDING_TRAILER_YOUTUBE_ID: "dQw4w9WgXcQ" });
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
    expect(html).not.toContain("Première au Demo Day");
  });

  it("ignores an id that isn't a YouTube id", () => {
    expect(trailerEmbedUrl("")).toBeNull();
    expect(trailerEmbedUrl('x"><script>')).toBeNull();
    expect(trailerEmbedUrl("abc")).toBeNull();
  });
});

describe("landing.css stays inside the landing", () => {
  const css = readFileSync(fileURLToPath(new URL("../../app/(marketing)/landing.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  /** Every rule prelude (selector list or at-rule) with the keyframes it sits in, by walking the braces. */
  function preludes() {
    const out: { prelude: string; inKeyframes: boolean }[] = [];
    const stack: string[] = [];
    let buf = "";
    for (const ch of css) {
      if (ch === "{") {
        const prelude = buf.trim();
        out.push({ prelude, inKeyframes: stack.some((s) => s.startsWith("@keyframes")) });
        stack.push(prelude);
        buf = "";
      } else if (ch === "}") {
        stack.pop();
        buf = "";
      } else if (ch === ";") {
        buf = "";
      } else buf += ch;
    }
    return out;
  }

  it("scopes every selector under .bb-landing (html and body only through :has)", () => {
    const selectors = preludes()
      .filter((p) => !p.prelude.startsWith("@") && !p.inKeyframes)
      .flatMap((p) => p.prelude.split(",").map((s) => s.trim()));
    expect(selectors.length).toBeGreaterThan(150);
    const leaks = selectors.filter((s) => !/^(\.bb-landing\b|html:has\(\.bb-landing\)|body:has\(\.bb-landing\))/.test(s));
    expect(leaks).toEqual([]);
  });

  it("declares its fonts under landing-only names (a same-named face would replace the app's next/font one)", () => {
    const families = [...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(families)).toEqual(new Set(["BB Landing Display", "BB Landing Body", "BB Landing Mono"]));
  });

  it("prefixes its keyframes so they can't replace the app's (Tailwind has its own `pulse`)", () => {
    const names = preludes()
      .filter((p) => p.prelude.startsWith("@keyframes"))
      .map((p) => p.prelude.replace("@keyframes", "").trim());
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !n.startsWith("lp-"))).toEqual([]);
  });
});
