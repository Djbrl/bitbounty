import { createHash } from "node:crypto";
import { maskLightningAddress, parseLightningAddress } from "@bitbounty/core";
import { Bolt11Error, decodeBolt11, type LightningNetwork } from "./bolt11.js";

/**
 * Turns a Lightning Address into a BOLT11 invoice for an exact amount (LNURL-pay, LUD-06 + LUD-16).
 * Bitnob only pays BOLT11, so we resolve the address ourselves:
 *   user@domain → GET https://domain/.well-known/lnurlp/user → {tag:"payRequest", callback, minSendable, maxSendable, metadata}
 *               → GET callback?amount=<msat> → {pr: "<bolt11>"}
 * and refuse the invoice unless its amount is exactly what we asked, its network is ours,
 * it isn't (about to be) expired and, when it commits to a description hash, that hash is
 * sha256(metadata).
 */
export interface ResolvedInvoice {
  bolt11: string;
  paymentHash: string;
  amountMsat: number;
  /** ISO date. */
  expiresAt: string;
}

export interface LnurlResolver {
  invoiceFor(lightningAddress: string, amountMsat: number): Promise<ResolvedInvoice>;
}

/** What a Lightning Address accepts (its LNURL-pay parameters), without asking for an invoice. */
export interface LnurlPayParams {
  minSendableMsat: number;
  maxSendableMsat: number;
}

/** U1: onboarding checks that an address resolves before saving it (nothing is paid). */
export interface LnurlChecker {
  check(lightningAddress: string): Promise<LnurlPayParams>;
}

/**
 * Resolution failed; nothing was paid. `retryable`: the payee's server was down, slow or broken
 * (try again later). Not retryable: the address is invalid or the amount is outside what it accepts.
 */
export class LnurlError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LnurlError";
  }
}

export interface HttpLnurlResolverOptions {
  fetch?: typeof fetch;
  /** Per request. Default 10 s. */
  timeoutMs?: number;
  /** Network the invoices must be on: `testnet` with sandbox keys (lntb…), `bitcoin` in production (lnbc…). */
  network: LightningNetwork;
  /** Refuse an invoice with less than this left before it expires. Default 120 s. */
  minExpirySeconds?: number;
  /** Accept `user@localhost:port` / `127.0.0.1:port` over plain http. Tests and the sandbox proof only. */
  allowLocal?: boolean;
  now?: () => Date;
}

/** Bodies larger than this are refused (a Lightning Address answer is a few hundred bytes). */
const MAX_BODY = 64 * 1024;

export class HttpLnurlResolver implements LnurlResolver, LnurlChecker {
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly minExpirySeconds: number;
  private readonly now: () => Date;

  constructor(private readonly opts: HttpLnurlResolverOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.minExpirySeconds = opts.minExpirySeconds ?? 120;
    this.now = opts.now ?? (() => new Date());
  }

  /** Fetches and checks the address's payRequest (first LNURL-pay step). Throws LnurlError. */
  async check(lightningAddress: string): Promise<LnurlPayParams> {
    const { min, max } = await this.payRequest(lightningAddress);
    return { minSendableMsat: min, maxSendableMsat: max };
  }

