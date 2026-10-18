import type { Payout } from "@bitbounty/core";
import { payouts, users, type Database } from "@bitbounty/db";
import { and, eq, or, type SQL } from "drizzle-orm";
import { ensureUserId } from "../bounties/drizzle-repo.js";
import type { PayoutStore } from "./store.js";

type Row = typeof payouts.$inferSelect;
type Patch = Partial<Omit<Payout, "id" | "bountyId" | "reference">>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GITHUB = "github:";

/**
 * `PayoutStore` on the `payouts` table: the payout survives a restart, so `resume()` finishes it
 * (and pays once). Same behaviour as `InMemoryPayoutStore` (both run test/payout-store.contract.test.ts).
 *
 * - `create`: `insert … on conflict (bounty_id) do nothing`, then read: one row per bounty, even
 *   with two concurrent starts.
 * - `update`: a single `UPDATE … WHERE id = $1 AND status = $2 [AND attempts = $3] RETURNING *`.
 *   That compare-and-set is what stops two workers (or two processes) from running one attempt.
 * - User ids: core uses `github:<login>`, the table `users.id` (inserted on first use, like
 *   DrizzleBountyRepo). Bounty ids must be the bounties' uuids (foreign key).
 */
export class DrizzlePayoutStore implements PayoutStore {
  constructor(private readonly db: Database) {}

  private select() {
    return this.db.select({ p: payouts, login: users.login }).from(payouts).leftJoin(users, eq(users.id, payouts.userId));
  }

  private async one(where: SQL | undefined): Promise<Payout | undefined> {
    const [row] = await this.select().where(where).limit(1);
    return row ? toPayout(row.p, row.login) : undefined;
  }

  async create(payout: Payout) {
    const userId = await this.userId(payout.userId);
    const inserted = await this.db
      .insert(payouts)
      .values({
        ...toColumns(payout),
        ...(UUID.test(payout.id) ? { id: payout.id } : {}),
        bountyId: payout.bountyId,
        userId,
        amountXof: payout.amountXof,
        reference: payout.reference,
      })
      .onConflictDoNothing({ target: payouts.bountyId })
      .returning({ id: payouts.id });
    const row = await this.getByBounty(payout.bountyId);
    if (!row) throw new Error(`payout for bounty ${payout.bountyId} could not be stored`);
    return { inserted: inserted.length > 0, payout: row };
  }

  async get(id: string) {
    if (!UUID.test(id)) return undefined;
    return this.one(eq(payouts.id, id));
  }

  async getByBounty(bountyId: string) {
    if (!UUID.test(bountyId)) return undefined;
    return this.one(eq(payouts.bountyId, bountyId));
  }

  async findByBitnob({ bitnobPayoutId, quoteId }: { bitnobPayoutId?: string | null; quoteId?: string | null }) {
    const conds = [bitnobPayoutId ? eq(payouts.bitnobPayoutId, bitnobPayoutId) : undefined, quoteId ? eq(payouts.quoteId, quoteId) : undefined].filter(
      (c): c is SQL => c !== undefined,
    );
    if (!conds.length) return undefined;
    return this.one(or(...conds));
  }

  async listByStatus(status: Payout["status"]) {
    return (await this.select().where(eq(payouts.status, status)).limit(1000)).map((r) => toPayout(r.p, r.login));
  }

  async update(id: string, expected: { status: Payout["status"]; attempts?: number }, patch: Patch) {
    if (!UUID.test(id)) return null;
    const set = toColumns(patch);
    if (patch.userId !== undefined) set.userId = await this.userId(patch.userId);
    if (patch.amountXof !== undefined) set.amountXof = patch.amountXof;
    const where = and(
      eq(payouts.id, id),
      eq(payouts.status, expected.status),
      expected.attempts === undefined ? undefined : eq(payouts.attempts, expected.attempts),
    );
    // An empty patch still has to check the expected state: set a column to itself.
    const updated = await this.db
      .update(payouts)
      .set(Object.keys(set).length ? set : { status: expected.status })
      .where(where)
      .returning({ id: payouts.id });
    if (!updated.length) return null;
    return (await this.get(id)) ?? null;
  }

  private userId(id: string): Promise<string> {
    if (id.startsWith(GITHUB)) return ensureUserId(this.db, id.slice(GITHUB.length));
    if (UUID.test(id)) return Promise.resolve(id);
    return Promise.reject(new Error(`unsupported user id ${JSON.stringify(id)}: expected github:<login> or a uuid`));
  }
}

const date = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

/** The mutable columns present in `p` (undefined = leave as is). */
function toColumns(p: Patch): Partial<typeof payouts.$inferInsert> {
  const out: Partial<typeof payouts.$inferInsert> = {
    quoteId: p.quoteId,
    bitnobPayoutId: p.bitnobPayoutId,
    status: p.status,
    attempts: p.attempts,
    lastError: p.lastError,
    paidAt: date(p.paidAt),
    rail: p.rail,
    lightningAddress: p.lightningAddress,
    amountSats: p.amountSats,
    xofPerBtc: p.xofPerBtc,
    paymentRequest: p.paymentRequest,
    paymentHash: p.paymentHash,
    invoiceExpiresAt: date(p.invoiceExpiresAt),
    sentAt: date(p.sentAt),
    preimage: p.preimage,
  };
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (out[k] === undefined) delete out[k];
  return out;
}

export function toPayout(p: Row, login: string | null): Payout {
  return {
    id: p.id,
    bountyId: p.bountyId,
    userId: login ? `${GITHUB}${login}` : p.userId,
    amountXof: p.amountXof,
    quoteId: p.quoteId,
    bitnobPayoutId: p.bitnobPayoutId,
    reference: p.reference,
    status: p.status,
    attempts: p.attempts,
    lastError: p.lastError,
    paidAt: p.paidAt?.toISOString() ?? null,
    rail: p.rail,
    lightningAddress: p.lightningAddress,
    amountSats: p.amountSats,
    xofPerBtc: p.xofPerBtc,
    paymentRequest: p.paymentRequest,
    paymentHash: p.paymentHash,
    invoiceExpiresAt: p.invoiceExpiresAt?.toISOString() ?? null,
    sentAt: p.sentAt?.toISOString() ?? null,
    preimage: p.preimage,
  };
}
