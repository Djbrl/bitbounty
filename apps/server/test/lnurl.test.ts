import { describe, expect, it } from "vitest";
import { Bolt11Error, decodeBolt11, HttpLnurlResolver, LnurlError, readLightningNetwork } from "../src/payouts/index.js";
import { encodeBolt11 } from "./helpers/bolt11.js";

const NOW = new Date("2026-10-18T00:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);

describe("BOLT11 decoder", () => {
  it("reads a real Bitnob sandbox invoice like Bitnob's /lightning/decode does", () => {
    // Created in the sandbox on 2026-10-18 (100 sats, expired since). Bitnob decoded it as
    // amount_msat 100000, payment_hash ce1558f5…, expires_at 1792283584.
    const d = decodeBolt11(
      "lntb1u1p4dgypapp5ec243af5y4y874xp2q5yhs8hdk7e9tca4nkft9c39dzyjc7tag6qdqdvgmzqurjda3x2cqzpgxqzursp5yyd950yx43jzjer7d3v844tfsk6tu25vn0th0p8el34wm9najezq9qrsgqdg9w3ckt40w7xcpzguus9eaeyn48qavhtj84czwyffq9m3tn9s6z8k6n74j6kzve75gasgklavf8kanp2tkpzz7ed0pq58k3ylym4aqp5528aj",
    );
    expect(d).toMatchObject({
      network: "testnet",
      amountMsat: 100_000n,
      paymentHash: "ce1558f53425487f54c150284bc0f76dbd92af1dacec9597112b444963cbea34",
      expiresAt: 1792283584,
      description: "b6 probe",
      descriptionHash: null,
    });
  });

  it("round-trips the test encoder: amount, network, expiry, description hash", () => {
    const inv = encodeBolt11({ amountMsat: 408_000, network: "bc", timestamp: T, expirySeconds: 600, metadata: "[]" });
    const d = decodeBolt11(inv);
    expect(d).toMatchObject({ network: "bitcoin", amountMsat: 408_000n, timestamp: T, expiresAt: T + 600 });
    expect(d.descriptionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(decodeBolt11(encodeBolt11({ timestamp: T })).amountMsat).toBeNull();
    expect(decodeBolt11(encodeBolt11({ timestamp: T })).expirySeconds).toBe(3600);
  });

  it.each([
    ["a broken checksum", (s: string) => s.slice(0, -1) + (s.endsWith("q") ? "p" : "q")],
    ["not an invoice", () => "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"],
    ["mixed case", (s: string) => s.slice(0, 10).toUpperCase() + s.slice(10)],
    ["garbage", () => "hello"],
  ])("refuses %s", (_n, mutate) => {
    expect(() => decodeBolt11(mutate(encodeBolt11({ amountMsat: 1000, timestamp: T })))).toThrow(Bolt11Error);
  });
});

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A Lightning Address server: `awa@blink.sv`, answering for whatever amount (or a fixed/wrong one). */
function wallet(opts: { min?: number; max?: number; invoice?: (msat: number) => string; callback?: string; params?: Route } = {}) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname === "/.well-known/lnurlp/awa") {
      if (opts.params) return opts.params(url, init);
      return json({
        tag: "payRequest",
        callback: opts.callback ?? "https://blink.sv/lnurlp/awa/callback?k=1",
        minSendable: opts.min ?? 1_000,
        maxSendable: opts.max ?? 100_000_000,
        metadata: '[["text/plain","Pay awa"]]',
      });
    }
    if (url.pathname === "/lnurlp/awa/callback") {
      const msat = Number(url.searchParams.get("amount"));
      return json({ pr: (opts.invoice ?? ((m) => encodeBolt11({ amountMsat: m, timestamp: T, expirySeconds: 600 })))(msat), routes: [] });
    }
    return json({ status: "ERROR", reason: "not found" }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const resolver = (fetch: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof HttpLnurlResolver>[0]> = {}) =>
  new HttpLnurlResolver({ fetch, network: "testnet", now: () => NOW, timeoutMs: 50, ...extra });

async function refusal(p: Promise<unknown>): Promise<LnurlError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LnurlError);
  return err as LnurlError;
}

