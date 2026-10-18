// Browser calls for the payout account: the mock /api/* in fixtures mode, the real server through
// the /api proxy otherwise (same URLs).

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, error: typeof json.error === "string" ? json.error : "unknown_error" };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

export interface PayoutAccountApi {
  /** Server checks the format, then that the address resolves (LNURL-pay), then saves it. Returns it masked. */
  saveLightningAddress(lightningAddress: string): Promise<ApiResult<{ lightningAddress: string }>>;
}

export const payoutAccountApi: PayoutAccountApi = {
  saveLightningAddress: (lightningAddress) => postJson("/api/me/lightning-address", { lightningAddress }),
};
