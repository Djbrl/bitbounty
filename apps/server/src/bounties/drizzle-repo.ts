import { createHash } from "node:crypto";
import type { Bounty, BountyStatus, Claim, Submission } from "@bitbounty/core";
import { bounties, claims, installations, repos, submissions, users, type Database } from "@bitbounty/db";
import { and, desc, eq, inArray, sql, type AnyColumn } from "drizzle-orm";
import type { Claimant } from "../github/pr/ports.js";
import type { BountyRepo, ClaimRecord, CreateResult } from "./repo.js";

/**
 * `BountyRepo` (G3's full interface, a superset of G4's) on the Postgres tables of
 * `@bitbounty/db`. Same behaviour as `InMemoryBountyRepo`: both run the contract tests
 * in `repo.contract.test.ts`.
 *
 * Mapping between core types and rows:
 * - `Bounty.repoFullName` ↔ `bounties.repo_id` → `repos.full_name` (case-insensitive lookup).
 * - User ids: core uses `github:<login>` (G3), the DB uses `users.id`. Writes accept either;
 *   reads return `github:<login>`. Humans funders likewise; agent funders keep `agents.id`.
 * - A repo, its owner's installation or a user seen for the first time (G3 gets them from a
 *   webhook) is inserted with a placeholder GitHub id: negative, derived from the name, so it
 *   never clashes with a real one. Installation sync can replace it later.
 * - `ClaimRecord.extensions` ↔ `claims.extensions` (0 when never extended).
 * - Submission ids: readable ids (`sub-<bountyId>-<pr>`) map to a stable uuid (`toUuid`).
 * - `Bounty.hadSubmission` / `prNumber` / `headSha` (core's no-refund-after-a-PR rule and
 *   commit binding) have no column: they're read from `submissions` (whether any row exists;
 *   the latest row's PR and commit, like `currentSubmission`).
 */

type BountyRow = typeof bounties.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string) => UUID.test(id);

/**
 * `submissions.id` is a uuid; handlers build readable ids (`sub-<bountyId>-<pr>`).
 * Map those to a stable uuid (sha1-based), so saving the same id twice upserts.
 */
