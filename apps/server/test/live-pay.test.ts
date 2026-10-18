import { BitnobError, type LightningPayment, type PayLightningInput } from "@bitbounty/bitnob";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_SATS, parseArgs, runLivePay, UsageError, type LiveBitnob, type LivePayDeps } from "../scripts/live-pay.js";
import { encodeBolt11 } from "./helpers/bolt11.js";

/** live-pay with fakes only: a fake Lightning Address server, a fake production Bitnob. Nothing real is called. */
const NOW = new Date("2026-10-18T12:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);
const METADATA = '[["text/plain","Pay bitbounty"]]';
const ENV = { BITNOB_PROD_CLIENT_ID: "id-123", BITNOB_PROD_CLIENT_SECRET: "sk_live_SECRET", LIVE_TEST_LIGHTNING_ADDRESS: "bitbounty@blink.sv" };

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** `bitbounty@blink.sv` answering with `invoice(msat)` (mainnet, exact amount, 10 min, committed metadata by default). */
function wallet(invoice: (msat: number) => string = (m) => encodeBolt11({ amountMsat: m, network: "bc", timestamp: T, expirySeconds: 600, metadata: METADATA })) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === "/.well-known/lnurlp/bitbounty") {
      return json({ tag: "payRequest", callback: "https://blink.sv/lnurlp/bitbounty/cb", minSendable: 1000, maxSendable: 100_000_000, metadata: METADATA });
    }
    return json({ pr: invoice(Number(url.searchParams.get("amount"))) });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

class FakeProdBitnob implements LiveBitnob {
  environment = "production";
  whoamiError: Error | null = null;
  pays: PayLightningInput[] = [];
  payStatus = "paid";
  async whoami() {
    if (this.whoamiError) throw this.whoamiError;
    return { active: true, active_company_id: "c", auth_method: "hmac", client_id: "id-123", client_name: "BitBounty", environment: this.environment, permissions: [] };
  }
  async getExchangeRate() {
    return { mid_rate: "600" } as never;
  }
  async getTradingPrice() {
    return { price: "100000" } as never;
  }
  async payLightningInvoice(input: PayLightningInput): Promise<LightningPayment> {
    this.pays.push(input);
    return { id: "lnp-live-1", status: this.payStatus, reference: input.reference, preimage: this.payStatus === "paid" ? "cd".repeat(32) : undefined };
  }
  async getLightningPayment(id: string): Promise<LightningPayment> {
    return { id, status: this.payStatus };
  }
  async findLightningPayment() {
    return null;
  }
}

function run(argv: string[], { fake, answer, ...over }: Partial<Omit<LivePayDeps, "bitnob">> & { fake?: FakeProdBitnob; answer?: string } = {}) {
  const lines: string[] = [];
  const bitnob = fake ?? new FakeProdBitnob();
  const prompt = vi.fn(async () => answer ?? "");
  const make = vi.fn(() => bitnob);
  const deps: LivePayDeps = {
    env: ENV,
    bitnob: make,
    fetch: over.fetch ?? wallet().fetch,
    prompt,
    out: (l) => lines.push(l),
    now: () => NOW,
    sleep: async () => {},
    pollForMs: 0,
    ...over,
  };
  const args = parseArgs(argv, "/nonexistent/.env.prod");
  return { done: runLivePay(args, deps), lines, bitnob, prompt, make, text: () => lines.join("\n") };
}

describe("live-pay args", () => {
  it("needs exactly one of --xof / --sats; --max-sats defaults to 1000; dry run by default", () => {
    expect(parseArgs(["--sats", "100"], "/x/.env.prod")).toEqual({ envFile: "/x/.env.prod", sats: 100, maxSats: DEFAULT_MAX_SATS, pay: false });
    expect(parseArgs(["--", "--xof=50", "--pay", "--env-file", "/tmp/e"], "/x")).toMatchObject({ xof: 50, pay: true, envFile: "/tmp/e" });
    expect(() => parseArgs([], "/x")).toThrow(UsageError);
    expect(() => parseArgs(["--sats", "1", "--xof", "1"], "/x")).toThrow(UsageError);
    expect(() => parseArgs(["--sats", "-5"], "/x")).toThrow(UsageError);
  });
});

