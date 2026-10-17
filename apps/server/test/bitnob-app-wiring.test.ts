import { afterEach, describe, expect, it, vi } from "vitest";
import { signBitnobPayload } from "../src/bitnob/index.js";

const SECRET = "wiring-test-secret";

describe("app wiring: /webhooks/bitnob", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stores Bitnob events in the shared eventStore (regression: was a private InMemoryEventStore)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    vi.stubEnv("BITNOB_WEBHOOK_SECRET", SECRET);
    vi.resetModules();
    const { app, eventStore } = await import("../src/app.js");

    const body = JSON.stringify({ event: "payouts.processing", event_id: "wiring-1", data: { id: "p1" } });
    const res = await app.request("/webhooks/bitnob", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-bitnob-signature": signBitnobPayload(SECRET, body) },
    });

    expect(res.status).toBe(200);
    expect(await eventStore.get("bitnob", "wiring-1")).toMatchObject({ source: "bitnob", status: "processed" });
  });
});
