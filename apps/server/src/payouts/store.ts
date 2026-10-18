import type { Payout } from "@bitbounty/core";

/**
 * One payout row per bounty (reference `pay-<bountyId>`); retries update the row,
 * they never add one. Same shape as the `payouts` table in packages/db (F3).
 *
 * Status meaning here:
 *   pending     waiting for the next attempt (`attempts` = attempts done so far)
 *   processing  attempt number `attempts` is in flight or awaiting Bitnob's outcome
 *   succeeded   paid (terminal)
 *   failed      gave up after the last attempt (the money stays reserved for the developer)
 */
/** What `update` expects the row to still look like. */
export interface PayoutExpectation {
  status: Payout["status"];
  attempts?: number;
  /** Columns that must still be null. */
  unset?: readonly ("paymentRequest" | "sentAt")[];
}

export interface PayoutStore {
  /** Inserts, or returns the existing row for this bounty. */
  create(payout: Payout): Promise<{ inserted: boolean; payout: Payout }>;
  get(id: string): Promise<Payout | undefined>;
  getByBounty(bountyId: string): Promise<Payout | undefined>;
  findByBitnob(ids: { bitnobPayoutId?: string | null; quoteId?: string | null }): Promise<Payout | undefined>;
  listByStatus(status: Payout["status"]): Promise<Payout[]>;
  /**
   * Compare-and-set: applies `patch` only if the row still has `expected.status`
   * (and `expected.attempts` when given, and every column in `expected.unset` still null).
   * Returns the new row, or null if someone else changed it first. This is what stops two
   * workers from paying twice: saving the invoice expects `paymentRequest` unset, marking the
   * send expects `sentAt` unset, so only one worker can do either for an attempt.
   */
  update(
    id: string,
    expected: PayoutExpectation,
    patch: Partial<Omit<Payout, "id" | "bountyId" | "reference">>,
  ): Promise<Payout | null>;
}

/** In-memory store for tests, scripts and the offline demo. */
export class InMemoryPayoutStore implements PayoutStore {
  private rows = new Map<string, Payout>();

  async create(payout: Payout) {
    // No await before the insert: check-and-set must be atomic, like the unique index in Postgres.
    const existing = [...this.rows.values()].find((r) => r.bountyId === payout.bountyId);
    if (existing) return { inserted: false, payout: { ...existing } };
    this.rows.set(payout.id, { ...payout });
    return { inserted: true, payout: { ...payout } };
  }

  async get(id: string) {
    const row = this.rows.get(id);
    return row && { ...row };
  }

  async getByBounty(bountyId: string) {
    for (const row of this.rows.values()) if (row.bountyId === bountyId) return { ...row };
    return undefined;
  }

  async findByBitnob({ bitnobPayoutId, quoteId }: { bitnobPayoutId?: string | null; quoteId?: string | null }) {
    for (const row of this.rows.values()) {
      if ((bitnobPayoutId && row.bitnobPayoutId === bitnobPayoutId) || (quoteId && row.quoteId === quoteId)) {
        return { ...row };
      }
    }
    return undefined;
  }

  async listByStatus(status: Payout["status"]) {
    return [...this.rows.values()].filter((r) => r.status === status).map((r) => ({ ...r }));
  }

  async update(id: string, expected: PayoutExpectation, patch: Partial<Omit<Payout, "id" | "bountyId" | "reference">>) {
    const row = this.rows.get(id);
    if (!row || row.status !== expected.status) return null;
    if (expected.attempts !== undefined && row.attempts !== expected.attempts) return null;
    if (expected.unset?.some((k) => row[k] != null)) return null;
    const next = { ...row, ...patch };
    this.rows.set(id, next);
    return { ...next };
  }
}
