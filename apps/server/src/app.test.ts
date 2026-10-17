import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("server", () => {
  it("says hello on /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "bitbounty-server", message: "hello" });
  });

  it("reports health on /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 on unknown routes", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});
