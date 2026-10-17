import type { Bounty, BountyStatus, Claim } from "@bitbounty/core";
import { InMemoryBountyRepo as PrInMemoryBountyRepo } from "../github/pr/fakes.js";
import type { BountyRepo as PrBountyRepo } from "../github/pr/ports.js";

/**
 * Bounty storage shared by the GitHub modules. G4 defined the read side and `saveBounty`
 * (apps/server/src/github/pr/ports.ts); G3 adds what comment commands need: create with
 * one-bounty-per-issue, a compare-and-set update for races (two `/claim` at once), the
 * status comment id and claims. One instance serves both, so G4 sees what G3 writes.
 * In-memory until F3 (packages/db) lands; a Drizzle version implements the same interface.
 */

/** A claim plus the GitHub login of who holds it (the status comment and G4 need it). */
export interface ClaimRecord extends Claim {
  login: string;
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

  /** Stores the claim; an `active` one becomes the bounty's `activeClaimant`. */
  createClaim(claim: ClaimRecord): Promise<ClaimRecord>;
  /** The claim with status `active` on this bounty, if any. */
  activeClaim(bountyId: string): Promise<ClaimRecord | undefined>;
  setClaimStatus(claimId: string, status: Claim["status"]): Promise<void>;
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
    if (status !== "active" && this.claimants.get(c.bountyId)?.claimId === claimId) {
      this.claimants.delete(c.bountyId);
    }
  }

  /** Test helper. */
  all(): Bounty[] {
    return [...this.bounties.values()].map((b) => ({ ...b }));
  }
}
