import { randomUUID } from "node:crypto";
import { transition, type Bounty, type Submission } from "@bitbounty/core";
import { createDb, runMigrations } from "@bitbounty/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleBountyRepo } from "./drizzle-repo.js";
import { InMemoryBountyRepo, type BountyRepo, type ClaimRecord } from "./repo.js";

/**
 * One contract, two implementations: what G3, G4, A2 rely on must behave the same in
 * memory and on Postgres. `reopen()` returns a fresh handle on the same storage (a server
 * restart for Postgres; the same object in memory, which has nothing else to reopen).
 */
interface Harness {
  repo: () => BountyRepo;
  reopen: () => BountyRepo;
}

let seq = 0;
const uniqueRepo = () => `Contract-Org/repo-${process.pid}-${Date.now()}-${++seq}`;

function bounty(over: Partial<Bounty> = {}): Bounty {
  return {
    id: randomUUID(),
    repoFullName: uniqueRepo(),
    issueNumber: 3,
    issueTitle: "Add retries",
    amountXof: 7000,
    status: "unfunded",
    criteria: [{ text: "retries 3 times" }],
    funderKind: "human",
    funderId: "github:fatou-maintainer",
    verdict: null,
    statusCommentId: null,
    createdAt: "2026-10-17T20:00:00.000Z",
    expiresAt: null,
    ...over,
  };
}

function claim(b: Bounty, login = "awa-dev"): ClaimRecord {
  return {
    id: randomUUID(),
    bountyId: b.id,
    userId: `github:${login}`,
    login,
    status: "active",
    expiresAt: "2026-10-20T20:00:00.000Z",
    extensions: 0,
  };
}

