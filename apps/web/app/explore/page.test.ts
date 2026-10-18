import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ExplorePage from "./page";
import { GET } from "../api/health/route";

describe("web", () => {
  it("renders the public board on /explore", async () => {
    const html = renderToStaticMarkup(await ExplorePage());
    expect(html).toContain("Paid issues");
    expect(html).toContain("Live payouts");
  });

  it("reports health on /api/health", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
