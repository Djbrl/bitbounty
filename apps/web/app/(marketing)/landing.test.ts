import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseIntent } from "../welcome/intent";
import { landingMarkup } from "./landing-markup";
import LandingPage from "./page";

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
