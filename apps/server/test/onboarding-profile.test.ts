import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { requestUser } from "../src/api/index.js";
import {
  githubLanguages,
  InMemoryProfileStore,
  normalizePreferences,
  parseProfilePatch,
  profileRoutes,
  topLanguages,
} from "../src/onboarding/index.js";
import { HttpLnurlResolver, LnurlError, PayoutConfigError } from "../src/payouts/index.js";
import { payeeWithFallback } from "../src/settlement/index.js";

const TOKEN = "t".repeat(32);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(opts: { checker?: { check: (a: string) => Promise<unknown> } } = {}) {
  const store = new InMemoryProfileStore(() => new Date("2026-10-18T12:00:00Z"));
  const checker = { check: vi.fn(opts.checker?.check ?? (async () => ({ minSendableMsat: 1000, maxSendableMsat: 1e9 }))) };
  const app = new Hono().route(
    "/",
    profileRoutes({
      store,
      checker: checker as never,
      getLogin: (c) => requestUser(c, TOKEN),
      languagesOf: async () => ["TypeScript", "Go"],
      reposOf: async () => ["awa-dev/api"],
    }),
  );
  const call = (method: string, path: string, body?: unknown, user: string | null = "awa-dev") =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${TOKEN}`, "x-bitbounty-user": user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, checker, call };
}

describe("U1 onboarding routes", () => {
  it("401 without the signed-in user", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/me/onboarding", undefined, null)).status).toBe(401);
    expect((await call("POST", "/api/me/lightning-address", { lightningAddress: "awa@blink.sv" }, null)).status).toBe(401);
  });

  it("GET returns defaults, GitHub languages and installed repos", async () => {
    const { call } = setup();
    const body = await (await call("GET", "/api/me/onboarding")).json();
    expect(body).toMatchObject({
      login: "awa-dev",
      defaultMode: null,
      onboardedAt: null,
      preferences: { role: null, stack: [], currency: "xof", language: "fr", repo: null, step: 1 },
      lightningAddress: null,
      githubLanguages: ["TypeScript", "Go"],
      installedRepos: ["awa-dev/api"],
      appInstallUrl: "https://github.com/apps/bitbounty-dakar",
    });
  });

  it("saves mode, preferences and step; done sets onboardedAt once", async () => {
    const { call } = setup();
    let res = await call("POST", "/api/me/onboarding", { defaultMode: "hunt", preferences: { role: "both", step: 2 } });
    expect(await res.json()).toMatchObject({ defaultMode: "hunt", preferences: { role: "both", step: 2 }, onboardedAt: null });
    res = await call("POST", "/api/me/onboarding", { preferences: { stack: ["Go", "go", " Rust "], currency: "sats", language: "en", step: 3 } });
    expect((await res.json()).preferences).toMatchObject({ role: "both", stack: ["Go", "Rust"], currency: "sats", language: "en", step: 3 });
    res = await call("POST", "/api/me/onboarding", { done: true });
    expect((await res.json()).onboardedAt).toBe("2026-10-18T12:00:00.000Z");
    const again = await (await call("GET", "/api/me/onboarding")).json();
    expect(again).toMatchObject({ defaultMode: "hunt", onboardedAt: "2026-10-18T12:00:00.000Z" });
  });

  it.each([
    [{ defaultMode: "both" }, "invalid_default_mode"],
    [{ preferences: { currency: "usd" } }, "invalid_currency"],
    [{ preferences: { step: 4 } }, "invalid_step"],
    [{ preferences: { repo: "../etc" } }, "invalid_repo"],
    [{ done: "yes" }, "invalid_done"],
    [[1], "invalid_body"],
  ])("refuses %j", async (body, error) => {
    const { call } = setup();
    const res = await call("POST", "/api/me/onboarding", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("saves a Lightning Address that resolves, masked in every answer", async () => {
    const { call, checker, store } = setup();
    const res = await call("POST", "/api/me/lightning-address", { lightningAddress: " Awa.Diop@Blink.sv " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lightningAddress: "aw***@blink.sv" });
    expect(checker.check).toHaveBeenCalledWith("awa.diop@blink.sv");
    expect((await store.get("awa-dev")).lightningAddress).toBe("awa.diop@blink.sv");
    expect((await (await call("GET", "/api/me/onboarding")).json()).lightningAddress).toBe("aw***@blink.sv");
  });

  it("400 on a malformed address (no LNURL call), 422 when it doesn't resolve (nothing saved)", async () => {
    const { call, checker, store } = setup({
      checker: {
        check: async () => {
          throw new LnurlError("aw***@nowhere.sv: LNURL server unreachable", true);
        },
      },
    });
    for (const bad of ["awa", "awa@", "@blink.sv", "awa@@blink.sv", "awa@blink", 42]) {
      const r = await call("POST", "/api/me/lightning-address", { lightningAddress: bad });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_lightning_address" });
    }
    expect(checker.check).not.toHaveBeenCalled();
    const r = await call("POST", "/api/me/lightning-address", { lightningAddress: "awa@nowhere.sv" });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "lightning_address_unreachable", retryable: true });
    expect((await store.get("awa-dev")).lightningAddress).toBeNull();
  });
});

describe("preferences parsing", () => {
  it("normalizePreferences drops bad stored values", () => {
    expect(normalizePreferences({ role: "boss", stack: [1, "Go"], currency: "eur", step: 9, repo: "a/b" })).toEqual({
      role: null,
      stack: ["Go"],
      currency: "xof",
      language: "fr",
      repo: "a/b",
      step: 3,
    });
  });
  it("parseProfilePatch ignores unknown keys", () => {
    expect(parseProfilePatch({ foo: 1, preferences: { language: "en", bar: 2 } })).toEqual({ ok: true, patch: { preferences: { language: "en" } } });
  });
});

describe("LNURL check (B6 resolver, first step only)", () => {
  const resolver = (fetch: typeof globalThis.fetch) => new HttpLnurlResolver({ fetch, network: "testnet", timeoutMs: 50 });

  it("reads the payRequest and asks for no invoice", async () => {
    const calls: string[] = [];
    const fetch = (async (u: string) => {
      calls.push(String(u));
      return json({ tag: "payRequest", callback: "https://blink.sv/cb", minSendable: 1000, maxSendable: 5e8, metadata: "[]" });
    }) as typeof globalThis.fetch;
    expect(await resolver(fetch).check("Awa@Blink.sv")).toEqual({ minSendableMsat: 1000, maxSendableMsat: 5e8 });
    expect(calls).toEqual(["https://blink.sv/.well-known/lnurlp/awa"]);
  });

  it("refuses a non-payRequest and an unreachable server", async () => {
    const notPay = (async () => json({ tag: "withdrawRequest" })) as unknown as typeof globalThis.fetch;
    await expect(resolver(notPay).check("awa@blink.sv")).rejects.toThrow(/not a payRequest/);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    await expect(resolver(down).check("awa@blink.sv")).rejects.toMatchObject({ retryable: true });
  });
});

describe("GitHub languages (public API, cached)", () => {
  it("counts own repos' languages, skips forks", () => {
    expect(
      topLanguages([
        { language: "Go" },
        { language: "TypeScript" },
        { language: "TypeScript" },
        { language: "Rust", fork: true },
        { language: null },
      ]),
    ).toEqual(["TypeScript", "Go"]);
  });

  it("caches per login and falls back to [] on failure", async () => {
    let t = 0;
    const fetch = vi.fn(async (u: string) => (String(u).includes("/users/ghost/") ? json({ message: "Not Found" }, 404) : json([{ language: "Python" }])));
    const languagesOf = githubLanguages({ fetch: fetch as never, now: () => t, ttlMs: 1000 });
    expect(await languagesOf("awa-dev")).toEqual(["Python"]);
    expect(await languagesOf("AWA-dev")).toEqual(["Python"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    t = 2000;
    await languagesOf("awa-dev");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await languagesOf("ghost")).toEqual([]);
    expect(await languagesOf("bad login!")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("payee: PAYOUT_ACCOUNTS, then the onboarding address", () => {
  it("falls back to the saved Lightning Address only on a config error", async () => {
    const missing = async (): Promise<never> => {
      throw new PayoutConfigError("no payout account");
    };
    const lookup = vi.fn(async (login: string) => (login === "awa-dev" ? "awa@blink.sv" : null));
    expect(await payeeWithFallback(async () => ({ lightningAddress: "env@blink.sv" }), lookup)("github:awa-dev")).toEqual({ lightningAddress: "env@blink.sv" });
    expect(await payeeWithFallback(missing, lookup)("github:awa-dev")).toEqual({ lightningAddress: "awa@blink.sv" });
    expect(lookup).toHaveBeenCalledWith("awa-dev");
    await expect(payeeWithFallback(missing, lookup)("github:moussa")).rejects.toBeInstanceOf(PayoutConfigError);
  });
});
