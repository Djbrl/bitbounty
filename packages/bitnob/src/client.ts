import { authHeaders, newNonce } from "./sign.js";
import type {
  Bank,
  CreateCustomerInput,
  CreateLightningInvoiceInput,
  CreateVirtualAccountInput,
  Customer,
  InitializePayoutInput,
  LightningInvoice,
  Payout,
  PayoutQuote,
  PayoutQuoteInput,
  SimulatedDeposit,
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
  fetch?: typeof fetch;
  now?: () => Date;
  nonce?: () => string;
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

/** Reads `BITNOB_CLIENT_ID`, `BITNOB_CLIENT_SECRET` and optional `BITNOB_BASE_URL`. */
export function readBitnobConfig(env: NodeJS.ProcessEnv = process.env): BitnobConfig {
  const clientId = env.BITNOB_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.BITNOB_CLIENT_SECRET?.trim() ?? "";
  const missing = [!clientId && "BITNOB_CLIENT_ID", !clientSecret && "BITNOB_CLIENT_SECRET"].filter(Boolean);
  if (missing.length) {
    throw new BitnobError(`Missing ${missing.join(", ")} (see .env.example)`, 0, "CONFIG");
  }
  return { clientId, clientSecret, baseUrl: env.BITNOB_BASE_URL?.trim() || DEFAULT_BASE_URL };
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class BitnobClient {
  private readonly cfg: Required<Omit<BitnobConfig, "fetch">> & { fetch: typeof fetch };

  constructor(config: BitnobConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new BitnobError("Bitnob clientId and clientSecret are required", 0, "CONFIG");
    }
    this.cfg = {
      baseUrl: DEFAULT_BASE_URL,
      retries: 2,
      retryDelayMs: 300,
      timeoutMs: 15_000,
      now: () => new Date(),
      nonce: newNonce,
      ...config,
      fetch: config.fetch ?? globalThis.fetch,
    };
    this.cfg.baseUrl = this.cfg.baseUrl.replace(/\/+$/, "");
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
    const retries = opts.retries ?? this.cfg.retries;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(this.cfg.retryDelayMs * 2 ** (attempt - 1));
      // Fresh timestamp + nonce on every attempt, so a retry is never seen as a replay.
      const headers: Record<string, string> = {
        accept: "application/json",
        ...authHeaders(this.cfg.clientId, this.cfg.clientSecret, raw, this.cfg.now(), this.cfg.nonce()),
      };
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
    const data = await this.request<{ banks: Bank[] }>(
      "GET",
      `/api/payouts/banks/${encodeURIComponent(countryCode)}`,
    );
    return data.banks;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