describe("LNURL-pay resolver", () => {
  it("Lightning Address → payRequest → callback?amount=<msat> → checked BOLT11", async () => {
    const w = wallet();
    const inv = await resolver(w.fetch).invoiceFor("Awa@Blink.sv", 408_000);
    expect(w.calls).toEqual(["https://blink.sv/.well-known/lnurlp/awa", "https://blink.sv/lnurlp/awa/callback?k=1&amount=408000"]);
    expect(inv).toMatchObject({ amountMsat: 408_000, expiresAt: new Date((T + 600) * 1000).toISOString() });
    expect(inv.paymentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("an invoice for a different amount than asked is refused, not retryable", async () => {
    const w = wallet({ invoice: (m) => encodeBolt11({ amountMsat: m + 1_000, timestamp: T, expirySeconds: 600 }) });
    const err = await refusal(resolver(w.fetch).invoiceFor("awa@blink.sv", 408_000));
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("invoice is for 409000 msat, we asked 408000 msat");
    expect(err.message).not.toContain("awa@"); // the address is masked
  });

  it("an any-amount invoice is refused (we only pay the exact amount we asked)", async () => {
    const w = wallet({ invoice: () => encodeBolt11({ timestamp: T, expirySeconds: 600 }) });
    expect((await refusal(resolver(w.fetch).invoiceFor("awa@blink.sv", 408_000))).message).toContain("any amount");
  });

  it("an invoice for another network is refused", async () => {
    const w = wallet({ invoice: (m) => encodeBolt11({ amountMsat: m, network: "bc", timestamp: T, expirySeconds: 600 }) });
    const err = await refusal(resolver(w.fetch).invoiceFor("awa@blink.sv", 408_000));
    expect(err.message).toContain("invoice is for bitcoin, we pay on testnet");
    expect(err.retryable).toBe(false);
  });

  it("an expired or nearly expired invoice is refused, retryable (ask again for a fresh one)", async () => {
    for (const expiry of [0, 60]) {
      const w = wallet({ invoice: (m) => encodeBolt11({ amountMsat: m, timestamp: T, expirySeconds: expiry }) });
      const err = await refusal(resolver(w.fetch).invoiceFor("awa@blink.sv", 408_000));
      expect(err.retryable).toBe(true);
      expect(err.message).toMatch(/expires in -?\d+s/);
    }
  });

  it("amount below minSendable / above maxSendable: refused before asking for an invoice", async () => {
    const low = wallet({ min: 500_000 });
    const a = await refusal(resolver(low.fetch).invoiceFor("awa@blink.sv", 408_000));
    expect(a.message).toContain("accepts at least 500000 msat");
    expect(a.retryable).toBe(false);
    expect(low.calls).toHaveLength(1);
    const high = wallet({ max: 100_000 });
    const b = await refusal(resolver(high.fetch).invoiceFor("awa@blink.sv", 408_000));
    expect(b.message).toContain("accepts at most 100000 msat");
    expect(high.calls).toHaveLength(1);
  });

  describe("LNURL server down / slow / broken → clean retryable failure", () => {
    it.each<[string, Route]>([
      ["down (connection refused)", () => Promise.reject(new TypeError("fetch failed"))],
      ["slow (no answer before the timeout)", (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))))],
      ["an HTML page", () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } })],
      ["HTML with 200", () => new Response("<!doctype html><p>hi</p>", { status: 200 })],
      ["a 500 with JSON", () => json({ message: "boom" }, 500)],
      ["a LUD-06 error", () => json({ status: "ERROR", reason: "wallet offline" })],
      ["a JSON array", () => json([1, 2])],
      ["bad min/max", () => json({ tag: "payRequest", callback: "https://blink.sv/cb", minSendable: "x", maxSendable: 1, metadata: "[]" })],
    ])("%s", async (_n, params) => {
      const err = await refusal(resolver(wallet({ params }).fetch).invoiceFor("awa@blink.sv", 408_000));
      expect(err.retryable).toBe(true);
    });

    it("a callback that returns no invoice, or garbage, is retryable", async () => {
      const w = wallet({ invoice: () => "not-a-bolt11" });
      expect((await refusal(resolver(w.fetch).invoiceFor("awa@blink.sv", 408_000))).retryable).toBe(true);
    });
  });

  it("not a payRequest, or a plain-http callback: refused, not retryable", async () => {
    const tag = wallet({ params: () => json({ tag: "withdrawRequest" }) });
    expect((await refusal(resolver(tag.fetch).invoiceFor("awa@blink.sv", 408_000))).retryable).toBe(false);
    const http = wallet({ callback: "http://blink.sv/lnurlp/awa/callback" });
    expect((await refusal(resolver(http.fetch).invoiceFor("awa@blink.sv", 408_000))).message).toContain("callback must be https");
  });

  it("checks the description hash when the invoice has one", async () => {
    const good = wallet({ invoice: (m) => encodeBolt11({ amountMsat: m, timestamp: T, expirySeconds: 600, metadata: '[["text/plain","Pay awa"]]' }) });
    await expect(resolver(good.fetch).invoiceFor("awa@blink.sv", 408_000)).resolves.toMatchObject({ amountMsat: 408_000 });
    const bad = wallet({ invoice: (m) => encodeBolt11({ amountMsat: m, timestamp: T, expirySeconds: 600, metadata: "something else" }) });
    expect((await refusal(resolver(bad.fetch).invoiceFor("awa@blink.sv", 408_000))).message).toContain("description hash");
  });

  it("refuses an invalid address, and a local one unless allowLocal (tests / sandbox proof only)", async () => {
    const w = wallet();
    expect((await refusal(resolver(w.fetch).invoiceFor("not an address", 408_000))).retryable).toBe(false);
    expect((await refusal(resolver(w.fetch).invoiceFor("dev@127.0.0.1:8787", 408_000))).retryable).toBe(false);
    expect(w.calls).toHaveLength(0);
    const local = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/.well-known")) {
        return json({ tag: "payRequest", callback: `http://127.0.0.1:8787/cb`, minSendable: 1000, maxSendable: 1e9, metadata: "[]" });
      }
      return json({ pr: encodeBolt11({ amountMsat: Number(url.searchParams.get("amount")), timestamp: T, expirySeconds: 600 }) });
    }) as typeof fetch;
    await expect(resolver(local, { allowLocal: true }).invoiceFor("dev@127.0.0.1:8787", 2_000)).resolves.toMatchObject({ amountMsat: 2_000 });
  });

  it("refuses an amount that isn't whole sats ≥ 1", async () => {
    expect((await refusal(resolver(wallet().fetch).invoiceFor("awa@blink.sv", 999))).retryable).toBe(false);
  });
});

describe("LIGHTNING_NETWORK", () => {
  it.each([
    [undefined, "testnet"],
    ["", "testnet"],
    ["mainnet", "bitcoin"],
    ["BITCOIN", "bitcoin"],
    ["signet", "signet"],
  ])("%j → %s", (v, net) => {
    expect(readLightningNetwork(v === undefined ? {} : { LIGHTNING_NETWORK: v })).toBe(net);
  });
  it("refuses a typo at boot", () => {
    expect(() => readLightningNetwork({ LIGHTNING_NETWORK: "testnett" })).toThrow("LIGHTNING_NETWORK must be");
  });
});