export function toUuid(id: string): string {
  if (isUuid(id)) return id;
  const h = createHash("sha1").update(`bitbounty:submission:${id}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Negative placeholder GitHub id for rows created before we know the real one. */
export function placeholderGithubId(kind: string, name: string): number {
  const h = createHash("sha1").update(`bitbounty:${kind}:${name.toLowerCase()}`).digest("hex");
  return -(parseInt(h.slice(0, 12), 16) + 1);
}

const GITHUB_PREFIX = "github:";
const userIdFor = (login: string) => `${GITHUB_PREFIX}${login}`;

const lowerEq = (col: AnyColumn, value: string) => sql`lower(${col}) = lower(${value})`;

export class DrizzleBountyRepo implements BountyRepo {
  constructor(private db: Database) {}

  // --- reads (G4) ---

  /** Bounties joined with their repo name and, for human funders, the funder's login. */
  private select() {
    const latest = (col: AnyColumn) =>
      sql`(select ${col} from ${submissions} where ${submissions.bountyId} = ${bounties.id} order by ${submissions.createdAt} desc limit 1)`;
    return this.db
      .select({
        bounty: bounties,
        repoFullName: repos.fullName,
        funderLogin: users.login,
        hadSubmission: sql<boolean>`exists (select 1 from ${submissions} where ${submissions.bountyId} = ${bounties.id})`,
        prNumber: latest(submissions.prNumber).mapWith(Number),
        headSha: latest(submissions.headSha).mapWith(String),
      })
      .from(bounties)
      .innerJoin(repos, eq(bounties.repoId, repos.id))
      .leftJoin(users, and(eq(bounties.funderKind, "human"), eq(users.id, bounties.funderId)));
  }

  async findById(id: string) {
    if (!isUuid(id)) return undefined;
    const [row] = await this.select().where(eq(bounties.id, id)).limit(1);
    return row ? toBounty(row) : undefined;
  }

  async findByIssue(repoFullName: string, issueNumber: number) {
    const [row] = await this.select()
      .where(and(lowerEq(repos.fullName, repoFullName), eq(bounties.issueNumber, issueNumber)))
      .limit(1);
    return row ? toBounty(row) : undefined;
  }

  async activeClaimant(bountyId: string): Promise<Claimant | undefined> {
    const c = await this.activeClaim(bountyId);
    return c ? { claimId: c.id, userId: c.userId, login: c.login } : undefined;
  }

  async currentSubmission(bountyId: string) {
    if (!isUuid(bountyId)) return undefined;
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
    const claimant = this.db
      .select({ bountyId: claims.bountyId })
      .from(claims)
      .innerJoin(users, eq(claims.userId, users.id))
      .where(and(eq(claims.status, "active"), lowerEq(users.login, login)));
    const rows = await this.select().where(
      and(
        lowerEq(repos.fullName, repoFullName),
        inArray(bounties.status, ["claimed", "submitted"]),
        inArray(bounties.id, claimant),
      ),
    );
    return rows.map(toBounty);
  }

  // --- writes ---

  async saveBounty(b: Bounty) {
    const values = { id: b.id, ...(await this.bountyValues(b)), repoId: await this.ensureRepo(b.repoFullName) };
    const { id: _id, createdAt: _c, ...update } = values;
    await this.db.insert(bounties).values(values).onConflictDoUpdate({ target: bounties.id, set: update });
  }

  async create(b: Bounty): Promise<CreateResult> {
    const values = { id: b.id, ...(await this.bountyValues(b)), repoId: await this.ensureRepo(b.repoFullName) };
    // One bounty per issue: the unique (repo_id, issue_number) index settles races.
    const inserted = await this.db.insert(bounties).values(values).onConflictDoNothing().returning({ id: bounties.id });
    const stored = await this.findByIssue(b.repoFullName, b.issueNumber);
    if (!stored) throw new Error(`bounty ${b.id} could not be created`);
    return inserted.length > 0 ? { created: true, bounty: stored } : { created: false, bounty: stored };
  }

  async update(b: Bounty, expectedStatus: BountyStatus) {
    if (!isUuid(b.id)) return undefined;
    // The issue a bounty belongs to never changes: repo and issue number are not written.
    const { issueNumber: _issue, ...values } = await this.bountyValues(b);
    const updated = await this.db
      .update(bounties)
      .set(values)
      .where(and(eq(bounties.id, b.id), eq(bounties.status, expectedStatus)))
      .returning({ id: bounties.id });
    return updated.length > 0 ? this.findById(b.id) : undefined;
  }

  async setStatusCommentId(bountyId: string, commentId: number | null) {
    if (!isUuid(bountyId)) return;
    await this.db.update(bounties).set({ statusCommentId: commentId }).where(eq(bounties.id, bountyId));
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

  // --- claims (G3) ---

  async createClaim(claim: ClaimRecord): Promise<ClaimRecord> {
    const userId = await this.ensureUser(claim.login);
    await this.db.insert(claims).values({
      id: claim.id,
      bountyId: claim.bountyId,
      userId,
      status: claim.status,
      expiresAt: new Date(claim.expiresAt),
      extensions: claim.extensions ?? 0,
    });
    return (await this.findClaim(claim.id))!;
  }

  async activeClaim(bountyId: string) {
    if (!isUuid(bountyId)) return undefined;
    const [row] = await this.claimSelect().where(and(eq(claims.bountyId, bountyId), eq(claims.status, "active"))).limit(1);
    return row ? toClaim(row) : undefined;
  }

  async setClaimStatus(claimId: string, status: Claim["status"]) {
    if (!isUuid(claimId)) return;
    await this.db.update(claims).set({ status }).where(eq(claims.id, claimId));
  }

  /** One claim by id. */
  async findClaim(claimId: string) {
    if (!isUuid(claimId)) return undefined;
    const [row] = await this.claimSelect().where(eq(claims.id, claimId)).limit(1);
    return row ? toClaim(row) : undefined;
  }

  // --- claim timer (G5) ---

  async listActiveClaims() {
    const rows = await this.claimSelect().where(eq(claims.status, "active")).orderBy(claims.expiresAt);
    return rows.map(toClaim);
  }

  async extendClaim(claimId: string, expiresAt: string, extensions: number) {
    if (!isUuid(claimId)) return;
    await this.db.update(claims).set({ expiresAt: new Date(expiresAt), extensions }).where(eq(claims.id, claimId));
  }

  private claimSelect() {
    return this.db
      .select({ claim: claims, login: users.login })
      .from(claims)
      .innerJoin(users, eq(claims.userId, users.id));
  }

  // --- mapping helpers ---

  /** The bounty columns written by create and save (update drops issue_number; repo_id is separate). */
  private async bountyValues(b: Bounty) {
    return {
      issueNumber: b.issueNumber,
      issueTitle: b.issueTitle,
      amountXof: b.amountXof,
      status: b.status,
      criteria: b.criteria,
      funderKind: b.funderKind,
      funderId: await this.resolveUserId(b.funderId),
      verdict: b.verdict,
      statusCommentId: b.statusCommentId,
      createdAt: new Date(b.createdAt),
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    };
  }

  /** `github:<login>` → `users.id` (inserted if new); a uuid (user or agent id) as is. */
  private async resolveUserId(id: string): Promise<string> {
    if (id.startsWith(GITHUB_PREFIX)) return this.ensureUser(id.slice(GITHUB_PREFIX.length));
    if (isUuid(id)) return id;
    throw new Error(`unsupported user id ${JSON.stringify(id)}: expected github:<login> or a uuid`);
  }

  private async ensureUser(login: string): Promise<string> {
    const find = async () =>
      (await this.db.select({ id: users.id }).from(users).where(lowerEq(users.login, login)).limit(1))[0]?.id;
    const found = await find();
    if (found) return found;
    await this.db
      .insert(users)
      .values({ login, githubId: placeholderGithubId("user", login) })
      .onConflictDoNothing();
    const id = await find();
    if (!id) throw new Error(`user ${login} could not be stored`);
    return id;
  }

  private async ensureRepo(fullName: string): Promise<string> {
    const find = async () =>
      (await this.db.select({ id: repos.id }).from(repos).where(lowerEq(repos.fullName, fullName)).limit(1))[0]?.id;
    const found = await find();
    if (found) return found;
    const owner = fullName.split("/")[0] ?? fullName;
    const findInstallation = async () =>
      (
        await this.db
          .select({ id: installations.id })
          .from(installations)
          .where(lowerEq(installations.accountLogin, owner))
          .limit(1)
      )[0]?.id;
    let installationId = await findInstallation();
    if (!installationId) {
      await this.db
        .insert(installations)
        .values({ accountLogin: owner, githubInstallationId: placeholderGithubId("installation", owner) })
        .onConflictDoNothing();
      installationId = await findInstallation();
    }
    if (!installationId) throw new Error(`installation for ${owner} could not be stored`);
    await this.db
      .insert(repos)
      .values({ installationId, fullName, githubRepoId: placeholderGithubId("repo", fullName) })
      .onConflictDoNothing();
    const id = await find();
    if (!id) throw new Error(`repo ${fullName} could not be stored`);
    return id;
  }
}

function toBounty(row: {
  bounty: BountyRow;
  repoFullName: string;
  funderLogin: string | null;
  hadSubmission: boolean | null;
  prNumber: number | null;
  headSha: string | null;
}): Bounty {
  const b = row.bounty;
  return {
    // Only present once a PR was linked, like a bounty built by core's `transition()`.
    ...(row.hadSubmission === true ? { hadSubmission: true } : {}),
    ...(row.prNumber != null ? { prNumber: row.prNumber } : {}),
    ...(row.headSha != null ? { headSha: row.headSha } : {}),
    id: b.id,
    repoFullName: row.repoFullName,
    issueNumber: b.issueNumber,
    issueTitle: b.issueTitle,
    amountXof: b.amountXof,
    status: b.status,
    criteria: b.criteria,
    funderKind: b.funderKind,
    funderId: row.funderLogin ? userIdFor(row.funderLogin) : b.funderId,
    verdict: b.verdict,
    statusCommentId: b.statusCommentId,
    createdAt: b.createdAt.toISOString(),
    expiresAt: b.expiresAt?.toISOString() ?? null,
  };
}

function toClaim(row: { claim: typeof claims.$inferSelect; login: string }): ClaimRecord {
  return {
    id: row.claim.id,
    bountyId: row.claim.bountyId,
    userId: userIdFor(row.login),
    login: row.login,
    status: row.claim.status,
    expiresAt: row.claim.expiresAt.toISOString(),
    extensions: row.claim.extensions,
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
