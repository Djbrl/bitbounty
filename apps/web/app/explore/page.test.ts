import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";
import { GET } from "../api/health/route";

describe("web", () => {
  it("renders the public board on the home page", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Paid issues");
    expect(html).toContain("Live payouts");
  });

  it("reports health on /api/health", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
