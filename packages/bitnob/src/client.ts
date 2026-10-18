import { authHeaders, newNonce } from "./sign.js";
import type {
  Bank,
  CreateCustomerInput,
  CreateLightningInvoiceInput,
  CreateVirtualAccountInput,
  Customer,
  DecodedLightningInvoice,
  ExchangeRate,
  InitializePayoutInput,
  LightningInvoice,
  LightningPayment,
  PayLightningInput,
  Payout,
  PayoutQuote,
  PayoutQuoteInput,
  SimulatedDeposit,
  TradingOrder,
  TradingOrderInput,
  TradingPrice,
  TradingQuote,
  TradingQuoteInput,
  VirtualAccount,
  WhoAmI,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.bitnob.com";

export interface BitnobConfig {
  clientId: string;
  clientSecret: string;
  /** Same host for sandbox and production; the secret picks the environment. */
  baseUrl?: string;
  /** Extra attempts on network errors, 429 and 5xx. Each attempt is signed with a fresh nonce. */
  retries?: number;
  /** Milliseconds before the first retry, doubled each time. */
  retryDelayMs?: number;
  timeoutMs?: number;
  /** Upper bound for a 429/503 `Retry-After` wait, in milliseconds (default 30 s). */
  maxRetryAfterMs?: number;
  fetch?: typeof fetch;
  /** Waits between attempts (tests replace it). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  nonce?: () => string;
  /**
   * Proxy mode (F7): send every call to the team's dev proxy (`baseUrl` = `https://<tunnel>/dev/bitnob`)
   * with `Authorization: Bearer <proxyToken>`. The proxy signs with the server's keys, so this client
   * skips HMAC signing and needs no clientId / clientSecret.
   */
  proxyToken?: string;
  /** Proxy mode only: your name in the proxy's log (`X-Dev-User` header). */
  proxyUser?: string;
}

/** A raw Bitnob answer, as returned by `BitnobClient.forward`. */
export interface RawResponse {
  status: number;
  contentType: string | null;
  body: string;
}

export interface RequestOptions {
  /** Overrides `BitnobConfig.retries` for this call (0 = a single attempt). */
  retries?: number;
}

/** Any failed Bitnob call. Never contains the client secret. */
export class BitnobError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the request never got an answer. */
    readonly status: number,
    /** Bitnob's `code` (e.g. UNAUTHORIZED), or NETWORK / TIMEOUT / BAD_RESPONSE / CONFIG. */
    readonly code: string,
    readonly detail?: string,
    readonly correlationId?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "BitnobError";
  }
}

/**
 * Reads `BITNOB_CLIENT_ID`, `BITNOB_CLIENT_SECRET` and optional `BITNOB_BASE_URL`.
 * With `BITNOB_PROXY_TOKEN` set (proxy mode, F7) the keys are not needed: `BITNOB_BASE_URL` must point
 * at the proxy, and `BITNOB_PROXY_USER` (optional) names you in its log.
 */
