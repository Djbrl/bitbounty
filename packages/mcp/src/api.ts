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

export class BitbountyApi {
  private readonly baseUrl: string;

  constructor(private readonly config: ApiConfig) {
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