describe("live-pay dry run", () => {
  it("resolves, decodes and checks the real-shaped invoice, prints the summary, sends nothing, never prints secrets", async () => {
    const r = run(["--sats", "100"]);
    expect(await r.done).toBe(0);
    const text = r.text();
    expect(text).toContain("whoami: environment=production");
    expect(text).toMatch(/sats\s+100/);
    expect(text).toMatch(/invoice amount\s+100 000 msat = 100 sats/);
    expect(text).toMatch(/network\s+bitcoin/);
    expect(text).toContain("= sha256(metadata) ✓");
    expect(text).toContain("bi***@blink.sv");
    expect(text).toContain("DRY RUN");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("id-123");
    expect(r.bitnob.pays).toHaveLength(0);
    expect(r.prompt).not.toHaveBeenCalled();
  });

  it("refuses above the hard cap, before any network call", async () => {
    const w = wallet();
    const r = run(["--sats", "5000"], { fetch: w.fetch });
    expect(await r.done).toBe(2);
    expect(r.text()).toContain("above the hard cap --max-sats 1 000");
    expect(w.calls).toHaveLength(0);
    // --xof converted above the cap too (50 000 FCFA ≈ 83 333 sats at 60 M FCFA/BTC)
    const x = run(["--xof", "50000"]);
    expect(await x.done).toBe(2);
    expect(x.text()).toContain("above the hard cap");
  });

  it("refuses a testnet invoice when mainnet (bitcoin) is expected", async () => {
    const r = run(["--sats", "100"], { fetch: wallet((m) => encodeBolt11({ amountMsat: m, network: "tb", timestamp: T, expirySeconds: 600 })).fetch });
    expect(await r.done).toBe(2);
    expect(r.text()).toContain("invoice is for testnet, we pay on bitcoin");
  });

  it("refuses an invoice for another amount", async () => {
    const r = run(["--sats", "100"], { fetch: wallet((m) => encodeBolt11({ amountMsat: m + 1000, network: "bc", timestamp: T, expirySeconds: 600 })).fetch });
    expect(await r.done).toBe(2);
    expect(r.text()).toContain("invoice is for 101000 msat, we asked 100000 msat");
  });

  it("works without creds when --sats is given (no rate needed); --xof needs creds", async () => {
    const r = run(["--sats", "100"], { env: { LIVE_TEST_LIGHTNING_ADDRESS: "bitbounty@blink.sv" } });
    expect(await r.done).toBe(0);
    expect(r.make).not.toHaveBeenCalled();
    expect(r.text()).toContain("whoami: skipped");
    const x = run(["--xof", "50"], { env: {} });
    expect(await x.done).toBe(2);
    expect(x.text()).toContain("pass --sats");
  });

  it("whoami 401: explains that the client ID and secret don't belong together", async () => {
    const bitnob = new FakeProdBitnob();
    bitnob.whoamiError = new BitnobError("GET /api/whoami failed: 401 UNAUTHORIZED", 401, "UNAUTHORIZED");
    const r = run(["--sats", "100"], { fake: bitnob });
    expect(await r.done).toBe(0); // the dry run still checks the invoice
    expect(r.text()).toContain("client ID and secret don't belong together");
    expect(r.text()).toContain("a secret issued for another company won't work with ours");
  });
});

describe("live-pay --pay", () => {
  it("refuses unless whoami says production (sandbox here): no prompt, no pay", async () => {
    const bitnob = new FakeProdBitnob();
    bitnob.environment = "sandbox";
    const r = run(["--sats", "100", "--pay"], { fake: bitnob, answer: "100" });
    expect(await r.done).toBe(2);
    expect(r.text()).toContain("--pay needs whoami environment=production (got sandbox)");
    expect(r.prompt).not.toHaveBeenCalled();
    expect(bitnob.pays).toHaveLength(0);
  });

  it("a confirmation that isn't the exact sats aborts, nothing sent", async () => {
    const r = run(["--sats", "100", "--pay"], { answer: "1000" });
    expect(await r.done).toBe(3);
    expect(r.text()).toContain("ABORTED");
    expect(r.bitnob.pays).toHaveLength(0);
  });

  it("refuses without an explicit LIVE_TEST_LIGHTNING_ADDRESS (no default destination for real money)", async () => {
    const { LIVE_TEST_LIGHTNING_ADDRESS: _a, ...env } = ENV;
    const r = run(["--sats", "100", "--pay"], { env, answer: "100" });
    expect(await r.done).toBe(2);
  });

  it("pays ONE invoice through B6's PayoutService (the confirmed one, reference pay-live-test-<ts>-1)", async () => {
    const r = run(["--sats", "100", "--pay"], { answer: "100" });
    expect(await r.done).toBe(0);
    expect(r.bitnob.pays).toHaveLength(1);
    const pay = r.bitnob.pays[0]!;
    expect(pay.reference).toBe(`pay-live-test-${NOW.getTime()}-1`);
    expect(pay.request).toMatch(/^lnbc1000000p1/); // 100 000 msat: the invoice the human confirmed
    expect(r.text()).toContain("PAID.");
  });

  it("a payment Bitnob reports failed is not retried", async () => {
    const bitnob = new FakeProdBitnob();
    bitnob.payStatus = "failed";
    const r = run(["--sats", "100", "--pay"], { fake: bitnob, answer: "100" });
    expect(await r.done).toBe(1);
    expect(bitnob.pays).toHaveLength(1);
    expect(r.text()).toMatch(/status\s+failed/);
  });
});
