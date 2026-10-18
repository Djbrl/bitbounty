import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";
import { GET } from "../api/health/route";

describe("web", () => {
  it("renders the public project list (mission select) for signed-out visitors", async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ q: "" }) }));
    expect(html).toContain("Choisis ton projet");
    expect(html).toContain("/explore?repo=teranga-labs%2Fbitnob-js");
    expect(html).not.toContain("Live payouts");
  });

  it("drills into one project with ?repo=", async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ repo: "teranga-labs/bitnob-js" }) }));
    expect(html).toContain("Tous les projets");
    expect(html).toContain("Bounties ouvertes");
  });

  it("reports health on /api/health", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