  private async payRequest(lightningAddress: string) {
    const addr = parseLightningAddress(lightningAddress, { allowLocal: this.opts.allowLocal });
    if (!addr) throw new LnurlError(`invalid Lightning Address ${maskLightningAddress(lightningAddress)}`, false);
    const who = maskLightningAddress(lightningAddress);
    const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(addr.domain);
    const scheme = local ? "http" : "https";
    const params = await this.getJson(`${scheme}://${addr.domain}/.well-known/lnurlp/${encodeURIComponent(addr.user)}`, who);

    if (params.status === "ERROR") {
      throw new LnurlError(`${who}: LNURL server error: ${reason(params)}`, true);
    }
    if (params.tag !== "payRequest") throw new LnurlError(`${who}: not a payRequest (tag ${String(params.tag)})`, false);
    const min = Number(params.minSendable);
    const max = Number(params.maxSendable);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || min > max) {
      throw new LnurlError(`${who}: bad minSendable/maxSendable (${String(params.minSendable)}/${String(params.maxSendable)})`, true);
    }
    return { params, min, max, who, local };
  }

  async invoiceFor(lightningAddress: string, amountMsat: number): Promise<ResolvedInvoice> {
    if (!parseLightningAddress(lightningAddress, { allowLocal: this.opts.allowLocal })) {
      throw new LnurlError(`invalid Lightning Address ${maskLightningAddress(lightningAddress)}`, false);
    }
    if (!Number.isSafeInteger(amountMsat) || amountMsat < 1000) {
      throw new LnurlError(`invalid amount ${amountMsat} msat`, false);
    }
    const { params, min, max, who, local } = await this.payRequest(lightningAddress);
    if (amountMsat < min) {
      throw new LnurlError(`${who} accepts at least ${min} msat, the payout is ${amountMsat} msat`, false);
    }
    if (amountMsat > max) {
      throw new LnurlError(`${who} accepts at most ${max} msat, the payout is ${amountMsat} msat`, false);
    }
    const callback = this.checkUrl(params.callback, local, who);
    callback.searchParams.set("amount", String(amountMsat));

    const answer = await this.getJson(callback.toString(), who);
    if (answer.status === "ERROR") throw new LnurlError(`${who}: invoice refused: ${reason(answer)}`, true);
    if (typeof answer.pr !== "string" || !answer.pr) throw new LnurlError(`${who}: callback returned no invoice`, true);

    let inv;
    try {
      inv = decodeBolt11(answer.pr);
    } catch (err) {
      throw new LnurlError(`${who}: unreadable invoice (${err instanceof Bolt11Error ? err.message : "decode failed"})`, true);
    }
    if (inv.network !== this.opts.network) {
      throw new LnurlError(`${who}: invoice is for ${inv.network}, we pay on ${this.opts.network}`, false);
    }
    // The core check: never pay an invoice for anything but the exact amount we decided.
    if (inv.amountMsat === null || inv.amountMsat !== BigInt(amountMsat)) {
      throw new LnurlError(
        `${who}: invoice is for ${inv.amountMsat === null ? "any amount" : `${inv.amountMsat} msat`}, we asked ${amountMsat} msat`,
        false,
      );
    }
    const left = inv.expiresAt - Math.floor(this.now().getTime() / 1000);
    if (left < this.minExpirySeconds) {
      throw new LnurlError(`${who}: invoice expires in ${left}s (need ${this.minExpirySeconds}s)`, true);
    }
    if (inv.descriptionHash && typeof params.metadata === "string") {
      const expected = createHash("sha256").update(params.metadata, "utf8").digest("hex");
      if (inv.descriptionHash !== expected) throw new LnurlError(`${who}: invoice description hash doesn't match the metadata`, false);
    }
    return {
      bolt11: answer.pr,
      paymentHash: inv.paymentHash,
      amountMsat,
      expiresAt: new Date(inv.expiresAt * 1000).toISOString(),
    };
  }

  private checkUrl(value: unknown, local: boolean, who: string): URL {
    let url: URL;
    try {
      url = new URL(String(value));
    } catch {
      throw new LnurlError(`${who}: invalid callback URL`, true);
    }
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" && !isLocal) return url;
    if (url.protocol === "http:" && local && isLocal && this.opts.allowLocal) return url;
    throw new LnurlError(`${who}: callback must be https`, false);
  }

  private async getJson(url: string, who: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new LnurlError(`${who}: LNURL server ${timeout ? `timed out after ${this.timeoutMs} ms` : "unreachable"}`, true);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new LnurlError(`${who}: LNURL server closed the connection`, true);
    }
    if (text.length > MAX_BODY) throw new LnurlError(`${who}: LNURL answer too large`, true);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LnurlError(`${who}: LNURL server answered ${res.status} with non-JSON`, true);
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new LnurlError(`${who}: LNURL answer is not an object`, true);
    }
    const body = json as Record<string, unknown>;
    // LUD-06 errors come as {status:"ERROR", reason} (any HTTP status); other non-2xx are retryable failures.
    if (!res.ok && body.status !== "ERROR") throw new LnurlError(`${who}: LNURL server answered ${res.status}`, true);
    return body;
  }
}

/**
 * `LIGHTNING_NETWORK`: the network payout invoices must be on. Empty = `testnet`, what the Bitnob
 * sandbox pays (lntb…); set `bitcoin` (or `mainnet`) with production keys. Anything else throws at
 * boot, so a typo can't make us accept invoices for the wrong chain.
 */
export function readLightningNetwork(env: NodeJS.ProcessEnv = process.env): LightningNetwork {
  const raw = env.LIGHTNING_NETWORK?.trim().toLowerCase();
  if (!raw) return "testnet";
  if (raw === "mainnet" || raw === "bitcoin") return "bitcoin";
  if (raw === "testnet" || raw === "signet" || raw === "regtest") return raw;
  throw new Error(`LIGHTNING_NETWORK must be bitcoin, testnet, signet or regtest (got "${raw}")`);
}

function reason(body: Record<string, unknown>): string {
  return typeof body.reason === "string" ? body.reason.slice(0, 200) : "no reason";
}
