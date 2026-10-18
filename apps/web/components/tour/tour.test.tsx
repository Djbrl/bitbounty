import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { presentSteps, TOUR_TARGETS, TOUR_UI, tourStorageKey, tourSteps } from "./steps";
import { Tour } from "./tour";

describe("guided tour steps", () => {
  it("has the five targets per mode, in order", () => {
    expect(TOUR_TARGETS.maintain).toEqual(["mode-switch", "price-backlog", "funded-prs", "nav", "profile"]);
    expect(TOUR_TARGETS.hunt).toEqual(["mode-switch", "search", "claims", "nav", "profile"]);
  });

  it("is bilingual, French first", () => {
    const fr = tourSteps("hunt", "fr");
    const en = tourSteps("hunt", "en");
    expect(fr[2]?.title).toBe("Mes claims");
    expect(en[2]?.title).toBe("My claims");
    expect(tourSteps("maintain", "fr")[1]?.body).toContain("/bounty");
    for (const s of [...fr, ...en, ...tourSteps("maintain", "fr"), ...tourSteps("maintain", "en")]) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }
    expect(TOUR_UI.fr.next).toBe("Suivant");
    expect(TOUR_UI.fr.skip).toBe("Passer");
  });

  it("skips steps whose target is missing", () => {
    const steps = presentSteps(tourSteps("maintain", "en"), (t) => t !== "funded-prs" && t !== "price-backlog");
    expect(steps.map((s) => s.target)).toEqual(["mode-switch", "nav", "profile"]);
  });

  it("stores completion per mode", () => {
    expect(tourStorageKey("hunt")).not.toBe(tourStorageKey("maintain"));
  });

  it("server-renders only the relaunch button", () => {
    const html = renderToStaticMarkup(<Tour mode="hunt" lang="fr" />);
    expect(html).toContain('aria-label="Visite guidée"');
    expect(html).not.toContain('role="dialog"');
    expect(renderToStaticMarkup(<Tour mode="maintain" lang="en" />)).toContain("Guided tour");
  });
});
