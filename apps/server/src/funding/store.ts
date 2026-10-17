import type { Funding } from "@bitbounty/core";

/** A funding attempt (one invoice, one naira account…) plus what the fund page needs to show. */
export interface FundingRecord extends Funding {
  funderId: string;
  /** What the bounty needs, and what we asked for on top (fee, buffer). Whole FCFA. */
  amountXof: number;
  feeXof: number;
  bufferXof: number;
  /** BOLT11 for Lightning; null for other rails. */
  paymentRequest: string | null;
  expiresAt: string | null;
  createdAt: string;
  /**
   * Set by `markPaid`: true if this payment is the one that funds the bounty (its first paid
   * funding), false if the bounty was already funded (the money is credited to the funder).
   */
  fundsBounty?: boolean;
  /**
   * Outbox flag: when `funding.paid` (or the credit) was delivered for this paid row. null/missing
   * while not delivered yet; `poll()` re-delivers such rows until this is set.
   */
  notifiedAt?: string | null;
}

export interface MarkPaidResult {
  funding: FundingRecord;
  /** true if this is the bounty's first paid funding: only that one funds the bounty. */
  firstForBounty: boolean;
}

export interface FundingStore {
  create(record: FundingRecord): Promise<FundingRecord>;
  get(id: string): Promise<FundingRecord | undefined>;
  listByBounty(bountyId: string): Promise<FundingRecord[]>;
  listPending(rail: Funding["rail"]): Promise<FundingRecord[]>;
  markExpired(id: string): Promise<FundingRecord | null>;
  /**
   * Atomically marks a funding paid (from `pending` or `expired`: money that arrived
   * is never ignored). null if it was already paid.
   */
  markPaid(id: string, paidAt: string): Promise<MarkPaidResult | null>;
  /** Paid rows whose event/credit hasn't been delivered yet (the outbox). */
  listUnnotified(rail: Funding["rail"]): Promise<FundingRecord[]>;
  /** Records that the row's `funding.paid` (or credit) was delivered. */
  markNotified(id: string, at: string): Promise<void>;
}

/** In-memory store. Every method is synchronous inside, so check-and-set can't interleave. */
export class InMemoryFundingStore implements FundingStore {
  private rows = new Map<string, FundingRecord>();

  async create(record: FundingRecord) {
    if (this.rows.has(record.id)) throw new Error(`funding ${record.id} already exists`);
    this.rows.set(record.id, { ...record });
    return { ...record };
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r && { ...r };
  }

  async listByBounty(bountyId: string) {
    return [...this.rows.values()].filter((r) => r.bountyId === bountyId).map((r) => ({ ...r }));
  }

  async listPending(rail: Funding["rail"]) {
    return [...this.rows.values()].filter((r) => r.rail === rail && r.status === "pending").map((r) => ({ ...r }));
  }

  async markExpired(id: string) {
    const r = this.rows.get(id);
    if (!r || r.status !== "pending") return null;
    r.status = "expired";
    return { ...r };
  }

  async markPaid(id: string, paidAt: string) {
    const r = this.rows.get(id);
    if (!r || r.status === "paid") return null;
    const firstForBounty = ![...this.rows.values()].some((o) => o.bountyId === r.bountyId && o.status === "paid");
    r.status = "paid";
    r.paidAt = paidAt;
    r.fundsBounty = firstForBounty;
    r.notifiedAt = null;
    return { funding: { ...r }, firstForBounty };
  }

  async listUnnotified(rail: Funding["rail"]) {
    return [...this.rows.values()]
      .filter((r) => r.rail === rail && r.status === "paid" && !r.notifiedAt)
      .map((r) => ({ ...r }));
  }

  async markNotified(id: string, at: string) {
    const r = this.rows.get(id);
    if (r) r.notifiedAt = at;
  }
}
