// Data access for /b/[id] and /r/[id].
// Today: the pure mock handler over fixtures/*.json (works in `next build`, no server needed).
// I1 swaps the bodies of these functions for `fetch('/api/bounties/:id')` / `fetch('/api/receipts/:id')`;
// the pages only depend on the signatures below.
import bounties from "../../../../fixtures/bounties.json";
import receipts from "../../../../fixtures/receipts.json";
import type { BountyDetail, Receipt } from "../../../../fixtures/types";
import { apiBaseUrl, load } from "../../lib/api";
import { handleMock, type Fixtures } from "../../lib/mock-api";

export type { BountyDetail, Receipt };

const fx = { bounties, receipts } as unknown as Fixtures;

function get<T>(path: string[]): T | null {
  const res = handleMock(fx, "GET", path, new URLSearchParams());
  return "json" in res && res.status === 200 ? (res.json as T) : null;
}

/** GET /api/bounties/:id — null when the id is unknown (page renders a 404). */
export async function getBounty(id: string): Promise<BountyDetail | null> {
  return load(`/api/bounties/${encodeURIComponent(id)}`, () => get<BountyDetail>(["bounties", id]));
}

/** GET /api/receipts/:id — null when the id is unknown. */
export async function getReceipt(id: string): Promise<Receipt | null> {
  return load(`/api/receipts/${encodeURIComponent(id)}`, () => get<Receipt>(["receipts", id]));
}

/** Receipt id for a paid bounty, if one exists (links /b → /r). */
export async function receiptIdForBounty(bountyId: string): Promise<string | null> {
  // Real server: the receipt id is the succeeded payout's id.
  if (apiBaseUrl()) {
    const b = await getBounty(bountyId);
    return b?.payout?.status === "succeeded" ? b.payout.id : null;
  }
  const all = fx.receipts as Record<string, Receipt>;
  return Object.values(all).find((r) => r.bountyId === bountyId)?.id ?? null;
}

/** Ids to pre-render at build time. */
export function bountyIds(): string[] {
  return fx.bounties.map((b) => b.id);
}

export function receiptIds(): string[] {
  return Object.keys(fx.receipts);
}