export function readBitnobConfig(env: NodeJS.ProcessEnv = process.env): BitnobConfig {
  const clientId = env.BITNOB_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.BITNOB_CLIENT_SECRET?.trim() ?? "";
  const proxyToken = env.BITNOB_PROXY_TOKEN?.trim() ?? "";
  if (proxyToken) {
    const baseUrl = env.BITNOB_BASE_URL?.trim() ?? "";
    if (!baseUrl) {
      throw new BitnobError("BITNOB_PROXY_TOKEN needs BITNOB_BASE_URL=https://<tunnel>/dev/bitnob", 0, "CONFIG");
    }
    const proxyUser = env.BITNOB_PROXY_USER?.trim() || undefined;
    return { clientId, clientSecret, baseUrl, proxyToken, ...(proxyUser ? { proxyUser } : {}) };
  }
  const missing = [!clientId && "BITNOB_CLIENT_ID", !clientSecret && "BITNOB_CLIENT_SECRET"].filter(Boolean);
  if (missing.length) {
    throw new BitnobError(`Missing ${missing.join(", ")} (see .env.example)`, 0, "CONFIG");
  }
  return { clientId, clientSecret, baseUrl: env.BITNOB_BASE_URL?.trim() || DEFAULT_BASE_URL };
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class BitnobClient {
  /** Not an own enumerable property: `inspect(client)` and `JSON.stringify(client)` never show it. */
  readonly #secret: string;
  /** Proxy mode token, private for the same reason. */
  readonly #proxyToken: string;
  private readonly cfg: Required<Omit<BitnobConfig, "fetch" | "clientSecret" | "proxyToken" | "proxyUser">> & {
    fetch: typeof fetch;
    proxyUser?: string;
  };

  constructor(config: BitnobConfig) {
    const proxyToken = config.proxyToken?.trim() ?? "";
    if (!proxyToken && (!config.clientId || !config.clientSecret)) {
      throw new BitnobError("Bitnob clientId and clientSecret are required", 0, "CONFIG");
    }
    const { clientSecret, proxyToken: _token, ...rest } = config;
    this.#secret = clientSecret;
    this.#proxyToken = proxyToken;
    this.cfg = {
      baseUrl: DEFAULT_BASE_URL,
      retries: 2,
      retryDelayMs: 300,
      timeoutMs: 15_000,
      maxRetryAfterMs: 30_000,
      now: () => new Date(),
      nonce: newNonce,
      sleep,
      ...rest,
      fetch: config.fetch ?? globalThis.fetch,
    };
    this.cfg.baseUrl = this.cfg.baseUrl.replace(/\/+$/, "");
  }

  /** True when calls go through the team's dev proxy (no local signing). */
  get proxyMode(): boolean {
    return this.#proxyToken !== "";
  }

  /** HMAC headers, or the proxy's bearer token in proxy mode. Fresh timestamp + nonce on every call. */
  private authFor(raw: string): Record<string, string> {
    if (this.#proxyToken) {
      const h: Record<string, string> = { authorization: `Bearer ${this.#proxyToken}` };
      if (this.cfg.proxyUser) h["x-dev-user"] = this.cfg.proxyUser;
      return h;
    }
    return { ...authHeaders(this.cfg.clientId, this.#secret, raw, this.cfg.now(), this.cfg.nonce()) };
  }

  /**
   * One signed attempt, no retries, no parsing: Bitnob's status and body come back unchanged.
   * Used by the dev proxy (F7). `pathAndQuery` must start with `/api/`. Throws `BitnobError`
   * (TIMEOUT / NETWORK, status 0) only when Bitnob never answered.
   */
  async forward(method: string, pathAndQuery: string, body = "", opts: { timeoutMs?: number } = {}): Promise<RawResponse> {
    const url = this.cfg.baseUrl + pathAndQuery;
    if (!pathAndQuery.startsWith("/api/") || new URL(url).origin !== new URL(this.cfg.baseUrl).origin) {
      throw new BitnobError("forward: only /api/ paths on the configured Bitnob host", 0, "CONFIG");
    }
    const headers: Record<string, string> = { accept: "application/json", ...this.authFor(body) };
    if (body) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.cfg.fetch(url, {
        method,
        headers,
        body: body || undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.cfg.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new BitnobError(
        `${method} ${pathAndQuery.split("?")[0]}: ${timeout ? "timed out" : `network error (${errMessage(err)})`}`,
        0,
        timeout ? "TIMEOUT" : "NETWORK",
      );
    }
    return { status: res.status, contentType: res.headers.get("content-type"), body: await res.text() };
  }

  /** Signed call; returns the envelope's `data`. Throws `BitnobError`. */
  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    // Sign exactly the string we send (compact JSON), or "" without a body.
    const raw = body === undefined ? "" : JSON.stringify(body);
    const url = this.cfg.baseUrl + path;
    let lastError: BitnobError | undefined;
    let retryAfterMs: number | undefined;
    const retries = opts.retries ?? this.cfg.retries;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const backoff = this.cfg.retryDelayMs * 2 ** (attempt - 1);
        await this.cfg.sleep(Math.max(backoff, retryAfterMs ?? 0));
        retryAfterMs = undefined;
      }
      // Fresh timestamp + nonce on every attempt, so a retry is never seen as a replay.
      const headers: Record<string, string> = { accept: "application/json", ...this.authFor(raw) };
      if (raw) headers["content-type"] = "application/json";

      let res: Response;
      try {
        res = await this.cfg.fetch(url, {
          method,
          headers,
          body: raw || undefined,
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
      } catch (err) {
        const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        lastError = new BitnobError(
          `${method} ${path}: ${timeout ? "timed out" : `network error (${errMessage(err)})`}`,
          0,
          timeout ? "TIMEOUT" : "NETWORK",
        );
        continue;
      }

      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }

      if (res.ok) {
        if (!isObject(json)) {
          throw new BitnobError(`${method} ${path}: response is not JSON`, res.status, "BAD_RESPONSE", text.slice(0, 200));
        }
        return ("data" in json ? json.data : json) as T;
      }

      lastError = toError(method, path, res.status, json, text);
      if (!RETRYABLE(res.status)) throw lastError;
      retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), this.cfg.now(), this.cfg.maxRetryAfterMs);
    }
    throw lastError!;
  }

  whoami() {
    return this.request<WhoAmI>("GET", "/api/whoami");
  }

  createCustomer(input: CreateCustomerInput) {
    return this.request<Customer>("POST", "/api/customers", input);
  }

  async createLightningInvoice(input: CreateLightningInvoiceInput): Promise<LightningInvoice> {
    const data = await this.request<{ invoice?: LightningInvoice } & LightningInvoice>(
      "POST",
      "/api/lightning/invoices",
      input,
    );
    return data.invoice ?? data;
  }

  async getLightningInvoice(id: string): Promise<LightningInvoice> {
    const data = await this.request<{ invoice?: LightningInvoice } & LightningInvoice>(
      "GET",
      `/api/lightning/invoices/${encodeURIComponent(id)}`,
    );
    return data.invoice ?? data;
  }

  /**
   * Pays a BOLT11 invoice from our BTC balance. **Moves money.** Payout code passes
   * `{ retries: 0 }`: after a timeout the payment may have gone through, and the caller must
   * find out instead of blindly replaying (see apps/server/src/payouts/README.md).
   */
  async payLightningInvoice(input: PayLightningInput, opts?: RequestOptions): Promise<LightningPayment> {
    const data = await this.request<({ payment?: LightningPayment; transaction?: LightningPayment } & LightningPayment) | undefined>(
      "POST",
      "/api/lightning/pay",
      input,
      opts,
    );
    return data?.payment ?? data?.transaction ?? data ?? {};
  }

  /**
   * A Lightning payment or invoice by Bitnob id. Bitnob lists outgoing payments with the
   * invoices (`direction`), so this reads `/api/lightning/invoices/:id` (unverified for payments:
   * the sandbox refuses `send_lightning` on our account).
   */
  async getLightningPayment(id: string): Promise<LightningPayment> {
    const data = await this.request<{ invoice?: LightningPayment; payment?: LightningPayment } & LightningPayment>(
      "GET",
      `/api/lightning/invoices/${encodeURIComponent(id)}`,
    );
    return data.payment ?? data.invoice ?? data;
  }

  /**
   * An outgoing Lightning payment by the `reference` we sent or its payment hash, or null when
   * Bitnob lists none. Reads `GET /api/lightning/invoices?reference=…` (the documented list of
   * invoices and payments) and filters the answer here, so it stays correct if Bitnob ignores the
   * query parameter. **Unverified for outgoing payments** (the sandbox refuses `send_lightning`);
   * only the first page is read. A read: never moves money, safe to call on every status check.
   */
  async findLightningPayment(q: { reference?: string; paymentHash?: string }): Promise<LightningPayment | null> {
    if (!q.reference && !q.paymentHash) return null;
    const params = new URLSearchParams();
    if (q.reference) params.set("reference", q.reference);
    if (q.paymentHash) params.set("payment_hash", q.paymentHash);
    const data = await this.request<unknown>("GET", `/api/lightning/invoices?${params}`);
    const list = pickList(data);
    return (
      list.find(
        (p) => (q.reference && p.reference === q.reference) || (q.paymentHash && p.payment_hash === q.paymentHash),
      ) ?? null
    );
  }

  /** Structural decode of a BOLT11 (amount, expiry, payment hash). Pays nothing. */
  async decodeLightningInvoice(request: string): Promise<DecodedLightningInvoice> {
    const data = await this.request<{ invoice?: DecodedLightningInvoice } & DecodedLightningInvoice>(
      "POST",
      "/api/lightning/decode",
      { request },
    );
    return data.invoice ?? data;
  }

  async createPayoutQuote(input: PayoutQuoteInput): Promise<PayoutQuote> {
    const data = await this.request<{ payout: PayoutQuote }>("POST", "/api/payouts/quotes", input);
    return data.payout;
  }

  /** Locks the quote and attaches the beneficiary. */
  async initializePayout(quoteId: string, input: InitializePayoutInput): Promise<Payout> {
    const data = await this.request<{ payout: Payout }>(
      "POST",
      `/api/payouts/${encodeURIComponent(quoteId)}/initialize`,
      { quote_id: quoteId, ...input },
    );
    return data.payout;
  }

  /**
   * Commits the debit and releases the payout. Irreversible.
   * Pass `{ retries: 0 }` from payout code: a blind replay of a finalize that timed out
   * may have gone through, and the caller must ask `getPayout` instead.
   */
  async finalizePayout(quoteId: string, opts?: RequestOptions): Promise<Payout | undefined> {
    const data = await this.request<{ payout?: Payout } | undefined>(
      "POST",
      `/api/payouts/${encodeURIComponent(quoteId)}/finalize`,
      undefined,
      opts,
    );
    return data?.payout;
  }

  /** `id` is the payout id returned by the quote (`PayoutQuote.id`), not the quote id. */
  async getPayout(id: string): Promise<Payout> {
    const data = await this.request<{ payout: Payout }>("GET", `/api/payouts/${encodeURIComponent(id)}`);
    return data.payout;
  }

  async getBanks(countryCode: string): Promise<Bank[]> {
    const data = await this.request<{ banks: Bank[] | null }>(
      "GET",
      `/api/payouts/banks/${encodeURIComponent(countryCode)}`,
    );
    // The sandbox answers `banks: null` for SN.
    return data.banks ?? [];
  }

  async createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccount> {
    const data = await this.request<{ virtual_account: VirtualAccount }>("POST", "/api/virtual-accounts", input);
    return data.virtual_account;
  }

  /** Sandbox only: fakes an inbound naira transfer to the account. */
  simulateDeposit(virtualAccountId: string) {
    return this.request<SimulatedDeposit>(
      "POST",
      `/api/virtual-accounts/${encodeURIComponent(virtualAccountId)}/simulate-deposit`,
    );
  }

  async createTradingQuote(input: TradingQuoteInput): Promise<TradingQuote> {
    const data = await this.request<{ quote: TradingQuote }>("POST", "/api/trading/quotes", input);
    return data.quote;
  }

  async createTradingOrder(input: TradingOrderInput): Promise<TradingOrder> {
    const data = await this.request<{ order: TradingOrder }>("POST", "/api/trading/orders", input);
    return data.order;
  }

  /** By order id or by the `reference` we sent. */
  async getTradingOrder(idOrReference: string): Promise<TradingOrder> {
    const data = await this.request<{ order: TradingOrder }>(
      "GET",
      `/api/trading/orders/${encodeURIComponent(idOrReference)}`,
    );
    return data.order;
  }

  /** Mid-market rate for `from` → `to` (`to` per 1 `from`). */
  getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
    const q = new URLSearchParams({ from, to });
    return this.request<ExchangeRate>("GET", `/api/exchange-rates?${q}`);
  }

  /** Spot price of a trading pair, e.g. BTC/USDT. */
  async getTradingPrice(base: string, quote: string): Promise<TradingPrice> {
    const q = new URLSearchParams({ base_currency: base, quote_currency: quote });
    const data = await this.request<{ price: TradingPrice }>("GET", `/api/trading/prices?${q}`);
    return data.price;
  }
}

