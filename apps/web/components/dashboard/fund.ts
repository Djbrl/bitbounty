// Browser-side call for "Fund N bounties". Kept apart from data.ts so the fixtures never ship to the client.
import type { FundResult } from "./shape";

/** POST /api/backlog/fund {ids} */
export async function fundBacklog(ids: string[], fetcher: typeof fetch = fetch): Promise<FundResult> {
  const res = await fetcher("/api/backlog/fund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<FundResult> & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `http_${res.status}`);
  return { count: json.count ?? 0, suggestions: json.suggestions ?? [], bountyIds: json.bountyIds ?? [] };
}
