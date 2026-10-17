import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";
import { GET } from "./api/health/route";

describe("web", () => {
  it("renders hello on the home page", () => {
    expect(renderToStaticMarkup(createElement(Home))).toContain("hello");
  });

  it("reports health on /api/health", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
