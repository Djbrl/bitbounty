import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MaintenancePage from "../../maintenance/page";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/waitlist", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/waitlist", () => {
  it("rejects a bad email, and pretends success for a bot that filled the honeypot", async () => {
    expect((await post({ email: "nope" })).status).toBe(400);
    const bot = await post({ email: "x@y.io", website: "http://spam" });
    expect(bot.status).toBe(200);
  });

  it("answers 503 when no store is configured", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect((await post({ email: "awa@example.sn" })).status).toBe(503);
  });

  it("stores the email and answers ok; 429 past the limit; 503 if the store fails", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://redis.example");
    vi.stubEnv("KV_REST_API_TOKEN", "tok");
    let count = 1;
    const fetchMock = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const cmds = JSON.parse(String(init?.body)) as string[][];
      return Response.json(cmds.map((c) => ({ result: c[0] === "INCR" ? count : 1 })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await post({ email: "Awa@Example.sn" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[1]![1]!.body)).toContain("awa@example.sn");

    count = 99;
    expect((await post({ email: "awa@example.sn" })).status).toBe(429);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ email: "awa@example.sn" })).status).toBe(503);
  });
});

describe("/maintenance page", () => {
  it("says when we're back, links Fly.io and shows the waitlist form", () => {
    const html = renderToStaticMarkup(MaintenancePage());
    expect(html).toContain("De retour le 23 octobre.");
    expect(html).toContain('href="https://fly.io"');
    expect(html).toContain('name="email"');
    expect(html).toContain("Rejoindre la liste d&#x27;attente");
  });
});
