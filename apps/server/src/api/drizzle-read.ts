import type { Payout } from "@bitbounty/core";
import { fundings, payouts, users, type Database } from "@bitbounty/db";
import { desc, eq } from "drizzle-orm";
import type { FundingRecord } from "../funding/store.js";

/**
 * Read-only views of the `fundings` and `payouts` tables for the read API (I1). The funding
 * (B1/B4) and payout (B2) modules still keep their working state in memory; whatever is in
 * Postgres (seed, later the Drizzle stores) shows on the pages too.
 */
export class DrizzleFundingReader {
  constructor(private readonly db: Database) {}

  async listByBounty(bountyId: string): Promise<FundingRecord[]> {
    if (!isUuid(bountyId)) return [];
    const rows = await this.db.select().from(fundings).where(eq(fundings.bountyId, bountyId)).orderBy(desc(fundings.createdAt));
    return rows.map((r) => ({
      id: r.id,
      bountyId: r.bountyId,
      rail: r.rail,
      sourceAmount: r.sourceAmount,
      sourceCurrency: r.sourceCurrency,
      bitnobRef: r.bitnobRef,
      paymentHash: r.paymentHash,
      status: r.status,
      paidAt: r.paidAt?.toISOString() ?? null,
      funderId: "",
      // Not stored in this table: the page shows the funding without the fee breakdown.
      amountXof: 0,
      feeXof: 0,
      bufferXof: 0,
      paymentRequest: null,
      expiresAt: null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

export class DrizzlePayoutReader {
  constructor(private readonly db: Database) {}

  private select() {
    return this.db.select({ p: payouts, login: users.login }).from(payouts).leftJoin(users, eq(users.id, payouts.userId));
  }

  async get(id: string): Promise<Payout | undefined> {
    if (!isUuid(id)) return undefined;
    const [row] = await this.select().where(eq(payouts.id, id)).limit(1);
    return row ? toPayout(row) : undefined;
  }

  async getByBounty(bountyId: string): Promise<Payout | undefined> {
    if (!isUuid(bountyId)) return undefined;
    const [row] = await this.select().where(eq(payouts.bountyId, bountyId)).limit(1);
    return row ? toPayout(row) : undefined;
  }

  async listByStatus(status: Payout["status"]): Promise<Payout[]> {
    return (await this.select().where(eq(payouts.status, status)).limit(1000)).map(toPayout);
  }
}

function toPayout({ p, login }: { p: typeof payouts.$inferSelect; login: string | null }): Payout {
  return {
    id: p.id,
    bountyId: p.bountyId,
    userId: login ? `github:${login}` : p.userId,
    amountXof: p.amountXof,
    quoteId: p.quoteId,
    bitnobPayoutId: p.bitnobPayoutId,
    reference: p.reference,
    status: p.status,
    attempts: p.attempts,
    lastError: p.lastError,
    paidAt: p.paidAt?.toISOString() ?? null,
  };
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Memory first (live modules), then Postgres; deduplicated by id. */
export function mergeFundings(...sources: { listByBounty(id: string): Promise<FundingRecord[]> }[]) {
  return {
    async listByBounty(bountyId: string) {
      const seen = new Set<string>();
      const out: FundingRecord[] = [];
      for (const list of await Promise.all(sources.map((s) => s.listByBounty(bountyId)))) {
        for (const f of list) {
          if (seen.has(f.id)) continue;
          seen.add(f.id);
          out.push(f);
        }
      }
      return out;
    },
  };
}