/** The array in a list answer: `[...]`, `{invoices: [...]}`, `{payments: [...]}`, `{items|data|results: [...]}`. */
function pickList(data: unknown): LightningPayment[] {
  if (Array.isArray(data)) return data.filter(isObject) as LightningPayment[];
  if (!isObject(data)) return [];
  for (const k of ["invoices", "payments", "transactions", "items", "data", "results"]) {
    const v = data[k];
    if (Array.isArray(v)) return v.filter(isObject) as LightningPayment[];
    if (isObject(v)) {
      const inner = pickList(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

function toError(method: string, path: string, status: number, json: unknown, text: string): BitnobError {
  // Two error shapes: RFC 7807 ({title, detail, code, correlation_id}) and
  // validation ({success:false, error:{code, message, details}}).
  let code = `HTTP_${status}`;
  let detail: string | undefined = text ? text.slice(0, 200) : undefined;
  let correlationId: string | undefined;
  if (isObject(json)) {
    const inner = isObject(json.error) ? json.error : json;
    if (typeof inner.code === "string") code = inner.code;
    const d = inner.detail ?? inner.message ?? json.title;
    if (typeof d === "string") detail = d;
    if (typeof json.correlation_id === "string") correlationId = json.correlation_id;
  }
  const hint = status === 401 ? " (check BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET and the machine clock)" : "";
  return new BitnobError(
    `${method} ${path} failed: ${status} ${code}${detail ? `: ${detail}` : ""}${hint}`,
    status,
    code,
    detail,
    correlationId,
    json,
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `Retry-After` as milliseconds: delta-seconds or an HTTP date, capped at `max`.
 * Undefined when absent or unreadable (the normal backoff applies).
 */
export function parseRetryAfter(value: string | null, now: Date, max: number): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000;
  else {
    // An HTTP date always has a day/month name; "-1" or "1e3" are not dates.
    const at = /[a-z]{3}/i.test(v) ? Date.parse(v) : Number.NaN;
    if (Number.isNaN(at)) return undefined;
    ms = at - now.getTime();
  }
  return Math.min(Math.max(ms, 0), max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
