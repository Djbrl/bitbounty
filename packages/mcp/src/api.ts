/** Thin client for the BitBounty agent API (`/v1`, apps/server/src/agents). */
export interface ApiConfig {
  /** Server origin, e.g. https://xxxx.trycloudflare.com or http://localhost:8787 */
  baseUrl: string;
  /** The agent's `bb_...` key. */
  agentKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  body: unknown;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The agent key travels as a bearer token, so it must never go over plain HTTP on a network:
 * `https` is allowed everywhere, `http` only for a loopback host (local dev). Throws otherwise.
 */
export function assertSafeBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`BITBOUNTY_API_URL is not a valid URL: ${JSON.stringify(baseUrl)}`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return;
  throw new Error(
    `BITBOUNTY_API_URL must use https (http is only allowed for localhost, 127.0.0.1 or ::1), got ${url.protocol}//${url.host}`,
  );
}

export class BitbountyApi {
  private readonly baseUrl: string;

  constructor(private readonly config: ApiConfig) {
    assertSafeBaseUrl(config.baseUrl);
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  postBounty(input: { repo: string; issue_number: number; amount_xof: number; criteria: string[]; issue_title?: string }) {
    return this.call("POST", "/v1/bounties", input);
  }

  getBounty(id: string) {
    return this.call("GET", `/v1/bounties/${encodeURIComponent(id)}`);
  }

  cancelBounty(id: string, reason?: string) {
    return this.call("DELETE", `/v1/bounties/${encodeURIComponent(id)}`, reason ? { reason } : undefined);
  }

  getBudget() {
    return this.call("GET", "/v1/budget");
  }

  private async call(method: string, path: string, body?: unknown): Promise<ApiResult> {
    const doFetch = this.config.fetchImpl ?? fetch;
    try {
      const res = await doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.agentKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // keep the raw text
      }
      return { ok: res.ok, status: res.status, body: parsed };
    } catch (err) {
      return { ok: false, status: 0, body: { error: "network_error", message: err instanceof Error ? err.message : String(err) } };
    }
  }
}
