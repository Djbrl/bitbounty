import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseIntent } from "../welcome/intent";
import { landingMarkup } from "./landing-markup";
import LandingPage, { metadata } from "./page";

describe("landing (L1)", () => {
  const html = landingMarkup();

  it("renders the ported French landing at /", () => {
    const page = renderToStaticMarkup(LandingPage());
    expect(page).toContain('class="bb-landing"');
    expect(page).toContain("Faites-vous payer");
    expect(page).toContain('id="graph"');
    expect(page).toContain('id="video"');
  });

  it("sends both CTAs to /welcome with the intent, and fills every slot", () => {
    expect(html).toContain('href="/welcome?intent=hunt"');
    expect(html).toContain('href="/welcome?intent=maintain"');
    expect(html).toContain('href="/explore"');
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(html).not.toContain("bitbounty-app.vercel.app");
    expect(html).toContain('src="/landing/bitnob-logo-white.svg"');
    // Nav + hero + closing primary CTAs are swapped to "Ouvrir l'app" for signed-in visitors.
    expect(html.match(/data-app-cta/g)).toHaveLength(3);
  });

  it("has exactly two nav CTAs: Installer sur GitHub (new tab) and Se connecter", () => {
    const nav = html.slice(html.indexOf('<header class="nav">'), html.indexOf("</header>"));
    const pills = [...nav.matchAll(/<a class="pill[^"]*"[^>]*>([^<]*)<\/a>/g)];
    expect(pills.map((m) => m[1])).toEqual(["Installer sur GitHub", "Se connecter"]);
    expect(pills[0]![0]).toContain('href="https://github.com/apps/bitbounty-dakar"');
    expect(pills[0]![0]).toContain('target="_blank"');
    expect(pills[1]![0]).toContain('href="/signin?callbackUrl=%2Fwelcome"');
  });

  it("says payouts are in sats over Lightning, never Wave or mobile money (L2)", () => {
    const page = renderToStaticMarkup(LandingPage());
    expect(page).toContain("payées en sats sur votre Lightning Address dès le merge.");
    expect(page).toContain("Vous avez reçu 16 820 sats (10 000 F).");
    expect(page).not.toMatch(/wave|orange money|\bmtn\b|mobile money/i);
    expect(JSON.stringify(metadata)).not.toMatch(/wave/i);
  });

  it("scopes every landing CSS rule under .bb-landing", () => {
    const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/(?:^|[}{])\s*([^{}@]+?)\s*\{/g)]
      .map((m) => m[1]!.trim())
      .filter((s) => s && !/^(from|to|\d+%)/.test(s));
    expect(selectors.length).toBeGreaterThan(100);
    for (const group of selectors) {
      for (const sel of group.split(/,(?![^(]*\))/)) expect(sel.trim()).toMatch(/^(\.bb-landing|:where\(\.bb-landing)/);
    }
    expect(css).not.toMatch(/@keyframes (?!bbl-)/);
  });

  it("parses the welcome intent", () => {
    expect(parseIntent("maintain")).toBe("maintain");
    expect(parseIntent(["hunt", "x"])).toBe("hunt");
    expect(parseIntent("admin")).toBeNull();
    expect(parseIntent(undefined)).toBeNull();
  });
});