function contract(name: string, h: Harness) {
  describe(`BountyRepo contract: ${name}`, () => {
    it("creates one bounty per issue and finds it by id and issue (repo name case-insensitive)", async () => {
      const repo = h.repo();
      const b = bounty();
      expect(await repo.create(b)).toEqual({ created: true, bounty: b });
      expect(await repo.findById(b.id)).toEqual(b);
      expect(await repo.findByIssue(b.repoFullName.toLowerCase(), b.issueNumber)).toEqual(b);

      const dup = bounty({ repoFullName: b.repoFullName, amountXof: 9000 });
      expect(await repo.create(dup)).toEqual({ created: false, bounty: b });
      expect(await repo.findById(dup.id)).toBeUndefined();
      expect(await repo.findByIssue(b.repoFullName, 999)).toBeUndefined();
    });

    it("update is a compare-and-set on the status and never moves the bounty to another issue", async () => {
      const repo = h.repo();
      const b = bounty();
      await repo.create(b);
      expect(await repo.update({ ...b, status: "claimed" }, "funded")).toBeUndefined();
      expect((await repo.findById(b.id))?.status).toBe("unfunded");

      const funded = await repo.update({ ...b, status: "funded", issueNumber: 42, verdict: "pass" }, "unfunded");
      expect(funded).toEqual({ ...b, status: "funded", verdict: "pass" });
      expect(await repo.findById(b.id)).toEqual(funded);
      // A second writer that read `unfunded` loses.
      expect(await repo.update({ ...b, status: "cancelled" }, "unfunded")).toBeUndefined();
    });

    it("sets and clears the status comment id", async () => {
      const repo = h.repo();
      const b = bounty();
      await repo.create(b);
      await repo.setStatusCommentId(b.id, 3_400_000_123);
      expect((await repo.findById(b.id))?.statusCommentId).toBe(3_400_000_123);
      await repo.setStatusCommentId(b.id, null);
      expect((await repo.findById(b.id))?.statusCommentId).toBeNull();
    });

    it("tracks the active claim, its claimant and the bounties they hold", async () => {
      const repo = h.repo();
      const b = bounty({ status: "funded" });
      await repo.create(b);
      expect(await repo.activeClaim(b.id)).toBeUndefined();
      expect(await repo.activeClaimant(b.id)).toBeUndefined();

      const c = claim(b);
      expect(await repo.createClaim(c)).toEqual(c);
      const claimed = (await repo.update({ ...b, status: "claimed" }, "funded"))!;
      expect(await repo.activeClaim(b.id)).toEqual(c);
      expect(await repo.activeClaimant(b.id)).toEqual({ claimId: c.id, userId: c.userId, login: "awa-dev" });
      expect(await repo.openBountiesClaimedBy(b.repoFullName.toUpperCase(), "AWA-DEV")).toEqual([claimed]);
      expect(await repo.openBountiesClaimedBy(b.repoFullName, "moussa-dev")).toEqual([]);

      await repo.setClaimStatus(c.id, "released");
      expect(await repo.activeClaim(b.id)).toBeUndefined();
      expect(await repo.activeClaimant(b.id)).toBeUndefined();
      expect(await repo.openBountiesClaimedBy(b.repoFullName, "awa-dev")).toEqual([]);

      // A new claim after the release.
      const next = claim(b, "moussa-dev");
      await repo.createClaim(next);
      expect(await repo.activeClaim(b.id)).toEqual(next);
    });

    it("saveBounty upserts; submissions upsert and are found by PR", async () => {
      const repo = h.repo();
      const b = bounty({ status: "claimed" });
      await repo.saveBounty(b);
      expect(await repo.findById(b.id)).toEqual(b);
      await repo.saveBounty({ ...b, status: "submitted" });
      expect((await repo.findById(b.id))?.status).toBe("submitted");

      const sub: Submission = {
        id: randomUUID(),
        bountyId: b.id,
        prNumber: 321,
        authorLogin: "awa-dev",
        headSha: "abc123",
        verdict: null,
        report: null,
        spamScore: null,
        mergedAt: null,
      };
      expect(await repo.currentSubmission(b.id)).toBeUndefined();
      await repo.saveSubmission(sub);
      expect(await repo.currentSubmission(b.id)).toEqual(sub);
      const merged = { ...sub, mergedAt: "2026-10-17T21:00:00.000Z", verdict: "pass" as const, spamScore: 0.25 };
      await repo.saveSubmission(merged);
      expect(await repo.submissionsForPr(b.repoFullName.toLowerCase(), 321)).toEqual([merged]);
      expect(await repo.submissionsForPr(b.repoFullName, 322)).toEqual([]);
    });

    it("keeps bounties and claims across a reopen (server restart)", async () => {
      const b = bounty({ status: "funded" });
      await h.repo().create(b);
      const c = claim(b);
      await h.repo().createClaim(c);
      await h.repo().setStatusCommentId(b.id, 77);

      const after = h.reopen();
      expect(await after.findByIssue(b.repoFullName, b.issueNumber)).toEqual({ ...b, statusCommentId: 77 });
      expect(await after.activeClaim(b.id)).toEqual(c);
    });

    it("a submitted PR still blocks the refund after /reject and a restart (F2 review fix)", async () => {
      const b = bounty({ status: "claimed" });
      await h.repo().create(b);
      const linked = transition(b, {
        type: "pr.linked",
        bountyId: b.id,
        occurredAt: b.createdAt,
        prNumber: 55,
        authorLogin: "awa-dev",
        headSha: "def456",
      });
      if (!linked.ok) throw new Error(linked.message);
      await h.repo().saveBounty(linked.bounty);
      await h.repo().saveSubmission({
        id: randomUUID(),
        bountyId: b.id,
        prNumber: 55,
        authorLogin: "awa-dev",
        headSha: "def456",
        verdict: null,
        report: null,
        spamScore: null,
        mergedAt: null,
      });
      const submitted = (await h.reopen().findById(b.id))!;
      expect(submitted).toMatchObject({ status: "submitted", hadSubmission: true, prNumber: 55, headSha: "def456" });

      const rejected = transition(submitted, {
        type: "maintainer.reject",
        bountyId: b.id,
        occurredAt: b.createdAt,
        actorLogin: "fatou-maintainer",
        reason: "wrong fix",
      });
      if (!rejected.ok) throw new Error(rejected.message);
      await h.repo().update(rejected.bounty, "submitted");
      const funded = (await h.reopen().findById(b.id))!;
      expect(funded).toMatchObject({ status: "funded", hadSubmission: true });
      const cancel = transition(funded, {
        type: "bounty.cancelled",
        bountyId: b.id,
        occurredAt: b.createdAt,
        actorId: "github:fatou-maintainer",
        reason: "changed plans",
      });
      expect(cancel).toMatchObject({ ok: false, code: "SUBMISSION_LOCKED" });
    });

    it("lists active claims, finds one by id and extends it (G5 claim timer)", async () => {
      const repo = h.repo();
      const b = bounty({ status: "funded" });
      await repo.create(b);
      const c = claim(b);
      await repo.createClaim(c);
      expect(await repo.findClaim(c.id)).toEqual(c);
      expect((await repo.listActiveClaims()).filter((x) => x.bountyId === b.id)).toEqual([c]);

      await repo.extendClaim(c.id, "2026-10-21T20:00:00.000Z", 1);
      const extended = { ...c, expiresAt: "2026-10-21T20:00:00.000Z", extensions: 1 };
      expect(await repo.findClaim(c.id)).toEqual(extended);
      expect(await h.reopen().activeClaim(b.id)).toEqual(extended);

      await h.repo().setClaimStatus(c.id, "expired");
      expect(await h.repo().findClaim(c.id)).toEqual({ ...extended, status: "expired" });
      expect((await h.repo().listActiveClaims()).some((x) => x.id === c.id)).toBe(false);
    });

    it("ignores unknown ids", async () => {
      const repo = h.repo();
      expect(await repo.findById(randomUUID())).toBeUndefined();
      expect(await repo.activeClaim(randomUUID())).toBeUndefined();
      await repo.setStatusCommentId(randomUUID(), 1);
      await repo.setClaimStatus(randomUUID(), "released");
      expect(await repo.findClaim(randomUUID())).toBeUndefined();
      await repo.extendClaim(randomUUID(), "2026-10-21T20:00:00.000Z", 1);
    });
  });
}

// --- in memory: always ---

const memory = new InMemoryBountyRepo();
contract("InMemoryBountyRepo", { repo: () => memory, reopen: () => memory });

// --- Postgres: when DATABASE_URL is set, in a throwaway database (dev data untouched) ---

const url = process.env.DATABASE_URL;
describe.skipIf(!url)("on Postgres (DATABASE_URL)", () => {
  const name = `bitbounty_test_contract_${process.pid}_${Date.now()}`;
  let admin: pg.Client;
  let testUrl: string;
  const conns: ReturnType<typeof createDb>[] = [];
  let current: DrizzleBountyRepo;
  /** A new pool and repo on the same database, like the server after a restart. */
  const connect = () => {
    const conn = createDb(testUrl);
    conns.push(conn);
    return (current = new DrizzleBountyRepo(conn.db));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database "${name}"`);
    const u = new URL(url!);
    u.pathname = `/${name}`;
    testUrl = u.toString();
    const migrator = createDb(testUrl);
    await runMigrations(migrator.db);
    await migrator.close();
    connect();
  });

  afterAll(async () => {
    await Promise.all(conns.map((c) => c.close()));
    await admin?.query(`drop database if exists "${name}"`);
    await admin?.end();
  });

  contract("DrizzleBountyRepo", {
    repo: () => current,
    reopen: connect,
  });
});
