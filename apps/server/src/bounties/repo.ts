import type { Bounty, BountyStatus, Claim } from "@bitbounty/core";
import { InMemoryBountyRepo as PrInMemoryBountyRepo } from "../github/pr/fakes.js";
import type { BountyRepo as PrBountyRepo } from "../github/pr/ports.js";

/**
 * Bounty storage shared by the GitHub modules. G4 defined the read side and `saveBounty`
 * (apps/server/src/github/pr/ports.ts); G3 adds what comment commands need: create with
 * one-bounty-per-issue, a compare-and-set update for races (two `/claim` at once), the
 * status comment id and claims. One instance serves both, so G4 sees what G3 writes.
 * `DrizzleBountyRepo` (./drizzle-repo.ts) is the Postgres version; both pass repo.contract.test.ts.
 */

/** A claim plus the GitHub login of who holds it (the status comment and G4 need it). */
export interface ClaimRecord extends Claim {
  login: string;
  /** How many times `/extend` pushed `expiresAt` back (G5). Missing = 0. */
  extensions?: number;
}

export type CreateResult = { created: true; bounty: Bounty } | { created: false; bounty: Bounty };

export interface BountyRepo extends PrBountyRepo {
  /**
   * Inserts a bounty. One bounty per issue: when the issue already has one, nothing is
   * written and the existing bounty comes back with `created: false` (DB: unique index).
   */
  create(bounty: Bounty): Promise<CreateResult>;
  /**
   * Compare-and-set on the status: writes `bounty` only if the stored status is still
   * `expectedStatus`. Returns the stored bounty, or `undefined` when another writer won the race.
   */
  update(bounty: Bounty, expectedStatus: BountyStatus): Promise<Bounty | undefined>;
  setStatusCommentId(bountyId: string, commentId: number | null): Promise<void>;
  /** Every bounty, newest first (I1: board, dashboard, live screen). Capped at `limit` (default 1000). */
  list(limit?: number): Promise<Bounty[]>;

  /** Stores the claim; an `active` one becomes the bounty's `activeClaimant`. */
  createClaim(claim: ClaimRecord): Promise<ClaimRecord>;
  /** The claim with status `active` on this bounty, if any. */
  activeClaim(bountyId: string): Promise<ClaimRecord | undefined>;
  setClaimStatus(claimId: string, status: Claim["status"]): Promise<void>;

  // --- G5: claim timer ---
  findClaim(claimId: string): Promise<ClaimRecord | undefined>;
  /** Every claim with status `active` (the timer sweep re-arms from this after a restart). */
  listActiveClaims(): Promise<ClaimRecord[]>;
  /** `/extend`: new deadline and extension count. */
  extendClaim(claimId: string, expiresAt: string, extensions: number): Promise<void>;
}

export class InMemoryBountyRepo extends PrInMemoryBountyRepo implements BountyRepo {
  readonly claims = new Map<string, ClaimRecord>();

  async create(bounty: Bounty): Promise<CreateResult> {
    const existing = await this.findByIssue(bounty.repoFullName, bounty.issueNumber);
    if (existing) return { created: false, bounty: { ...existing } };
    this.bounties.set(bounty.id, { ...bounty });
    return { created: true, bounty: { ...bounty } };
  }

  async update(bounty: Bounty, expectedStatus: BountyStatus) {
    const current = this.bounties.get(bounty.id);
    if (!current || current.status !== expectedStatus) return undefined;
    // The issue a bounty belongs to never changes.
    const next = { ...bounty, repoFullName: current.repoFullName, issueNumber: current.issueNumber };
    this.bounties.set(bounty.id, next);
    return { ...next };
  }

  async list(limit = 1000) {
    return this.all()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async setStatusCommentId(bountyId: string, commentId: number | null) {
    const current = this.bounties.get(bountyId);
    if (current) this.bounties.set(bountyId, { ...current, statusCommentId: commentId });
  }

  async createClaim(claim: ClaimRecord) {
    this.claims.set(claim.id, { ...claim });
    if (claim.status === "active") {
      this.claimants.set(claim.bountyId, { claimId: claim.id, userId: claim.userId, login: claim.login });
    }
    return { ...claim };
  }

  async activeClaim(bountyId: string) {
    for (const c of this.claims.values()) {
      if (c.bountyId === bountyId && c.status === "active") return { ...c };
    }
    return undefined;
  }

  async setClaimStatus(claimId: string, status: Claim["status"]) {
    const c = this.claims.get(claimId);
    if (!c) return;
    this.claims.set(claimId, { ...c, status });
    if (status === "active") {
      this.claimants.set(c.bountyId, { claimId: c.id, userId: c.userId, login: c.login });
    } else if (this.claimants.get(c.bountyId)?.claimId === claimId) {
      this.claimants.delete(c.bountyId);
    }
  }

  async findClaim(claimId: string) {
    const c = this.claims.get(claimId);
    return c ? { ...c } : undefined;
  }

  async listActiveClaims() {
    return [...this.claims.values()].filter((c) => c.status === "active").map((c) => ({ ...c }));
  }

  async extendClaim(claimId: string, expiresAt: string, extensions: number) {
    const c = this.claims.get(claimId);
    if (c) this.claims.set(claimId, { ...c, expiresAt, extensions });
  }

  /** Test helper. */
  all(): Bounty[] {
    return [...this.bounties.values()].map((b) => ({ ...b }));
  }
}
