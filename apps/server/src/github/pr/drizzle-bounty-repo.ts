import { createHash } from "node:crypto";
import type { Bounty, Submission } from "@bitbounty/core";
import { bounties, claims, repos, submissions, users, type Database } from "@bitbounty/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { BountyRepo, Claimant } from "./ports.js";

type BountyRow = typeof bounties.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `submissions.id` is a uuid; handlers build readable ids (`sub-<bountyId>-<pr>`).
 * Map those to a stable uuid (sha1-based), so saving the same id twice upserts.
 */
export function toUuid(id: string): string {
  if (UUID.test(id)) return id;
  const h = createHash("sha1").update(`bitbounty:submission:${id}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const lowerEq = (col: typeof repos.fullName | typeof users.login, value: string) =>
  sql`lower(${col}) = lower(${value})`;

/** BountyRepo on the Postgres tables of `@bitbounty/db` (bounties, repos, claims, users, submissions). */
export class DrizzleBountyRepo implements BountyRepo {
  constructor(private db: Database) {}

  private select() {
    return this.db
      .select({ bounty: bounties, repoFullName: repos.fullName })
      .from(bounties)
      .innerJoin(repos, eq(bounties.repoId, repos.id));
  }

  async findById(id: string) {
    if (!UUID.test(id)) return undefined;
    const [row] = await this.select().where(eq(bounties.id, id)).limit(1);
    return row ? toBounty(row.bounty, row.repoFullName) : undefined;
  }

  async findByIssue(repoFullName: string, issueNumber: number) {
    const [row] = await this.select()
      .where(and(lowerEq(repos.fullName, repoFullName), eq(bounties.issueNumber, issueNumber)))
      .limit(1);
    return row ? toBounty(row.bounty, row.repoFullName) : undefined;
  }

  async activeClaimant(bountyId: string): Promise<Claimant | undefined> {
    if (!UUID.test(bountyId)) return undefined;
    const [row] = await this.db
      .select({ claimId: claims.id, userId: claims.userId, login: users.login })
      .from(claims)
      .innerJoin(users, eq(claims.userId, users.id))
      .where(and(eq(claims.bountyId, bountyId), eq(claims.status, "active")))
      .limit(1);
    return row;
  }

  async currentSubmission(bountyId: string) {
    if (!UUID.test(bountyId)) return undefined;
    const [row] = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.bountyId, bountyId))
      .orderBy(desc(submissions.createdAt))
      .limit(1);
    return row ? toSubmission(row) : undefined;
  }

  async submissionsForPr(repoFullName: string, prNumber: number) {
    const rows = await this.db
      .select({ s: submissions })
      .from(submissions)
      .innerJoin(bounties, eq(submissions.bountyId, bounties.id))
      .innerJoin(repos, eq(bounties.repoId, repos.id))
      .where(and(lowerEq(repos.fullName, repoFullName), eq(submissions.prNumber, prNumber)));
    return rows.map((r) => toSubmission(r.s));
  }

  async openBountiesClaimedBy(repoFullName: string, login: string) {
    const rows = await this.db
      .select({ bounty: bounties, repoFullName: repos.fullName })
      .from(bounties)
      .innerJoin(repos, eq(bounties.repoId, repos.id))
      .innerJoin(claims, and(eq(claims.bountyId, bounties.id), eq(claims.status, "active")))
      .innerJoin(users, eq(claims.userId, users.id))
      .where(
        and(
          lowerEq(repos.fullName, repoFullName),
          inArray(bounties.status, ["claimed", "submitted"]),
          lowerEq(users.login, login),
        ),
      );
    return rows.map((r) => toBounty(r.bounty, r.repoFullName));
  }

  async saveBounty(b: Bounty) {
    const [repo] = await this.db.select({ id: repos.id }).from(repos).where(lowerEq(repos.fullName, b.repoFullName)).limit(1);
    if (!repo) throw new Error(`repo ${b.repoFullName} is not in the database`);
    const values = {
      id: b.id,
      repoId: repo.id,
      issueNumber: b.issueNumber,
      issueTitle: b.issueTitle,
      amountXof: b.amountXof,
      status: b.status,
      criteria: b.criteria,
      funderKind: b.funderKind,
      funderId: b.funderId,
      verdict: b.verdict,
      statusCommentId: b.statusCommentId,
      createdAt: new Date(b.createdAt),
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    };
    const { id: _id, createdAt: _c, ...update } = values;
    await this.db.insert(bounties).values(values).onConflictDoUpdate({ target: bounties.id, set: update });
  }

  async saveSubmission(s: Submission) {
    const values = {
      id: toUuid(s.id),
      bountyId: s.bountyId,
      prNumber: s.prNumber,
      authorLogin: s.authorLogin,
      headSha: s.headSha,
      verdict: s.verdict,
      report: s.report,
      spamScore: s.spamScore,
      mergedAt: s.mergedAt ? new Date(s.mergedAt) : null,
    };
    const { id: _id, ...update } = values;
    await this.db.insert(submissions).values(values).onConflictDoUpdate({ target: submissions.id, set: update });
  }
}

function toBounty(row: BountyRow, repoFullName: string): Bounty {
  return {
    id: row.id,
    repoFullName,
    issueNumber: row.issueNumber,
    issueTitle: row.issueTitle,
    amountXof: row.amountXof,
    status: row.status,
    criteria: row.criteria,
    funderKind: row.funderKind,
    funderId: row.funderId,
    verdict: row.verdict,
    statusCommentId: row.statusCommentId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function toSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    bountyId: row.bountyId,
    prNumber: row.prNumber,
    authorLogin: row.authorLogin,
    headSha: row.headSha,
    verdict: row.verdict,
    report: row.report,
    spamScore: row.spamScore,
    mergedAt: row.mergedAt?.toISOString() ?? null,
  };
}
