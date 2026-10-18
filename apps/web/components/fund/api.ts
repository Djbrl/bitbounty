// Browser calls to the mock `/api/*` route (I1 points them at the real API). Kept apart from
// data.ts so the client bundle never pulls in the fixtures.
import type { FundingRail, FundingSession, PollResult } from "./data";

export class FundApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new FundApiError(res.status, json.error ?? "request_failed");
  return json as T;
}

/** Browser: POST /api/bounties/:id/funding {rail} → a fresh invoice / address / account (15 min). */
export function createFunding(id: string, rail: FundingRail): Promise<FundingSession> {
  return call(`/api/bounties/${encodeURIComponent(id)}/funding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rail }),
  });
}

/**
 * Browser: POST /api/bounties/:id/funding/simulate → settles the open sandbox (testnet) invoice.
 * The server refuses (403 sandbox_only) on production Bitnob keys.
 */
export function simulateFunding(id: string): Promise<PollResult> {
  return call(`/api/bounties/${encodeURIComponent(id)}/funding/simulate`, { method: "POST" });
}

/** Browser: GET /api/bounties/:id/funding → pending | paid. */
export function pollFunding(id: string): Promise<PollResult> {
  return call(`/api/bounties/${encodeURIComponent(id)}/funding`);
}
